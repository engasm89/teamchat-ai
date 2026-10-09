> HISTORICAL v2/v3 NOTE: See `README.md` and `docs/2026-10-09_END_TO_END_PRELIVE_AUDIT_v4.md` for current source status.

# Phase 2 authenticated services checkpoint — 2026-10-09

## Delivered source code

- Real PostgreSQL `pg` adapter, transaction-local RLS tenant scoping, restricted bootstrap UID resolver.
- Migrations 003–005 for private auth/job directories and signed worker job routing; role-grant script.
- `scripts/provision-demo-users.ts` for **real** Firebase Auth accounts and corresponding database membership (requires administrator-provided credentials).
- Authenticated `GET /api/me`, `GET /api/rooms` and WebSocket server (Origin allowlist, Firebase token verification/revocation, membership check, cursor replay, dedupe, PostgreSQL LISTEN/NOTIFY wakeups, backpressure, heartbeats).
- Transactionally persisted AI jobs and task outbox, Cloud Tasks OIDC dispatch, authenticated private worker endpoint and scheduler recovery route.
- Vertex AI `@google/genai` native function calling interface. DB-backed tool executor; returns only verified source-backed blocks, never free-form unverified model factual prose.
- Live-Postgres integration tests and offline mock tests.

## What to run on a real authorized GCP/PostgreSQL environment

1. Create a PostgreSQL database with separate schema migration owner and `teamchat_api` login (`NOSUPERUSER`, `NOBYPASSRLS`, not schema owner), passwords in Secret Manager.
2. Apply `db/migrations/001_schema.sql` → `002_notifications.sql` → `003_auth_grants.sql` → `004_ai_consent.sql` → `005_job_lookup.sql` **as migration owner**.
3. Apply `db/provision_runtime_role.sql` as DBA; verify that application login has only granted privileges. If migration owner is affected by FORCE RLS, use transaction-local `app.tenant_id` on tenant data writes.
4. `npm install` for backend and web. (Unavailable in sandbox due to registry DNS errors; this has not been done.)
5. `npm run seed:sql`, then execute `db/generated/seed.sql` **as migration owner**. Do not execute as runtime login.
6. Enable Firebase email/password auth. Provide six secure assessment users through `ASSESSMENT_USERS_JSON` and run `npm run provision:users` with `DATABASE_ADMIN_URL` and authorized Firebase Admin credentials.
7. Set `DATABASE_URL` to the restricted role and both `TEST_*_UID` values. Run `npm run test:postgres`. Never call this test "passed" until it runs without skips.
8. Enable Vertex AI project/region/model and ADC with least privilege; provision Cloud Tasks queue, private worker (OIDC audience + service account), authenticated Cloud Scheduler outbox recovery job, Cloud SQL and Cloud Run. Set all variables in `.env.example` from Secret Manager where sensitive.
9. Deploy worker private to Cloud Run with ingress/authorization restrictions. Deploy API to Cloud Run with a tested PostgreSQL event listener and set WebSocket timeout/reconnect. Firebase Hosting deploy separately.
10. Test **two** API instances, two browser users, disconnect replay, late notifications, duplicate sends and refresh during a live AI turn before claiming compliance.

## Known limitations — NOT YET ASSESSED PASS

- The environment has no accessible PostgreSQL server, database credentials, npm registry or GCP project IAM. The live integration test is conditional and presently **skipped**, not passed.
- Firebase Admin, Google GenAI, ws and pg dependencies are declared but cannot be loaded in the current offline runtime; actual wire contract compatibility is not yet demonstrated.
- No Cloud Run, Cloud SQL, Firebase Hosting, IAM or live demo accounts were created. No video has been recorded.
- Shared memory uses tenant-filtered PostgreSQL lexical search. Semantic embeddings and pgvector ranking are not yet implemented.
- Presence and typing have PostgreSQL-backed five/60-second leases and cross-instance NOTIFY fan-out; **not yet tested on live Cloud SQL or across actual API instances**.
- Worker lease expiry, pending task recovery and partial-answer replacement need full failure-injection testing. The design includes fencing and durable outbox but is not validated under real concurrent processes.
- Worker currently emits progressive verified result blocks, not character-by-character unchecked Gemini tokens, by design. This preserves strict grounding but changes UX.
- Original Tech Brief remains unchanged, sent before implementation on 8 Oct.
