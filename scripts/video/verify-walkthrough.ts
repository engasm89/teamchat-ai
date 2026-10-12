/** DEMO-VIDEO: checks the composed walkthrough (format, length, provenance binding, captions) and
 * scans OCR text of frames sampled every 0.5 s for reviewer passwords, e-mail addresses, JWTs and API keys.
 * The scan is calibrated by two controls recorded the way the walkthrough was (the deployed login page at
 * pane size through Playwright's recorder, then the same H.264 encode): planted decoy credentials must be
 * found when visible and must not be readable under the recorder's redaction.
 * High-resolution crops of the redacted regions are written for visual review.
 * With VIDEO_URL set, the published copy is downloaded anonymously, compared by checksum and fully decoded.
 *   VIDEO_URL=... node --experimental-strip-types scripts/video/verify-walkthrough.ts [--dir qa_evidence/scratch/video] [--dry-run]
 * --dry-run writes the run under qa_evidence/scratch/dry-runs instead of the evidence directory.
 * Requires macOS (Vision OCR via scripts/video/ocr.swift), ffmpeg/ffprobe and the Keychain reviewer passwords. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync,execFile} from "node:child_process";
import {promisify} from "node:util";
import {chromium} from "playwright";
import {RunRecorder,keychainPassword,sha256,sha256File} from "../evidence/lib.ts";
import {ACCOUNTS,API_URL,APP_URL,bindDeployment,sleep,type AccountKey} from "../acceptance/common.ts";

const HARNESS=["scripts/video/verify-walkthrough.ts","scripts/video/record-walkthrough.ts","scripts/video/ocr.swift","scripts/acceptance/common.ts","scripts/evidence/lib.ts"];
const EXPECTED_STEPS=["sign-in","realtime","tools-grounding","retail-math","honesty","memory","isolation","injection","refresh","reconnect","valley","close"];
const REDACTION_CSS='.sidebarfooter small,input[type="email"]{filter:blur(7px)}';
const PANE={width:960,height:900},FOOTER={x:0,y:700,w:250,h:200};
const SAMPLE_FPS=2,MAX_SECONDS=300,OCR_WORKERS=4;
const args=process.argv.slice(2);
const DIR=path.resolve(args.includes("--dir")?args[args.indexOf("--dir")+1]!:"qa_evidence/scratch/video");
const VIDEO=path.join(DIR,"teamchat-ai-walkthrough.mp4");
const WORK=fs.mkdtempSync(path.join(os.tmpdir(),"tc-video-verify-"));
const OCR=path.join(WORK,"ocr");
execFileSync("swiftc",["-O","scripts/video/ocr.swift","-o",OCR]);
const ff=(...a:string[])=>execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-y",...a]);

const {sourceSha,deployment}=bindDeployment();
const run=new RunRecorder({suite:"video",environment:`production: ${APP_URL} + ${API_URL}`,sourceSha,deployment,harnessFiles:HARNESS,
 ...(args.includes("--dry-run")?{runsDir:"qa_evidence/scratch/dry-runs"}:{})});

type Finding={kind:string;frame:string};
/** Passwords match on any 8-character window, so one misread character elsewhere cannot hide them;
 * account names match whole, because their fragments ("orthside") are ordinary caption words. */
type Secret={kind:string;value:string;windowed:boolean};
/** OCR swaps lookalike glyphs (Cyrillic М for M, 0 for o, l for I), so text and secrets are folded the same way before matching. */
const LOOKALIKE:Record<string,string>={"А":"a","В":"b","Е":"e","К":"k","М":"m","Н":"h","О":"o","Р":"p","С":"c","Т":"t","Х":"x","а":"a","е":"e","о":"o","р":"p",
 "с":"c","у":"y","х":"x","і":"i","Α":"a","Β":"b","Ε":"e","Ι":"i","Κ":"k","Μ":"m","Ν":"n","Ο":"o","Ρ":"p","Τ":"t","Χ":"x","Ζ":"z"};
const fold=(s:string)=>[...s.normalize("NFKC").replace(/\s+/g,"")].map(c=>LOOKALIKE[c]??c).join("").toLowerCase()
 .replace(/[o0]/g,"0").replace(/[il1|!]/g,"1").replace(/[s5]/g,"5").replace(/[z2]/g,"2").replace(/_/g,"-");
