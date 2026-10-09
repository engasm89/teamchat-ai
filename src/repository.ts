import type {FixtureSet, Product, Store, TeamMemory} from "./types.ts";
import {assertContext, NO_MATCH, type TenantContext} from "./tenant.ts";
import {validateMemoryValue} from "./memory.ts";

/** Local domain test adapter. DO NOT use as production persistence or trust its in-memory membership model. */
export class FixtureRepository {
  private memories: Record<string, TeamMemory[]>;
  private readonly fixtures: FixtureSet;
  constructor(fixtures: FixtureSet) {
    this.fixtures = fixtures;
    this.memories = Object.fromEntries(Object.entries(fixtures.memoriesByTenant).map(([k,v])=>[k,[...v]]));
  }
  getStore(ctx: TenantContext, storeId: string): Store | typeof NO_MATCH {
    assertContext(ctx);
    return this.fixtures.storesByTenant[ctx.tenantId].find(s=>s.store_id===storeId) ?? NO_MATCH;
  }
  getProduct(ctx: TenantContext, code: string): Product | typeof NO_MATCH {
    assertContext(ctx);
    return this.fixtures.productRows.find(p=>p.catalog_code===code) ?? NO_MATCH; // identical fixture, tenant scope asserted
  }
  searchCatalog(ctx: TenantContext, search: string, limit=10): Product[] {
    assertContext(ctx);
    const alias: Record<string,string>={ac:"air conditioners",ssd:"solid state drive",hba:"host bus adapter",rtw:"ready to wear",diy:"do it yourself"};
    const q = search.trim().toLowerCase(); if(!q || q.length>256) return [];
    const terms=q.split(/\W+/).filter(Boolean).flatMap(t=>[t,alias[t]??t]);
    return this.fixtures.productRows.map(p=>{
      const content=`${p.description} ${p.product_family} ${p.catalog_code} ${p.department}`.toLowerCase();
      const score=terms.filter(t=>content.includes(t)).length;
      return {p,score};
    }).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.p.catalog_code.localeCompare(b.p.catalog_code)).slice(0,Math.min(Math.max(limit,1),25)).map(x=>x.p);
  }
  getMemory(ctx:TenantContext,key:string):TeamMemory|typeof NO_MATCH {
    assertContext(ctx); return this.memories[ctx.tenantId]!.find(m=>m.key===key)??NO_MATCH;
  }
  listMemories(ctx:TenantContext):TeamMemory[] {
    assertContext(ctx);return [...this.memories[ctx.tenantId]!];
  }
  saveMemory(ctx:TenantContext,input:{key:string;value:unknown;room:string},timestamp:string):TeamMemory {
    assertContext(ctx);
    const checked=validateMemoryValue(input.value);
    if(!checked.ok) throw new Error(`Invalid memory: ${JSON.stringify(checked.errors)}`);
    if(!/^[a-z][a-z0-9_]{0,63}$/.test(input.key)) throw new Error("Invalid key");
    if(this.memories[ctx.tenantId]!.some(m=>m.key===input.key)) throw new Error("Memory key conflict; version required");
    const saved={memory_id:`local-${crypto.randomUUID()}`, key:input.key,value:checked.value,
      created_by:ctx.uid,created_at:timestamp,room:input.room};
    this.memories[ctx.tenantId]!.push(saved); return saved;
  }
}
