# REQUIREMENTS TRACEABILITY MATRIX (61 REQUIREMENTS)

| Requirement Category | Count | Verified Status | Verification Evidence / Method |
| :--- | :---: | :---: | :--- |
| **Multi-Tenancy & FORCED RLS** | 8 | **PASS** | Cloud SQL PG17 with `FORCE ROW LEVEL SECURITY` on all tenant tables; `teamchat_api` nonowner role cannot query without `SET LOCAL app.tenant_id`. Tested via `test:postgres:required` and S11, S12, S18. |
| **Realtime WebSockets & Replay** | 9 | **PASS** | Native `/ws` endpoint on Cloud Run API; monotonic sequence numbers; automatic gap detection and replay with `after: seq`. Tested via S15, S16, S17 Playwright browser tests. |
| **Deterministic AI Grounding** | 8 | **PASS** | LLM model prose never rendered directly; all answers generated from SQL tools tracked in `SourceLedger`. No invented catalog codes or monetary baselines. Tested via unit tests and S01, S02, S04. |
| **Catalog & Uplift Tools** | 7 | **PASS** | `search_catalog`, `get_catalog_code`, `calculate_uplift`, `get_store_assortment`, `compare_assortment_options` executing against PG17 schema. Tested via S01-S07. |
| **Semantic Memory & pgvector** | 8 | **PASS** | Vertex AI `text-embedding-004` (768-dim) with cosine distance (`<=>`) indexing in pgvector; flat key-value schema validation; explicit consent gate. Tested via S08, S09, S10, S19. |
| **Cloud Tasks Async Execution** | 6 | **PASS** | Cloud Tasks queue `teamchat-ai-tasks` dispatches private HTTP tasks to Cloud Run Worker with OIDC service account authentication. Worker claims job with fencing token. Tested via Cloud Run deployments. |
| **Security & Authentication** | 8 | **PASS** | Firebase Auth token revocation enforcement (`verifyIdToken(token, true)`); GCP Secret Manager for DB secrets; no secrets in Git; no superuser DB access. Tested via unit tests and secret verification. |
| **Browser Stability & UX** | 7 | **PASS** | Playwright tests confirming 0 recurring HTTP polls, 1 persistent WebSocket, smooth mid-turn refresh rehydration, and offline recovery. Tested via `browser-e2e-evidence.ts`. |
| **Total Requirements** | **61** | **61 / 61 PASS** | **100% Comprehensive Empirical Verification** |

---

### Key Commits Distinction
- **Application Engine Tested Commit:** `dc70fc81ba5724e9692f64ade1cf19b7b217feed` (Builds Cloud Run API `teamchat-api-00007-8z5` and Worker `teamchat-worker-00007-2qt`).
- **Documentation & Matrix Commit:** Follows as sanitized documentation update on `main`.
