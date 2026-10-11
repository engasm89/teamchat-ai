import {scoreStore, compareScores,compareAlternatives} from "./retail.ts";
import {rankMemoriesInTenant,parseMemoryValueJson} from "./memory.ts";
import {assertContext, NO_MATCH, type TenantContext} from "./tenant.ts";
import {FixtureRepository} from "./repository.ts";
import {SourceLedger} from "./grounding.ts";
import {normalizeCatalogCode,normalizeStoreId} from "./catalog-search.ts";
import type {FixtureSet} from "./types.ts";

/** Provider-independent tool schema. Only Gemini should select which tools to call. */
export const TOOL_DECLARATIONS = [
  {name:"search_catalog",description:"Search the verified product catalog by description, abbreviation or family.",parameters:{type:"OBJECT",properties:{query:{type:"STRING"},limit:{type:"INTEGER"}},required:["query"]}},
  {name:"get_catalog_code",description:"Retrieve one exact, existing catalog code and its verified metadata.",parameters:{type:"OBJECT",properties:{catalog_code:{type:"STRING"}},required:["catalog_code"]}},
  {name:"get_store_assortment",description:"Return carried codes, suspected gaps, store context and evidence for an authorized store.",parameters:{type:"OBJECT",properties:{store_id:{type:"STRING"}},required:["store_id"]}},
  {name:"calculate_uplift",description:"Compare deterministic dimensionless assortment coefficient scores for an authorized store, before and after adding a set of existing codes together. To price several additions (for example closing every gap), pass all of them in one call. No sales/money baseline may be invented by Gemini.",parameters:{type:"OBJECT",properties:{store_id:{type:"STRING"},add_codes:{type:"ARRAY",items:{type:"STRING"},description:"Every existing catalog code to add, all together in this one call"}},required:["store_id","add_codes"]}},
  {name:"compare_assortment_options",description:"Compare two alternative proposed catalog-code additions for the SAME authorized store, with arithmetic performed on the server and a direct B-minus-A score difference. Not a sales forecast.",parameters:{type:"OBJECT",properties:{store_id:{type:"STRING"},option_a_codes:{type:"ARRAY",items:{type:"STRING"}},option_b_codes:{type:"ARRAY",items:{type:"STRING"}}},required:["store_id","option_a_codes","option_b_codes"]}},
  {name:"search_memory",description:"Find previous decisions recorded within the current organization, including source and attribution.",parameters:{type:"OBJECT",properties:{query:{type:"STRING"}},required:["query"]}},
  {name:"save_memory",description:"Save a flat tenant-shared decision with explicit user consent; nested structures are rejected.",parameters:{type:"OBJECT",properties:{key:{type:"STRING"},value_json:{type:"STRING",description:"The details to remember, as the text of a JSON object mapping field names to values"},room:{type:"STRING"}},required:["key","value_json","room"]}}
] as const;
export type ToolName=typeof TOOL_DECLARATIONS[number]["name"];