const windows=(s:Secret)=>{const v=fold(s.value);return !s.windowed||v.length<=8?[v]:Array.from({length:v.length-7},(_,i)=>v.slice(i,i+8));};
const PATTERNS:Array<[string,RegExp]>=[
 ["email",/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g],
 ["internal-domain",/teamchat\.internal/gi],
 ["jwt",/eyJ[A-Za-z0-9_-]{8,}/g],
 ["google-api-key",/AIza[0-9A-Za-z_-]{20,}/g]];

function scan(text:string,secrets:Secret[]):{kinds:string[];redacted:string}{
 const kinds=new Set<string>();let lines=text.split("\n");
 for(const [kind,re] of PATTERNS){if(re.test(text)){kinds.add(kind);lines=lines.map(l=>l.replace(re,`[REDACTED:${kind}]`));}re.lastIndex=0;}
 const whole=fold(text);
 for(const s of secrets){
  const w=windows(s);if(!w.some(x=>whole.includes(x)))continue;
  kinds.add(s.kind);let hit=false;
  lines=lines.map(l=>w.some(x=>fold(l).includes(x))?(hit=true,`[REDACTED:${s.kind}]`):l);
  if(!hit)lines=[`[REDACTED:${s.kind} spans lines; frame text withheld]`];
 }
 return {kinds:[...kinds].sort(),redacted:lines.join("\n")};
}
async function sampleAndOcr(video:string,label:string):Promise<Array<{frame:string;seconds:number;text:string}>>{
 const dir=path.join(WORK,label);fs.mkdirSync(dir,{recursive:true});
 ff("-i",video,"-vf",`fps=${SAMPLE_FPS}`,path.join(dir,"%05d.png"));
 const frames=fs.readdirSync(dir).filter(f=>f.endsWith(".png")).sort().map(f=>path.join(dir,f));
 const batches=Array.from({length:Math.ceil(frames.length/8)},(_,i)=>frames.slice(i*8,i*8+8));
 const out:Array<{frame:string;seconds:number;text:string}>=[];
 const worker=async()=>{
  for(let b=batches.shift();b;b=batches.shift()){
   const {stdout}=await promisify(execFile)(OCR,b,{encoding:"utf8",maxBuffer:64<<20});
   for(const line of stdout.trim().split("\n")){const r=JSON.parse(line) as {path:string;text:string};const n=Number(path.basename(r.path,".png"));
    out.push({frame:path.basename(r.path),seconds:+((n-0.5)/SAMPLE_FPS).toFixed(2),text:r.text});}
  }
 };
 await Promise.all(Array.from({length:OCR_WORKERS},worker));
 return out.sort((a,b)=>a.frame.localeCompare(b.frame));
}
function ffprobe(file:string){
 return JSON.parse(execFileSync("ffprobe",["-v","error","-show_entries","format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_frames","-of","json",file],{encoding:"utf8"}));
}
/** Crops one region at each time from both panes, enlarged 3x, and tiles them into one image. */
function cropSheet(video:string,times:number[],box:{x:number;y:number;w:number;h:number},out:string){
 const dir=fs.mkdtempSync(path.join(WORK,"crops-"));let i=0;
 for(const at of times)for(const pane of [0,1])
  ff("-ss",at.toFixed(2),"-i",video,"-frames:v","1","-vf",`crop=${box.w}:${box.h}:${box.x+pane*PANE.width}:${box.y},scale=iw*3:ih*3:flags=lanczos`,path.join(dir,`${String(i++).padStart(3,"0")}.png`));
 ff("-framerate","1","-i",path.join(dir,"%03d.png"),"-vf",`tile=2x${times.length}:padding=6:color=red`,"-frames:v","1","-q:v","3",out);
}

