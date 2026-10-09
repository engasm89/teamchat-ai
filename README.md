# TeamChat AI — Controlease technical assessment

**Phase 2 authenticated-services source checkpoint — 9 October 2026.** This is implementation source and offline test evidence, **not** a deployed or production-tested application. The six-page Technical Brief was submitted on 8 October, before the first application commit.

## Implemented code

- Employer seed fixtures copied unchanged; generated tenant-local, rerunnable SQL loader.
- Relational PostgreSQL schema, composite tenant foreign keys, forced row-level security; restricted role provisioning, UID lookup and job lookup helpers.
- `pg` database adapter, server-side Firebase ID token verifier, server-resolved membership, authenticated `/api/me` and `/api/rooms` endpoints.
- Node `ws` WebSocket server, durable ordered room event replay, duplicate-message prevention, PG LISTEN/NOTIFY wakeups for multi-instance fanout, heartbeat and backpressure.
- Cross-instance presence and typing via short-lived database leases and opaque PostgreSQL notifications; browser-side presence/typing indicators.
- `@AI` job and Cloud Tasks outbox creation atomically with chat messages, OIDC-signed private worker invocation, retry dispatch route.
- Gemini via Vertex AI native `@google/genai` function calling, a tenant-scoped SQL tool executor, persisted tool traces and progressively delivered **verified database result blocks**, never unsupported free-form factual model text.
- React UI scaffold with Firebase sign-in, live messaging and typed tool output, cursor replay and bounded session-only retry queue, memory save consent checkbox.
- Google Cloud Run API + private worker Dockerfiles, Firebase Hosting config, six-account provisioning script and deployment checklist.

## Development commands

```bash
npm install                 # requires npm registry; unavailable in this sandbox
npm test                    # dependency-free mocked tests
npm run check               # TypeScript backend typecheck
npm run verify:fixtures
npm run seed:sql
npm run test:postgres       # CONDITIONAL; skips without DATABASE_URL and TEST_*_UID
npm run provision:users     # real authorized Firebase + admin DB; credentials required
npm run start:api           # requires pg, ws, firebase-admin, Cloud SQL, env
npm run start:worker        # requires @google/genai, Google auth/tasks, env
cd apps/web && npm install && npm run build
```

## PostgreSQL bootstrap

Read `docs/PHASE2_CONTINUATION.md` and `docs/DEPLOYMENT_CHECKLIST.md` in order. Apply SQL migrations 001–006 with the migration owner; create a restricted application login role; apply `db/provision_runtime_role.sql`; apply generated seed with transaction-local tenant context; then provision six actual Firebase users and test tenant access using that login. Never run the API or worker as the migration owner. Keep credentials in Secret Manager.

## Verification summary

- Offline tests: **37 pass** using domain logic and mocked SQL/WebSocket interactions.
- Backend TypeScript check: **pass**.
- Real PostgreSQL tenant-isolation integration: **NOT RUN** (test skips; no PostgreSQL server/credentials).
- Live Firebase, WebSocket, Vertex AI, Cloud Tasks, two-instance, browser tests: **NOT RUN** (no authorized GCP project or networked dependencies available).
- React build: **NOT RUN** because dependencies are unavailable.
- Cloud deployment, public URL, live credentials, GitHub remote, demo video: **NOT DONE**.

## Important technical limitations

- Tenant isolation is **implemented at code/schema level but not proved against a live PostgreSQL runtime role**. The RLS proof remains an explicit integration gate.
- The memory search implementation is tenant-filtered lexical search, **not** required semantic embedding retrieval yet.
- AI worker retries, fencing, concurrent outputs and socket presence have not undergone actual Cloud SQL failure injection; operational bugs may remain.
- The financial scoring formula is an explicitly disclosed assumption, not a sales/revenue forecast.
- These are implementation modules, not a claim of passing the employer's acceptance checks.

## 9 October pre-live source audit (v3)

A second security/correctness audit corrected AI operation replay and memory-consent idempotence, privileged SQL startup credentials, worker lease expiration, stale account UI, unauthenticated socket sends and revocation-sensitive presence. See `docs/2026-10-09_PRELIVE_CODE_REVIEW.md` for exact changes and remaining live requirements. **This remains a pre-deployment checkpoint, not a final submission.**
