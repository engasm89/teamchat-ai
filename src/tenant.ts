import { TENANTS, type TenantId } from "./types.ts";
const proof = Symbol("verified-auth-context");
export interface TenantContext { readonly tenantId: TenantId; readonly uid: string; readonly [proof]: true; }
/** Call ONLY with verified Firebase UID and restricted server-resolved membership, never browser tenant IDs. */
export function resolvedContext(verifiedUid: string, serverTenant: string): TenantContext {
  if (!verifiedUid || !TENANTS.includes(serverTenant as TenantId)) throw new Error("Unauthorized");
  return Object.freeze({ tenantId: serverTenant as TenantId, uid: verifiedUid, [proof]: true as const });
}
export function assertContext(value: TenantContext): void {
  if (!value || value[proof] !== true) throw new Error("Unauthorized");
}
/** Deliberately opaque match result; foreign and nonexistent IDs cannot be distinguished. */
export const NO_MATCH = Object.freeze({found:false as const, message:"No matching record is available."});