try{
 await run.run("DEMO-VIDEO","Captioned walkthrough: <=5 min, 1080p H.264, bound to the deployed build, no credentials or addresses readable",["D06"],async t=>{
  if(!fs.existsSync(VIDEO))throw Error(`No video at ${VIDEO}; run scripts/video/record-walkthrough.ts first`);
  const timeline=JSON.parse(fs.readFileSync(path.join(DIR,"timeline.json"),"utf8"));
  const fileSha=sha256File(VIDEO),probe=ffprobe(VIDEO);
  const v=probe.streams.find((s:any)=>s.codec_type==="video"),duration=Number(probe.format.duration);
  t.detail("video",{sha256:fileSha,bytes:Number(probe.format.size),durationSeconds:duration,codec:v?.codec_name,width:v?.width,height:v?.height,pixFmt:v?.pix_fmt,frameRate:v?.r_frame_rate,audioStreams:probe.streams.filter((s:any)=>s.codec_type==="audio").length});
  fs.copyFileSync(path.join(DIR,"timeline.json"),path.join(t.dir,"timeline.json"));t.artifact("timeline.json","Recorder timeline: captions, speed-ups, steps, bound deployment, output checksum");
  t.writeJson("ffprobe.json",probe,"ffprobe of the published file");
  t.assert("duration is at most 5 minutes",duration>0&&duration<=MAX_SECONDS,`<=${MAX_SECONDS}s`,duration);
  t.assert("1920x1080 H.264 yuv420p",v?.codec_name==="h264"&&v.width===1920&&v.height===1080&&v.pix_fmt==="yuv420p","h264 1920x1080 yuv420p",[v?.codec_name,v?.width,v?.height,v?.pix_fmt]);
  t.assert("file checksum equals the recorder's",fileSha===timeline.sha256,timeline.sha256,fileSha);
  t.assert("recorded against the source under test",timeline.sourceSha===sourceSha,sourceSha,timeline.sourceSha);
  t.assert("recorded against the live API and worker images",timeline.deployment?.apiDigest===deployment.apiDigest&&timeline.deployment?.workerDigest===deployment.workerDigest,
   [deployment.apiDigest,deployment.workerDigest],[timeline.deployment?.apiDigest,timeline.deployment?.workerDigest]);
  t.assert("every scripted step completed",JSON.stringify(timeline.steps)===JSON.stringify(EXPECTED_STEPS),EXPECTED_STEPS,timeline.steps);
  t.assert("the recorder applies the redaction rule the controls test",fs.readFileSync("scripts/video/record-walkthrough.ts","utf8").includes(REDACTION_CSS),REDACTION_CSS,"see scripts/video/record-walkthrough.ts");

  const secrets:Secret[]=(Object.keys(ACCOUNTS) as AccountKey[]).flatMap(k=>[
   {kind:`password:${k}`,value:keychainPassword(ACCOUNTS[k].email),windowed:true},
   {kind:`account:${k}`,value:ACCOUNTS[k].email.split("@")[0]!,windowed:false}]);
  const frames=await sampleAndOcr(VIDEO,"walkthrough");
  const results=frames.map(f=>({...f,...scan(f.text,secrets)}));
  const findings:Finding[]=results.flatMap(r=>r.kinds.map(kind=>({kind,frame:`${r.frame} (~${r.seconds}s)`})));
  fs.writeFileSync(path.join(t.dir,"ocr.jsonl"),results.map(r=>JSON.stringify({frame:r.frame,seconds:r.seconds,findings:r.kinds,text:r.redacted})).join("\n")+"\n");
  t.artifact("ocr.jsonl","OCR text (whole frame plus overlapping tiles) of every sampled frame; matches redacted before writing");
  t.detail("scan",{sampledFrames:frames.length,sampleFps:SAMPLE_FPS,ocr:"whole frame plus 21 overlapping quarter-width, half-height tiles",
   secretsChecked:secrets.map(s=>s.kind),patterns:PATTERNS.map(([k,re])=>`${k}: ${re.source}`),findings,
   charactersRead:results.reduce((n,r)=>n+r.text.length,0)});
  t.assert("OCR read text from every sampled frame",results.every(r=>r.text.trim().length>0),frames.length,results.filter(r=>r.text.trim().length>0).length);
  t.assert("no password, account name, e-mail address, JWT or API key is readable in any sampled frame",findings.length===0,[],findings.slice(0,20));

  const all=results.map(r=>r.text.replace(/\s+/g," ")).join("\n");
  /** OCR reads "AI" as "Al"; I and l are folded together so that lookalike cannot fail a caption. */
  const norm=(s:string)=>s.toLowerCase().replace(/l/g,"i").replace(/[^a-z0-9]/g,"");
  const missing=(timeline.captions as Array<{text:string}>).flatMap((c,i)=>{
   const head=`STEP ${i+1} OF ${timeline.captions.length}`,lead=norm(c.text.split("\n")[0]!).slice(0,40);
   return [...(all.includes(head)?[]:[head]),...(results.some(r=>norm(r.text).includes(lead))?[]:[`caption ${i+1}: ${c.text.split("\n")[0]}`])];
  });
  t.assert("every caption and its step header is legible in the video",missing.length===0,[],missing);

  const decoy={password:crypto.randomBytes(12).toString("base64url"),email:`decoy.${crypto.randomBytes(3).toString("hex")}@example.org`};
  const decoySecrets:Secret[]=[{kind:"password:decoy",value:decoy.password,windowed:true},{kind:"email:decoy",value:decoy.email,windowed:false}];
  const controls=await recordControls(decoy,t.dir);
  const plain=(await sampleAndOcr(controls.plain.video,"control-plain")).map(f=>scan(f.text,decoySecrets));
  const redacted=(await sampleAndOcr(controls.redacted.video,"control-redacted")).map(f=>scan(f.text,decoySecrets));
  t.detail("controls",{method:"deployed login page at the recorder's pane size, recorded by Playwright (VP8) and re-encoded with the recorder's libx264 settings; a decoy sidebar footer uses the app's own .sidebarfooter styles",
   plain:{setup:"no redaction; password input switched to type=text",renderedSizes:controls.plain.sizes,findings:plain.map(s=>s.kinds),ocr:plain.map(s=>s.redacted)},
   redacted:{setup:`recorder redaction CSS (${REDACTION_CSS}); password input left masked`,renderedSizes:controls.redacted.sizes,findings:redacted.map(s=>s.kinds),ocr:redacted.map(s=>s.redacted)},
   decoyValuesAreRandomAndUnused:true});
  t.artifact("control-plain.png","Positive control frame: decoy credentials visible");
  t.artifact("control-redacted.png","Redaction control frame: same decoy credentials under the recorder's redaction");
  t.assert("positive control: the planted e-mail and password are found in every sampled frame",plain.length>0&&plain.every(k=>k.kinds.includes("password:decoy")&&k.kinds.includes("email:decoy")),
   "password:decoy and email:decoy in all frames",plain.map(s=>s.kinds));
  const plainType=(controls.plain.sizes as Record<string,{type:string|null}>)['input[autocomplete="current-password"]']?.type;
  t.assert("positive control: the planted password is rendered unmasked",plainType==="text"&&controls.plain.passwordFilled,"type=text with value",{type:plainType,filled:controls.plain.passwordFilled});
  const maskedType=(controls.redacted.sizes as Record<string,{type:string|null}>)['input[autocomplete="current-password"]']?.type;
  t.assert("redaction control: the password input holds the decoy but stays masked",maskedType==="password"&&controls.redacted.passwordFilled,"type=password with value",{type:maskedType,filled:controls.redacted.passwordFilled});
  t.assert("redaction control: the same planted values are unreadable in every sampled frame",redacted.length>0&&redacted.every(k=>k.kinds.length===0),[],redacted.map(s=>s.kinds));

  const signIn=timeline.captions[0] as {fromSeconds:number;toSeconds:number};
  const signInTimes=Array.from({length:8},(_,i)=>signIn.fromSeconds+0.5+i*(signIn.toSeconds-signIn.fromSeconds-1)/7);
  cropSheet(VIDEO,signInTimes,controls.emailBox,path.join(t.dir,"crops-email-field.jpg"));
  t.artifact("crops-email-field.jpg","E-mail field of both panes during sign-in, 3x, for visual review");
  /** Caption times are recording time; the published cut is sped up per speedSegments. */
  const toOutput=(s:number)=>(timeline.speedSegments as Array<{fromSeconds:number;toSeconds:number;speed:number}>)
   .reduce((o,g)=>o+Math.max(0,Math.min(s,g.toSeconds)-g.fromSeconds)/g.speed,0);
  const valley=(timeline.captions as Array<{cast:string;fromSeconds:number;toSeconds:number}>).find(c=>c.cast.includes("VALLEY"))!;
  const [vFrom,vTo]=[toOutput(valley.fromSeconds),toOutput(valley.toSeconds)];
  cropSheet(VIDEO,Array.from({length:8},(_,i)=>vFrom+0.25+i*(vTo-vFrom-0.5)/7),controls.emailBox,path.join(t.dir,"crops-email-field-valley.jpg"));
  t.artifact("crops-email-field-valley.jpg","E-mail field of both panes while the right pane re-signs in as Valley, 3x, for visual review");
  const footerTimes=Array.from({length:10},(_,i)=>signIn.toSeconds+(i+0.5)*(duration-signIn.toSeconds)/10);
  cropSheet(VIDEO,footerTimes,FOOTER,path.join(t.dir,"crops-sidebar-footer.jpg"));
  t.artifact("crops-sidebar-footer.jpg","Signed-in account footer of both panes across the video, 3x, for visual review");
  const sheet=path.join(t.dir,"contact-sheet.jpg");
  ff("-i",VIDEO,"-vf",`fps=12/${Math.ceil(duration)},scale=480:-1,tile=4x3`,"-frames:v","1","-q:v","4",sheet);
  t.artifact("contact-sheet.jpg","Twelve evenly spaced frames from the published video");

  const url=process.env.VIDEO_URL;
  if(!url){t.block("VIDEO_URL not set: the public copy has not been verified");return;}
  let res!:Response,body=Buffer.alloc(0),attempts=0;
  for(;;){
   attempts++;
   try{res=await fetch(url,{redirect:"follow",headers:{"user-agent":"teamchat-ai-video-check"}});body=Buffer.from(await res.arrayBuffer());break;}
   catch(error){if(attempts>=3)throw error;await sleep(10_000);}
  }
  const copy=path.join(WORK,"published.mp4");fs.writeFileSync(copy,body);
  let decodeErrors="";
  try{decodeErrors=execFileSync("ffmpeg",["-hide_banner","-v","error","-i",copy,"-f","null","-"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}
  catch(error){decodeErrors=String((error as {stderr?:string}).stderr??error);}
  const decoded=res.ok?Number(ffprobe(copy).format.duration):0;
  t.detail("publicCopy",{url,finalHost:new URL(res.url).host,status:res.status,contentType:res.headers.get("content-type"),bytes:body.length,sha256:sha256(body),downloadAttempts:attempts,
   decodedDurationSeconds:decoded,decodeErrors,credentials:"none (no cookies or Authorization header)"});
  t.assert("anonymous download succeeds",res.status===200,200,res.status);
  t.assert("anonymously downloaded bytes equal the verified file",sha256(body)===fileSha,fileSha,sha256(body));
  t.assert("the downloaded copy decodes end to end without errors at the verified duration",decodeErrors.trim()===""&&Math.abs(decoded-duration)<0.1,duration,{decoded,decodeErrors:decodeErrors.slice(0,300)});
 });
}finally{
 run.finish();
 fs.rmSync(WORK,{recursive:true,force:true});
}

/** Records the deployed login page twice at pane size: decoys visible, then under the recorder's redaction. */
async function recordControls(decoy:{password:string;email:string},outDir:string){
 const browser=await chromium.launch();
 const one=async(redact:boolean)=>{
  const raw=fs.mkdtempSync(path.join(WORK,"ctl-"));
  const context=await browser.newContext({viewport:PANE,recordVideo:{dir:raw,size:PANE}});
  const started=Date.now();const page=await context.newPage();
  await page.goto(APP_URL,{waitUntil:"networkidle"});
  await page.evaluate(email=>{
   const aside=document.createElement("aside");aside.className="sidebar";aside.style.cssText="position:fixed;left:0;top:0;bottom:0;z-index:9";
   aside.innerHTML='<div class="sidebarfooter"><small></small><button class="signout">Sign out</button></div>';
   aside.querySelector("small")!.textContent=email;document.body.appendChild(aside);
  },decoy.email);
  const password='input[autocomplete="current-password"]';
  if(redact)await page.addStyleTag({content:REDACTION_CSS});
  await page.fill('input[type="email"]',decoy.email);
  await page.fill(password,decoy.password);
  // React re-applies type="password" on every render of the controlled input, so unmask only after the last fill.
  if(!redact)await page.evaluate(s=>{(document.querySelector(s) as HTMLInputElement).type="text";},password);
  const sizes=await page.evaluate(p=>Object.fromEntries(["input[type=email]",".sidebarfooter small",p].map(s=>{
   const e=document.querySelector(s)!;const cs=getComputedStyle(e);return [s,{fontSize:cs.fontSize,filter:cs.filter,type:(e as HTMLInputElement).type??null}];})),password);
  const passwordFilled=(await page.inputValue(password))===decoy.password;
  const box=(await page.locator('input[type="email"]').boundingBox())!;
  const ready=Date.now();await sleep(3500);
  const video=page.video()!;await context.close();
  const name=redact?"control-redacted":"control-plain",mp4=path.join(WORK,`${name}.mp4`);
  ff("-ss",((ready-started)/1000+0.5).toFixed(2),"-i",await video.path(),"-t","2.5","-vf","fps=25,pad=1920:1080:0:0:color=0x0f1d2e,format=yuv420p",
   "-c:v","libx264","-preset","medium","-crf","20",mp4);
  ff("-ss","1","-i",mp4,"-frames:v","1",path.join(outDir,`${name}.png`));
  return {video:mp4,sizes,box,passwordFilled};
 };
 try{
  const plain=await one(false),redacted=await one(true);
  const b=redacted.box,emailBox={x:Math.max(0,Math.floor(b.x)-10),y:Math.max(0,Math.floor(b.y)-10),w:Math.ceil(b.width)+20,h:Math.ceil(b.height)+20};
  return {plain,redacted,emailBox};
 }finally{await browser.close();}
}
