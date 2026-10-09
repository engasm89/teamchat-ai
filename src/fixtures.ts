import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { TENANTS, type FixtureSet, type MarginClass, type Product, type SegmentCoefficient, type Store, type TeamMemory, type TenantId } from "./types.ts";

export const DATA_DIR = join(process.cwd(), "teamchat-ai-assessment", "teamchat-ai-seed-data");

/** RFC4180-like CSV parser with quoted commas, embedded newlines and escaped quotes. */
export function parseCsv(source: string): Array<Record<string, string>> {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v.length)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...records] = rows;
  if (!header || header.length < 2) throw new Error("Missing CSV header");
  return records.map((values, idx) => {
    if (values.length !== header.length) throw new Error(`CSV row ${idx + 2}: incorrect column count`);
    return Object.fromEntries(header.map((key, i) => [key, values[i]!])) as Record<string, string>;
  });
}

function jsonTenants<T>(text: string): Record<TenantId, T[]> {
  const obj = JSON.parse(text) as Record<string, T[]>;
  if (Object.keys(obj).length !== TENANTS.length || TENANTS.some(t => !Array.isArray(obj[t]))) throw new Error("Unexpected tenant fixtures");
  return obj as Record<TenantId, T[]>;
}
export function loadFixtures(directory = DATA_DIR): FixtureSet {
  const names = ["product_codes.csv", "promo_coefficients.csv", "segment_coefficients.csv", "stores.json", "team_memory_seed.json"];
  const contents = Object.fromEntries(names.map(n => [n, readFileSync(join(directory, n))])) as Record<string, Buffer>;
  const hashes = Object.fromEntries(names.map(n => [n, createHash("sha256").update(contents[n]!).digest("hex")]));
  const productRows = parseCsv(contents["product_codes.csv"]!.toString()).map(r => ({...r,
    margin_class: r.margin_class === "" ? null : r.margin_class,
    margin_class_label: r.margin_class_label === "" ? null : r.margin_class_label
  })) as unknown as Product[];
  const marginRows = parseCsv(contents["promo_coefficients.csv"]!.toString()).map(r => ({...r,
    supersedes: r.supersedes ? r.supersedes.split(/[;,|]/).map(s => s.trim()).filter(Boolean) : []
  })) as unknown as MarginClass[];
  const segmentRows = parseCsv(contents["segment_coefficients.csv"]!.toString()) as unknown as SegmentCoefficient[];
  const storesByTenant = jsonTenants<Store>(contents["stores.json"]!.toString());
  const memoriesByTenant = jsonTenants<TeamMemory>(contents["team_memory_seed.json"]!.toString());
  const result = { productRows, marginRows, segmentRows, storesByTenant, memoriesByTenant, hashes };
  assertFixtures(result);
  return result;
}
export function assertFixtures(set: FixtureSet): void {
  const {productRows, marginRows, segmentRows, storesByTenant, memoriesByTenant} = set;
  if (productRows.length !== 1000 || marginRows.length !== 44 || segmentRows.length !== 12) throw new Error("Unexpected fixture row count");
  const productCodes = new Set(productRows.map(r => r.catalog_code));
  if (productCodes.size !== 1000) throw new Error("Duplicate product code");
  const classCodes = new Set(marginRows.map(r => r.margin_class));
  if (classCodes.size !== 44) throw new Error("Duplicate margin class");
  for (const p of productRows) if (p.margin_class && !classCodes.has(p.margin_class)) throw new Error(`Missing class ${p.margin_class}`);
  for (const m of marginRows) for (const s of m.supersedes) if (!classCodes.has(s)) throw new Error(`Broken supersession ${s}`);
  for (const tenant of TENANTS) {
    if (storesByTenant[tenant].length !== 12 || memoriesByTenant[tenant].length !== 4) throw new Error(`Wrong tenant counts ${tenant}`);
    for (const store of storesByTenant[tenant]) {
      if (!/^ST-\d{4}$/.test(store.store_id)) throw new Error(`Invalid store id ${store.store_id}`);
      for (const code of [...store.carried_categories_2026, ...store.suspected_gaps.map(g=>g.catalog_code)]) {
        if (!productCodes.has(code)) throw new Error(`Unknown store code ${tenant}:${code}`);
      }
      if (!segmentRows.some(s=>s.channel===store.channel&&s.store_format===store.store_format&&s.segment===store.segment)) throw new Error(`Missing segment ${store.store_id}`);
    }
  }
}
