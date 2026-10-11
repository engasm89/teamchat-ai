/** Batch B experiment: do Playwright setOffline and CDP offline emulation
 * flip navigator.onLine and dispatch window offline/online events?
 * Writes qa_evidence/experiments/online-events.json. */
import fs from "node:fs";
import {chromium} from "playwright";
import {utcNow} from "../evidence/lib.ts";

const APP=process.env.APP_URL??"https://focus-clean-4b9f4.web.app";
const browser=await chromium.launch();
const result:Record<string,unknown>={startedAt:utcNow(),app:APP};
try{
 for(const mode of ["setOffline","cdp"] as const){
  const context=await browser.newContext();const page=await context.newPage();
  await page.goto(APP);
  await page.evaluate(()=>{const w=window as any;w.__events=[];
   addEventListener("offline",()=>w.__events.push("offline"));addEventListener("online",()=>w.__events.push("online"));});
  const cdp=mode==="cdp"?await context.newCDPSession(page):null;
  if(cdp)await cdp.send("Network.enable");
  const set=async(offline:boolean)=>cdp
   ?void await cdp.send("Network.emulateNetworkConditions",{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1})
   :context.setOffline(offline);
  await set(true);await page.waitForTimeout(500);
  const onLineWhileOffline=await page.evaluate(()=>navigator.onLine);
  await set(false);await page.waitForTimeout(500);
  result[mode]={onLineWhileOffline,events:await page.evaluate(()=>(window as any).__events)};
  await context.close();
 }
}finally{await browser.close();}
result.finishedAt=utcNow();
fs.mkdirSync("qa_evidence/experiments",{recursive:true});
fs.writeFileSync("qa_evidence/experiments/online-events.json",JSON.stringify(result,null,1)+"\n");
console.log(JSON.stringify(result));
