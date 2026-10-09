# TeamChat AI v11 — Source and assessment contract review

**Date:** 2026-10-09  | **Basis:** unmodified employer assessment (`ASSESSMENT.md` + five fixtures), submitted six-page Technical Brief (2026-10-08), reviewed v10 code.

## Corrected in this review

1. **Cloud Tasks resource lifecycle (architecture: no memory leaks):** `dispatchJob` created a new gRPC `CloudTasksClient` for each task without closing it. The v11 `invokeTaskWithClient` seam closes each client after success or failure and does not mask a successful task creation if cleanup fails. Three offline tests cover normal dispatch, remote failure, and close failure. Real SDK behaviour remains a live gate.
2. **Premature room subscription and sending (identity/tenant boundary):** The React client previously connected and immediately subscribed to the hard-coded `assortment-review` room, before `/api/rooms` established membership. v11 starts without an assumed room and subscribes only after a verified room list arrives; the composer is disabled for rooms absent from that list. A pure authorization-gating test confirms online socket status alone does not grant room access. **The server continues to enforce membership independently.**
3. **Unbounded/rejected pending messages (refresh, reconnect, bounded memory):** The browser pending queue was unbounded, and oversized commands could be retried forever because the server would never acknowledge them. v11 validates message and room lengths, caps pending messages at 100, and makes the UI surface queuing errors without losing the unsent draft. Two regression tests verify validation and capacity.
4. **Permanent message rejection protocol (duplicate sends, recovery):** Inaccessible rooms and invalid/conflicting messages now receive a generic `message_rejected` result linked to their original client message ID. The browser removes those impossible-to-complete sends from its pending queue; transient SQL or transport failures remain retryable. The outward rejection is identical for nonexistent and unauthorized rooms. A fake transport integration test checks queue state through the actual browser message listener. The backend rejects malformed JSON types before querying PostgreSQL, avoiding non-string crashes and permanent retry loops.

## Verification evidence

- `npm test`: **105 tests PASS, zero skipped** (`docs/evidence/v11_offline_tests.tap`).
- `npm run check`: PASS (`docs/evidence/v11_backend_typecheck.txt`). This is the backend project, not a full React production type-check.
- TypeScript parser: all **six** React/client TS/TSX source files parse without errors (`docs/evidence/v11_frontend_parse.txt`). Syntax parsing is not a Vite production build.
- `npm run verify:fixtures`: PASS, original five SHA-256 fixture hashes preserved (`docs/evidence/v11_fixture_validation.txt`).
- `npm run seed:sql`: PASS, deterministic fixture seed generator (`docs/evidence/v11_seed_generation.txt`).
- `git diff --check`: PASS.
- `npm run verify:packaging`: FAIL as intended because genuine root and frontend `package-lock.json` files are unavailable (`docs/evidence/v11_packaging_BLOCKED.txt`). No synthetic lockfiles were introduced.
- `npm run test:postgres:required`: FAIL as intended with no `DATABASE_URL`, verified tenant user IDs or configured embedding model (`docs/evidence/v11_postgres_BLOCKED.tap`). A skipped or mocked PostgreSQL test is not a pass.

## Employer requirement alignment and remaining release blockers

- **Server-driven realtime transport:** Native WebSocket with durable room event replay remains in place; no managed client listeners or browser polling were added. Must run two-instance browser tests.
- **Native Gemini function calling:** No keyword tool routing added. Existing model-facing tool declarations and server-executed tool implementations preserved. Must run real Vertex AI calls, observe actual source-backed tool traces, and validate semantic recall.
- **Grounding:** Verified results and explicit no-match responses remain. Live grounding and memory-recall tests are still open.
- **Tenant isolation (pass/fail):** Restricted PostgreSQL RLS design retained; v11 avoids unauthorized optimistic room subscriptions. Need to test actual nonowner database role and both tenants against a real PostgreSQL instance. Source tests are insufficient.
- **Chat resilience:** v11 adds bounded pending sends and permanent rejection semantics. Need live disconnect/reconnect, token-expiry, crash-retry, multi-browser order, idle network trace, and worker failure injection.
- **Submission deliverables:** Genuine npm lockfiles/installed dependencies, successful React build, Firebase user provisioning, Cloud SQL migrations + RLS, Vertex AI credentials, Cloud Tasks OIDC, two-instance deployment, public GitHub, seeded real AI conversation history, public URL, private reviewer credentials, and a <=5-minute video remain outstanding.

**Release decision: NOT APPROVED.** Passing source tests does not prove deployed end-to-end behaviour. These source changes should be brought into the next real integration-test run; do not send Controlease a final delivery yet. Employer deadline confirmed separately as **Friday, 2026-10-16** (time/timezone unknown).
