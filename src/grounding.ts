import {assertContext, type TenantContext} from "./tenant.ts";
import type {Product, Store, TeamMemory} from "./types.ts";

export type SourceKind="catalog"|"store"|"memory"|"calculation";
export type SourceRecord={kind:SourceKind;id:string;data:Record<string,unknown>};
export class SourceLedger {
  private records=new Map<string,SourceRecord>();
  private readonly ctx: TenantContext;
  public readonly turnId: string;
  constructor(ctx:TenantContext, turnId:string){assertContext(ctx);this.ctx=ctx;this.turnId=turnId;}
  add(kind:SourceKind,id:string,record:Product|Store|TeamMemory|Record<string,unknown>):string {
    const ref=`${this.turnId}:${this.ctx.tenantId}:${kind}:${id}`;
    this.records.set(ref,{kind,id,data:{...record}});return ref;
  }
  resolve(ref:string,field:string):unknown {
    const record=this.records.get(ref);
    if(!record || !Object.hasOwn(record.data,field)) throw new Error("Unsupported/unfetched source reference");
    return record.data[field];
  }
  /** The model supplies only template IDs and source/field refs; business values are resolved from fetched records. */
  render(block:{template:"catalog"|"store"|"memory"|"calculation";ref:string;fields:string[]}):{template:string,values:Record<string,unknown>,source:string} {
    if(block.fields.length>20) throw new Error("Too many fields");
    const record=this.records.get(block.ref);
    if(!record || record.kind!==block.template) throw new Error("Invalid template or source");
    const values:Record<string,unknown>={};for(const field of block.fields)values[field]=this.resolve(block.ref,field);
    return {template:block.template,values,source:block.ref};
  }
}