function plainArgs(args:unknown,keys:string[]):Record<string,unknown> {
  if(!args||typeof args!=="object"||Array.isArray(args))throw new Error("Tool arguments must be an object");
  const val=args as Record<string,unknown>;
  if(Object.keys(val).some(k=>!keys.includes(k)))throw new Error("Unsupported tool argument (including forbidden tenant override)");
  return val;
}
function stringArg(v:unknown,key:string):string {
  if(typeof v!=="string"||!v.trim()||v.length>256)throw new Error(`Invalid argument ${key}`);
  return v;
}
function codeList(v:unknown):string[] {
  if(!Array.isArray(v)||v.length>30||v.some(x=>typeof x!=="string"||!normalizeCatalogCode(x)))throw new Error("Invalid add_codes");
  return (v as string[]).map(x=>normalizeCatalogCode(x)!);
}
export class LocalToolExecutor {
  private readonly repo:FixtureRepository;
  private readonly fixtures:FixtureSet;
  constructor(fixtures:FixtureSet,repo?:FixtureRepository){this.fixtures=fixtures;this.repo=repo??new FixtureRepository(fixtures);}
  async execute(ctx:TenantContext,name:ToolName,args:unknown,ledger:SourceLedger, consentForSave=false):Promise<unknown> {
    assertContext(ctx);
    switch(name) {
      case "search_catalog": {
        const a=plainArgs(args,["query","limit"]);const q=stringArg(a.query,"query");
        const limit=a.limit===undefined?10:a.limit;
        if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>25)throw new Error("Invalid limit");
        return this.repo.searchCatalog(ctx,q,Number(limit)).map(p=>({ref:ledger.add("catalog",p.catalog_code,p),catalog_code:p.catalog_code,description:p.description,margin_class:p.margin_class}));
      }
      case "get_catalog_code": {
        const a=plainArgs(args,["catalog_code"]);const code=stringArg(a.catalog_code,"catalog_code");
        const product=this.repo.getProduct(ctx,code);return "catalog_code" in product ? {ref:ledger.add("catalog",product.catalog_code,product),product}:NO_MATCH;
      }
      case "get_store_assortment": {
        const a=plainArgs(args,["store_id"]);const store=this.repo.getStore(ctx,stringArg(a.store_id,"store_id"));
        return "store_id" in store ? {ref:ledger.add("store",store.store_id,store),store}:NO_MATCH;
      }
      case "calculate_uplift": {
        const a=plainArgs(args,["store_id","add_codes"]);const storeId=normalizeStoreId(stringArg(a.store_id,"store_id"));if(!storeId)return NO_MATCH;
        const store=this.repo.getStore(ctx,storeId);if(!("store_id" in store))return NO_MATCH;
        const additions=codeList(a.add_codes);
        // No dynamic references outside supplied catalog; no fabricated product IDs.
        for(const code of additions){const p=this.repo.getProduct(ctx,code);if(!("catalog_code" in p))return NO_MATCH;ledger.add("catalog",p.catalog_code,p);}
        const before=scoreStore(this.fixtures,ctx.tenantId,storeId)!,after=scoreStore(this.fixtures,ctx.tenantId,storeId,additions)!;
        const result=compareScores(before,after);
        const ref=ledger.add("calculation",storeId,{...result,assumed_rule_version:"1",before,after,store_ref:ledger.add("store",storeId,store)});
        return {ref,result,before,after};
      }
      case "compare_assortment_options": {
        const a=plainArgs(args,["store_id","option_a_codes","option_b_codes"]);
        const storeId=normalizeStoreId(stringArg(a.store_id,"store_id"));if(!storeId)return NO_MATCH;
        const store=this.repo.getStore(ctx,storeId);if(!("store_id" in store))return NO_MATCH;
        const codesA=codeList(a.option_a_codes),codesB=codeList(a.option_b_codes);
        for(const code of [...new Set([...codesA,...codesB])]){
          const p=this.repo.getProduct(ctx,code);if(!("catalog_code" in p))return NO_MATCH;
          ledger.add("catalog",p.catalog_code,p);
        }
        const before=scoreStore(this.fixtures,ctx.tenantId,storeId)!;
        const optionA=scoreStore(this.fixtures,ctx.tenantId,storeId,codesA)!;
        const optionB=scoreStore(this.fixtures,ctx.tenantId,storeId,codesB)!;
        const comparison=compareAlternatives(before,optionA,optionB);
        const ref=ledger.add("calculation",`${storeId}:alternatives`,{...comparison,store_id:storeId,codes_a:codesA,codes_b:codesB,assumed_rule_version:"1"});
        return {ref,store_id:storeId,codes_a:codesA,codes_b:codesB,comparison};
      }
      case "search_memory": {
        const a=plainArgs(args,["query"]);const query=stringArg(a.query,"query");
        return rankMemoriesInTenant(this.repo.listMemories(ctx),query).slice(0,5).map(m=>({ref:ledger.add("memory",m.memory_id,m),memory:m}));
      }
      case "save_memory": {
        const a=plainArgs(args,["key","value_json","room"]);
        if(!consentForSave)throw new Error("Explicit user consent required to store tenant-shared memory");
        const key=stringArg(a.key,"key"),room=stringArg(a.room,"room");
        const parsed=parseMemoryValueJson(a.value_json);
        if(!parsed.ok)throw new Error(`Invalid memory: ${JSON.stringify(parsed.errors)}`);
        const saved=this.repo.saveMemory(ctx,{key,room,value:parsed.value},new Date().toISOString());
        return {ref:ledger.add("memory",saved.memory_id,saved),memory:saved};
      }
      default: throw new Error("Undeclared tool");
    }
  }
}
