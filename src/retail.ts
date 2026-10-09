import type { FixtureSet, Store, TenantId } from "./types.ts";

const SCALE = 1_000_000n;
/** Fixed-scale decimal arithmetic. Input values are restricted fixture decimals. */
export function decimalMicro(input: string): bigint {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(input)) throw new Error(`Invalid decimal ${input}`);
  const negative = input.startsWith("-");
  const [whole, frac = ""] = (negative ? input.slice(1) : input).split(".");
  const raw = BigInt(whole!) * SCALE + BigInt(frac.padEnd(6, "0"));
  return negative ? -raw : raw;
}
export function formatMicro(value: bigint): string {
  const s = value < 0n ? "-" : ""; const abs = value < 0n ? -value : value;
  return `${s}${abs / SCALE}.${(abs % SCALE).toString().padStart(6, "0")}`;
}
/** Half away from zero when multiplying two fixed-scale factors. */
export function multiplyMicro(a: bigint, b: bigint): bigint {
  const numerator = a * b;
  if (numerator < 0n) return -((-numerator + SCALE / 2n) / SCALE);
  return (numerator + SCALE / 2n) / SCALE;
}
export function retainedClasses(allClasses: Set<string>, supersedes: Map<string, string[]>): {retained: string[], removed: string[]} {
  for (const c of allClasses) if (!supersedes.has(c)) throw new Error(`Class ${c} missing`);
  const excluded = new Set<string>();
  for (const source of allClasses) {
    const visit = (node: string, path: Set<string>) => {
      if (path.has(node)) throw new Error(`Cyclic supersession at ${source}:${node}`);
      const next = new Set(path); next.add(node);
      for (const target of supersedes.get(node) ?? []) {
        if (allClasses.has(target)) excluded.add(target);
        visit(target, next);
      }
    };
    visit(source, new Set());
  }
  return {retained:[...allClasses].filter(c=>!excluded.has(c)).sort(),removed:[...excluded].sort()};
}
export interface Score {
  score: string; retained: string[]; removed: string[]; unmapped: string[]; codes: string[];
  multiplier: string; segment: string; provenance: {dataset: string, version: string};
}
export function scoreStore(set: FixtureSet, tenant: TenantId, storeId: string, additions: string[] = []): Score | null {
  const store = set.storesByTenant[tenant].find(s=>s.store_id === storeId);
  if (!store) return null; // identical for nonexistent/foreign stores
  return scoreCodes(set, store, [...store.carried_categories_2026, ...additions]);
}
export function scoreCodes(set: FixtureSet, store: Store, codes: string[]): Score {
  const codeMap = new Map(set.productRows.map(p=>[p.catalog_code, p]));
  const classMap = new Map(set.marginRows.map(m=>[m.margin_class,m]));
  const classes = new Set<string>(); const unmapped: string[] = [];
  const uniqueCodes = [...new Set(codes)];
  for (const code of uniqueCodes) {
    const product = codeMap.get(code);
    if (!product) throw new Error(`Unknown code ${code}`);
    if (product.margin_class) classes.add(product.margin_class);
    else unmapped.push(code);
  }
  const {retained, removed} = retainedClasses(classes, new Map(set.marginRows.map(m=>[m.margin_class,m.supersedes])));
  const multiplier = set.segmentRows.find(s=>s.channel===store.channel&&s.store_format===store.store_format&&s.segment===store.segment);
  if (!multiplier) throw new Error(`Missing segment coefficient for ${store.store_id}`);
  let total = 0n;
  for (const c of retained) { const m = classMap.get(c)!; total += decimalMicro(store.segment === "loyalty" ? m.coefficient_loyalty : m.coefficient_standard); }
  return {score:formatMicro(multiplyMicro(total,decimalMicro(multiplier.coefficient))),retained,removed,unmapped,codes:uniqueCodes,
    multiplier:multiplier.coefficient,segment:store.segment,provenance:{dataset:"assessment fixtures",version:set.hashes["promo_coefficients.csv"]!}};
}
export function compareScores(baseline: Score, proposed: Score, monetaryBaseline?: string): { baseline: string; proposed: string; delta: string; scenarioValue?: string; caveat: string } {
  const delta = decimalMicro(proposed.score)-decimalMicro(baseline.score);
  const value = monetaryBaseline === undefined ? undefined : formatMicro(multiplyMicro(decimalMicro(monetaryBaseline),delta));
  return {baseline:baseline.score,proposed:proposed.score,delta:formatMicro(delta),
    ...(value === undefined ? {}:{scenarioValue:value}),
    caveat:"Dimensionless assortment coefficient score only; not sales, a percentage, or a forecast. Monetary baseline and linear scenario are user assumptions."};
}
