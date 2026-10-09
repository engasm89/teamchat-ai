import type {FixtureSet, Product, Store, TeamMemory} from "./types.ts";
import {assertContext, NO_MATCH, type TenantContext} from "./tenant.ts";
import {validateMemoryValue} from "./memory.ts";
import {rankCatalog,normalizeCatalogCode,normalizeStoreId} from "./catalog-search.ts";

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
    return this.fixtures.storesByTenant[ctx.tenantId].find(s=>s.store_id===normalizeStoreId(storeId)) ?? NO_MATCH;
  }
  getProduct(ctx: TenantContext, code: string): Product | typeof NO_MATCH {
    assertContext(ctx);
    return this.fixtures.productRows.find(p=>p.catalog_code===normalizeCatalogCode(code)) ?? NO_MATCH; // identical fixture, tenant scope asserted
  }
  searchCatalog(ctx: TenantContext, search: string, limit=10): Product[] {
    assertContext(ctx);
    if(!search.trim()||search.length>256)return [];
    return rankCatalog(this.fixtures.productRows,search,limit);
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
