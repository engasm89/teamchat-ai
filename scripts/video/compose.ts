/** Composes the walkthrough from the two raw pane recordings: side by side, caption band overlaid,
 * cut into speed segments (all times in recording seconds), optionally with a narration track. */
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

export const PANE={width:960,height:900};
export interface Segment {from:number;to:number;speed:number}
export interface Composition {
 left:{file:string;trim:number};right:{file:string;trim:number};
 captions:Array<{png:string;from:number;to:number}>;
 segments:Segment[];
 /** Narration starts `delay` seconds into the output and is padded or cut to the video's length. */
 audio?:{file:string;delay:number};
 out:string;
}
export const outputSeconds=(segments:Segment[])=>segments.reduce((s,g)=>s+(g.to-g.from)/g.speed,0);

/** The cut the recorder wrote to `dir`: panes aligned at t0, captions and speed changes from timeline.raw.json.
 * Speed 0 marks a span removed from the cut. `lead` is how many seconds each pane's frames are timestamped
 * ahead of the moment they were painted; it is taken off so the panes line up with the captions. */
export function recordedCut(dir:string,lead={left:0,right:0}):Omit<Composition,"out"|"audio">{
 const raw=JSON.parse(fs.readFileSync(path.join(dir,"timeline.raw.json"),"utf8")) as
  {t0:number;left:number;right:number;captions:Array<{from:number;to:number}>;pace:Array<{at:number;speed:number}>};
 const sec=(ms:number)=>Math.max(0,(ms-raw.t0)/1000),end=sec(raw.captions.at(-1)!.to);
 return {
  left:{file:path.join(dir,"raw","left.webm"),trim:(raw.t0-raw.left)/1000-lead.left},
  right:{file:path.join(dir,"raw","right.webm"),trim:(raw.t0-raw.right)/1000-lead.right},
  captions:raw.captions.map((c,i)=>({png:path.join(dir,"captions",`${String(i).padStart(2,"0")}.png`),from:sec(c.from),to:sec(c.to)})),
  segments:raw.pace.map((p,i)=>({from:sec(p.at),to:i+1<raw.pace.length?sec(raw.pace[i+1]!.at):end,speed:p.speed})).filter(s=>s.to-s.from>0.05&&s.speed>0)};
}

export function compose(c:Composition){
 const end=c.segments.at(-1)!.to;
 const inputs=["-i",c.left.file,"-i",c.right.file,...c.captions.flatMap(k=>["-loop","1","-framerate","25","-t",String(end+1),"-i",k.png]),
  ...(c.audio?["-i",c.audio.file]:[])];
 // A negative trim starts the pane late: its first frame is held for that long.
 const pane=(trim:number)=>trim>=0?`trim=start=${trim},setpts=PTS-STARTPTS`:`setpts=PTS-STARTPTS,tpad=start_duration=${(-trim).toFixed(3)}:start_mode=clone`;
 const f:string[]=[
  `[0:v]${pane(c.left.trim)},fps=25[l]`,
  `[1:v]${pane(c.right.trim)},fps=25[r]`,
  `[l][r]hstack=inputs=2,pad=1920:1080:0:0:color=0x0f1d2e[b0]`];
 c.captions.forEach((k,i)=>f.push(`[b${i}][${i+2}:v]overlay=0:${PANE.height}:enable='between(t,${k.from.toFixed(2)},${k.to.toFixed(2)})'[b${i+1}]`));
 // One time map for the whole cut, resampled to 25 fps once: trimming each segment to whole frames
 // would lose up to a frame per segment and drift the picture away from the narration.
 const keep=c.segments.map(s=>`between(t,${s.from.toFixed(3)},${s.to.toFixed(3)})`).join("+");
 let at=0;const starts=c.segments.map(s=>{const start=at;at+=(s.to-s.from)/s.speed;return start;});
 const map=c.segments.reduceRight((rest,s,i)=>`if(lt(T,${s.to.toFixed(3)}),${starts[i]!.toFixed(4)}+(T-${s.from.toFixed(3)})/${s.speed},${rest})`,at.toFixed(4));
 f.push(`[b${c.captions.length}]select='${keep}',setpts='(${map})/TB',fps=25,format=yuv420p[out]`);
 const audio=c.audio?(()=>{
  const ms=Math.round(c.audio!.delay*1000);
  f.push(`[${c.captions.length+2}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},apad,atrim=end=${outputSeconds(c.segments).toFixed(3)}[aout]`);
  return ["-map","[aout]","-c:a","aac","-b:a","160k"];
 })():[];
 execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-y",...inputs,"-filter_complex",f.join(";"),"-map","[out]",...audio,
  "-c:v","libx264","-preset","medium","-crf","20","-movflags","+faststart",c.out],{stdio:"inherit"});
}
