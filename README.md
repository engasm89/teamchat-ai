# TeamChat AI — Controlease technical assessment

**v6 requirements-aligned pre-live remediation | 9 October 2026.** The six-page Technical Brief was sent on 8 October 2026. This archive contains runnable source and offline evidence, **not a live-tested application**.

## Architecture

React + TypeScript Firebase Hosting client; Firebase Authentication; Node.js/TypeScript API and WebSocket server on Cloud Run; PostgreSQL/Cloud SQL with forced tenant RLS and an authenticated outbox/worker; Vertex AI Gemini native function calls and 768-dimensional Vertex embeddings; Cloud Tasks for durable job delivery. Business facts are rendered from tenant-scoped database tool results, not unchecked model-written sentences. Cross-instance messages are sourced from durable room events, with PostgreSQL NOTIFY as a wake-up signal, never browser polling.

**Critical boundary:** The server verifies Firebase identity, resolves tenant and room membership, passes a restricted tenant context to every tool, and performs transactions with `SET LOCAL` tenant context. The runtime database role must be named `teamchat_api` and cannot be superuser, schema owner, or `BYPASSRLS`.

## Scripts

```bash
npm install                      # network and package registry required
npm run verify:prelive          # local checks only (no claim of live end-to-end proof)
npm run verify:packaging        # FAILS until real root + web npm lockfiles exist
npm run check                   # TypeScript core check
npm test                        # offline domain/mocked integration tests
npm run verify:fixtures         # employer dataset hash and shape checks
npm run seed:sql                # generate idempotent SQL fixture loader
npm run provision:users         # OWNER database URL + authorized Firebase Admin
npm run embed:backfill          # restricted runtime DB + Vertex embeddings
npm run demo:bootstrap:live     # actual multi-user room history with Gemini fetch trace
npm run test:postgres:required  # FAILS if real DB, test users or embedding model absent
npm run verify:release          # all local gates + REQUIRED real-DB test
npm run start:api               # authenticated HTTP + real-time WebSocket
npm run start:worker            # OIDC-protected durable Gemini worker
cd apps/web && npm install && npm run build
```

## Database initialization sequence

1. Install supported PostgreSQL and required extensions using approved database permissions. Create a migration/schema owner and **separate restricted `teamchat_api` login**.
2. Apply `db/migrations/001_schema.sql` through `007_semantic_memory.sql` IN ORDER. `007` requires pgvector (`CREATE EXTENSION vector`) and adds `vector(768)` column; check Cloud SQL extension prerequisites.
3. Apply `db/provision_runtime_role.sql` after the role and migrations exist.
4. Run `db/generated/seed.sql` as migration owner, with only the predefined two tenant contexts.
5. Run `npm run provision:users` with six explicit authorized credentials and a separate admin URL. Each user must have `assortment-review` and `category-strategy` room membership. Do not commit passwords or print them.
6. Run `npm run embed:backfill` with restricted DB role and `VERTEX_EMBEDDING_MODEL_ID`; confirm all seeded memories are embedded before any semantic acceptance test.
7. Run `npm run test:postgres:required` using the actual restricted application role, real test Firebase UIDs and embedding model. The run must pass with **zero skips**.
8. Set `TEST_NORTHSIDE_UID`, `TEST_NORTHSIDE_UID_2`, `TEST_VALLEY_UID`, `TEST_VALLEY_UID_2` to distinct, correctly mapped users, then run `npm run demo:bootstrap:live`. This creates genuine attributable human messages in both rooms plus one REAL Gemini/tool-backed turn per tenant. It must prove persisted tool and completion events; no AI history is fabricated.
9. After cloud deployment, validate 2-browser real-time operations and the full employer scenario table; see `docs/REQUIREMENTS_TRACEABILITY_v6.md`.

## Verification

The v6 offline suite includes catalog, concurrency, truthfulness, tenant-context transaction and idle-presence regression tests including cross-tenant contracts, catalog rankings, source grounding, memory embedding query scope, job fencing, Cloud Tasks terminal handling and socket cleanup races. Backend TypeScript check passes in the available local environment. Five original dataset hashes were checked; the seed generates 2,753 inserts.

**Not yet verified:** real SQL RLS, browser production build, Firebase tokens, live Vertex models, Cloud Tasks retry semantics, WebSockets on multiple Cloud Run instances, deployed UI, performance and full end-to-end behavior. `npm run test:postgres` reports one SKIP locally; the new strict command fails closed without credentials. See `docs/2026-10-09_END_TO_END_PRELIVE_AUDIT_v5.md` and `docs/DEPLOYMENT_CHECKLIST.md`.

The reference financial formula is an explicitly disclosed engineering assumption, **not** an estimate of actual sales or revenue. Data integrity, tenant confidentiality and grounding take priority over polish.

## v6 requirement corrections

The v6 changes correct multicomponent catalog queries (AC and SSD), prevent irrelevant substring matches, normalize existing codes/store IDs without inventing records, serialize subscribe/unsubscribe, make one-connection-pool identity lookup safe, discard database connections on rollback failure, avoid repeated unchanged presence traffic, preserve memory author attribution, and render explicit verified no-record messages. A live Gemini history bootstrap is required rather than fabricated AI seed traces. Details and test evidence: `docs/REQUIREMENTS_TRACEABILITY_v6.md` and `docs/2026-10-09_SOURCE_AUDIT_v6.md`.

## v5 important fixes

Expired-running jobs are recovered by Cloud Scheduler; duplicate sends do not requeue existing tasks; switching rooms unsubscribes and removes stale presence; late WebSocket frames after logout are ignored; all upgraded WebSockets are terminated at service shutdown; memories receive atomic version-one history; Gemini call IDs are preserved; and Firebase Admin plus Cloud Tasks config fail closed. A strict packaging/React-build gate was added. The missing npm lockfiles remain a real blocker until generated against the public registry.
