/** Adds the narration to the recorded walkthrough. The cut is recomposed from the raw recordings: each scene
 * (one caption) starts in the pause before its paragraph and ends in the pause after it, and each anchored
 * event (a message arriving, a tool result, the reload) lands just before the words that describe it.
 * Between those points the recording plays at an even rate, keeping the recorder's own speed-ups in proportion.
 * The recording directory is not modified.
 *   node --experimental-strip-types scripts/video/narrate-walkthrough.ts --audio <file> [--in qa_evidence/scratch/video] [--out qa_evidence/scratch/video-narrated]
 * Paragraph timings, pane leads and anchors come from docs/video/narration-cues.json, which names the audio by checksum. */
import fs from "node:fs";
import path from "node:path";
import {sha256File} from "../evidence/lib.ts";
import {compose,outputSeconds,recordedCut,type Segment} from "./compose.ts";

const CUES="docs/video/narration-cues.json";
/** Silence before the first word and after the last one. */
const LEAD=0.4,TAIL=1.2;
const args=process.argv.slice(2);
const arg=(name:string,fallback?:string)=>{const i=args.indexOf(name);if(i>=0)return args[i+1]!;if(fallback===undefined)throw Error(`${name} is required`);return fallback;};
const AUDIO=path.resolve(arg("--audio")),IN=path.resolve(arg("--in","qa_evidence/scratch/video")),OUT=path.resolve(arg("--out","qa_evidence/scratch/video-narrated"));

type Paragraph={scene:number;speechStart:number;speechEnd:number;text:string};
type Anchor={scene:number;recordingSeconds:number;audioSeconds:number;event:string};
const cues=JSON.parse(fs.readFileSync(CUES,"utf8")) as {audio:{sha256:string};paneLeadSeconds:{left:number;right:number};anchors:Anchor[];paragraphs:Paragraph[]};
if(sha256File(AUDIO)!==cues.audio.sha256)throw Error(`${AUDIO} is not the audio ${CUES} was timed against`);
const recorded=JSON.parse(fs.readFileSync(path.join(IN,"timeline.json"),"utf8"));
if(sha256File(path.join(IN,recorded.file))!==recorded.sha256)throw Error(`${IN} does not hold the recorder's output`);
const cut=recordedCut(IN,{left:cues.paneLeadSeconds.left,right:cues.paneLeadSeconds.right});
const para=cues.paragraphs;
if(para.length!==cut.captions.length)throw Error(`${para.length} paragraphs for ${cut.captions.length} scenes`);

const bounds=[0,...para.slice(1).map((p,k)=>LEAD+(para[k]!.speechEnd+p.speechStart)/2),LEAD+para.at(-1)!.speechEnd+TAIL];
const segments:Segment[]=[];
const scenes=cut.captions.map((c,k)=>{
 const anchors=cues.anchors.filter(a=>a.scene===k+1);
 // The caption overlay switches at the time rounded to 0.01 s; a held span would magnify any difference.
 const points=[{rec:+c.from.toFixed(2),out:bounds[k]!},...anchors.map(a=>({rec:a.recordingSeconds,out:LEAD+a.audioSeconds})),{rec:+c.to.toFixed(2),out:bounds[k+1]!}];
 const spans=points.slice(1).map((p,i)=>{
  const q=points[i]!;
  if(!(p.rec>q.rec&&p.out>q.out))throw Error(`Scene ${k+1}: anchors out of order at recording ${p.rec}s`);
  const inSpan=cut.segments.map(s=>({...s,from:Math.max(s.from,q.rec),to:Math.min(s.to,p.rec)})).filter(s=>s.to>s.from);
  const factor=outputSeconds(inSpan)/(p.out-q.out);
  segments.push(...inSpan.map(s=>({...s,speed:s.speed*factor})));
  return {recordingFrom:+q.rec.toFixed(3),recordingTo:+p.rec.toFixed(3),outputFrom:+q.out.toFixed(3),outputTo:+p.out.toFixed(3),speedFactor:+factor.toFixed(4)};
 });
 return {scene:k+1,outputFrom:+bounds[k]!.toFixed(3),outputTo:+bounds[k+1]!.toFixed(3),
  speechFrom:+(LEAD+para[k]!.speechStart).toFixed(3),speechTo:+(LEAD+para[k]!.speechEnd).toFixed(3),spans};
});

fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(OUT,{recursive:true});
const file=path.join(OUT,recorded.file);
compose({...cut,segments,audio:{file:AUDIO,delay:LEAD},out:file});
const timeline={...recorded,
 speedSegments:segments.map(s=>({fromSeconds:+s.from.toFixed(3),toSeconds:+s.to.toFixed(3),speed:+s.speed.toFixed(4)})),
 narration:{cues:CUES,audioSha256:cues.audio.sha256,leadSeconds:LEAD,tailSeconds:TAIL,paneLeadSeconds:cues.paneLeadSeconds,silentCutSha256:recorded.sha256,
  anchors:cues.anchors.map(a=>({...a,outputSeconds:+(LEAD+a.audioSeconds).toFixed(3)})),scenes},
 sha256:sha256File(file)};
fs.writeFileSync(path.join(OUT,"timeline.json"),JSON.stringify(timeline,null,1)+"\n");
console.log(`Video: ${file}\nsha256 ${timeline.sha256}\n`+scenes.map(s=>`scene ${s.scene}: ${s.outputFrom}-${s.outputTo}s at ${s.spans.map(x=>x.speedFactor).join(", ")}x`).join("\n"));
