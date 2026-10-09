# Phase 2 entry contract — do not skip

1. Read `07_PHASE1_VERIFICATION.md`, the exact **submitted** PDF, the original employer requirements and the acceptance matrix. Do **not** replace the submitted PDF with a later version. Document all departures in README.
2. Locate any existing code/GitHub repository and record first application commit timestamp before new implementation. Do not create competing repositories.
3. Read-only check GCP identity/project, billing status, Firebase Auth/Hosting, Vertex AI Gemini and embedding model/region/quota, Cloud Run, Cloud SQL, Cloud Tasks, Artifact Registry and Secret Manager. No paid provisioning without explicit permission.
4. Define TypeScript protocol contracts and tenant-scoped repository APIs first; establish restricted runtime DB role and transaction-local PostgreSQL RLS context. Test that absent tenant context fails closed.
5. Seed both tenants from the **unchanged** fixture bytes and test two-tenant containment, null margin mapping, key collision, and source data checks. Record dataset version/hash in source ledger.
6. Prove G05 tenant isolation and G06 source grounding before adding visual breadth. Implement only after internal contracts are agreed, then validate real WebSocket replay and native Gemini function calls.
7. Keep formal evidence records for every G/E/H criterion. Never label a planned test as PASS.

Scope cut priority: preserve G02–G06 and essential source-backed chat flows; defer optional UI animation/features. No contact with Gonzalo or final submission without Ashraf's express approval.
