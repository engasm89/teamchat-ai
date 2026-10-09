export const TENANTS = ["northside-outfitters", "valley-home-goods"] as const;
export type TenantId = typeof TENANTS[number];
export interface Product {
  catalog_code: string; description: string; product_family: string;
  department: string; seasonality: string; specificity: string;
  margin_class: string | null; margin_class_label: string | null;
}
export interface MarginClass {
  margin_class: string; label: string; coefficient_loyalty: string;
  coefficient_standard: string; supersedes: string[];
}
export interface SegmentCoefficient { channel: string; store_format: string; segment: string; coefficient: string; }
export interface Gap { catalog_code: string; description: string; last_carried: string; evidence: string; }
export interface Store {
  store_id: string; store_name: string; channel: string; store_format: string; segment: string;
  opened: number; buyer: string; last_review: string;
  carried_categories_2026: string[]; suspected_gaps: Gap[];
}
export type MemoryValue = Record<string, string | number | boolean | null>;
export interface TeamMemory { memory_id: string; key: string; value: MemoryValue; created_by: string; created_at: string; room: string; }
export interface FixtureSet {
  productRows: Product[]; marginRows: MarginClass[]; segmentRows: SegmentCoefficient[];
  storesByTenant: Record<TenantId, Store[]>; memoriesByTenant: Record<TenantId, TeamMemory[]>;
  hashes: Record<string, string>;
}
