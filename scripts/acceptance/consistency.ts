/** Sentence-level consistency between a visible answer and the verified
 * calculate_uplift result(s) it sits beside. Pure and independent of src/: the
 * application's own claim checks must not also be the thing that grades them.
 * Every visible sentence (fact, say and fallback text alike) is checked, so a
 * free-text sentence cannot contradict the verified figures next to it. */

export interface UpliftResult {
 before?:{score?:string};
 after?:{score?:string;retained?:string[];removed?:string[];multiplier?:string};
 result?:{delta?:string;baseline?:string;proposed?:string};
}
export interface Contradiction {rule:string;sentence:string;detail:string}

const CATALOG_CODE=/\b[A-Z]{3}-\d{3}\.\d{2}\b/g;
const STORE_ID=/\bST-\d+\b/g;
const CLASS_TOKEN=/(?<![\d.,-])\b\d{3,4}\b(?![.,]\d)/g;
const DECIMAL=/[+-]?\d+\.\d{4,}/g;

/** "supersede", "superseded", "supersedes", "supersession". */
const SUPERSEDE="supers(?:ed|ess)";
const NEGATION=/\b(?:no|not|none|never|without|neither|nor|nothing)\b|n't\b/i;
const DENIES_SUPERSESSION=[
 `\\bno\\s+(?:\\w+\\s+){0,3}${SUPERSEDE}`,
 `\\bwithout\\s+(?:\\w+\\s+){0,3}${SUPERSEDE}`,
 `\\bnothing\\s+(?:\\w+\\s+){0,2}${SUPERSEDE}`,
 `\\bnone\\s+(?:\\w+\\s+){0,4}(?:is|are|was|were|gets?|got)\\s+${SUPERSEDE}`,
 `\\b(?:is|are|was|were|be|been)\\s+not\\s+(?:\\w+\\s+){0,1}${SUPERSEDE}`,
 `\\b(?:isn't|aren't|wasn't|weren't|won't|never)\\s+(?:\\w+\\s+){0,2}${SUPERSEDE}`,
 `${SUPERSEDE}\\w*\\s+(?:\\w+\\s+){0,2}(?:does|do|did|will)\\s*(?:not|n't)\\s+(?:apply|occur|happen)`,
 `${SUPERSEDE}\\w*(?:\\s+classes?)?\\s*[:—-]\\s*(?:none|n\\/a|nil|\\[\\s*\\])`,
].map(p=>new RegExp(p,"i"));
const MENTIONS_SUPERSESSION=new RegExp(SUPERSEDE,"i");
const CLAIMS_SUPERSESSION=new RegExp(`\\b(?:is|are|was|were|gets?|got|been)\\s+${SUPERSEDE}`,"i");
const MONEY=/[$€£¥]\s?\d|\b\d[\d,.]*\s?(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b|\b(?:USD|EUR|GBP)\s?\d/i;
const FORECAST=/\b(?:forecast\w*|revenue|profit\w*|turnover|sales\s+(?:uplift|lift|increase|growth|impact|gain))\b/i;
const SCORE_TOPIC=/\b(?:score|coefficient|difference|delta)\b/i;
const NO_CHANGE=/\b(?:no\s+change|unchanged|(?:does|did|will)\s*(?:not|n't)\s+change|stays?\s+the\s+same|remains?\s+(?:the\s+same|unchanged)|no\s+(?:difference|effect|impact))\b/i;
const UP=/\b(?:increase[sd]?|increasing|rises?|rising|rose|raises?|raised|improves?|improved|boosts?|boosted|grows?|grew|higher|goes\s+up|went\s+up)\b/i;
const DOWN=/\b(?:decrease[sd]?|decreasing|drops?|dropped|falls?|fell|lowers?|lowered|reduces?|reduced|declines?|declined|goes\s+down|went\s+down)\b/i;

export function sentences(text:string):string[]{
 return text.split(/\n+|(?<=[.!?;])\s+/).map(s=>s.trim()).filter(Boolean);
}

function classesIn(sentence:string):string[]{
 return [...sentence.replace(CATALOG_CODE," ").replace(STORE_ID," ").matchAll(CLASS_TOKEN)].map(m=>m[0]);
}
const sameSet=(a:string[],b:string[])=>a.length===b.length&&[...a].sort().join()===[...b].sort().join();
const unsigned=(n:string)=>n.replace(/^[+-]/,"");

function sentenceContradictions(s:string,calc:UpliftResult):Contradiction[]{
 const removed=calc.after?.removed??[],retained=calc.after?.retained??[];
 const delta=Number(calc.result?.delta??NaN);
 const allowed=new Set([calc.before?.score,calc.after?.score,calc.result?.delta,calc.result?.baseline,calc.result?.proposed,calc.after?.multiplier]
  .filter((n):n is string=>typeof n==="string").map(unsigned));
 const out:Contradiction[]=[];
 const flag=(rule:string,detail:string)=>out.push({rule,sentence:s,detail});
 const mentionsSupersession=MENTIONS_SUPERSESSION.test(s);
 if(mentionsSupersession&&removed.length&&DENIES_SUPERSESSION.some(r=>r.test(s)))
  flag("denies supersession",`verified superseded classes: ${removed.join(", ")}`);
 const supersededList=/superseded\s+classes?\s*[:—-]\s*(.*)$/i.exec(s);
 const retainedList=/retained\s+classes?\s*[:—-]\s*(.*)$/i.exec(s);
 if(supersededList&&!sameSet(classesIn(supersededList[1]!),removed))
  flag("wrong superseded set",`verified: [${removed.join(", ")}], shown: [${classesIn(supersededList[1]!).join(", ")}]`);
 const retainedShown=retainedList?classesIn(retainedList[1]!.split(/superseded/i)[0]!):[];
 if(retainedList&&!sameSet(retainedShown,retained))
  flag("wrong retained set",`verified: [${retained.join(", ")}], shown: [${retainedShown.join(", ")}]`);
 if(mentionsSupersession&&!supersededList&&!retainedList&&!NEGATION.test(s)){
  const subject=s.split(/\b(?:is|are)\s+superseded\b/i)[0]??s;
  const named=classesIn(subject);
  if(named.length&&named.some(c=>!removed.includes(c)))
   flag("wrong superseded set",`names classes [${named.join(", ")}] as superseded; verified: [${removed.join(", ")}]`);
  if(!removed.length&&!named.length&&CLAIMS_SUPERSESSION.test(s))
   flag("claims supersession","verified result supersedes no class");
 }
 if(MONEY.test(s))flag("money figure","the score is a dimensionless coefficient");
 if(FORECAST.test(s)&&!NEGATION.test(s))flag("forecast claim","the score is not a sales forecast");
 if(SCORE_TOPIC.test(s)&&Number.isFinite(delta)){
  const negated=NEGATION.test(s);
  if(delta!==0&&NO_CHANGE.test(s))flag("claims no change",`verified delta ${calc.result?.delta}`);
  if(delta===0&&!negated&&(UP.test(s)||DOWN.test(s)))flag("claims a change","verified delta 0.000000");
  if(delta>0&&!negated&&DOWN.test(s)&&!UP.test(s))flag("wrong direction",`verified delta ${calc.result?.delta}`);
  if(delta<0&&!negated&&UP.test(s)&&!DOWN.test(s))flag("wrong direction",`verified delta ${calc.result?.delta}`);
  for(const n of s.match(DECIMAL)??[])if(!allowed.has(unsigned(n)))flag("unverified figure",`${n} is not a verified figure`);
 }
 return out;
}

/** Every sentence that contradicts the verified result; empty means consistent.
 * With several calculations in one turn, a sentence passes when it is
 * consistent with at least one of them. */
export function upliftContradictions(text:string,calcs:UpliftResult|UpliftResult[]):Contradiction[]{
 const list=Array.isArray(calcs)?calcs:[calcs];
 if(!list.length)return [];
 return sentences(text).flatMap(s=>{
  const per=list.map(c=>sentenceContradictions(s,c));
  return per.every(p=>p.length)?per[0]!:[];
 });
}
