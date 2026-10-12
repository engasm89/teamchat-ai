# Actual status at handoff — 2026-10-09

**Release verdict: ❌ NOT READY FOR SUBMISSION.** All live integration checks are still open, even though 115 offline tests pass. A green local test suite cannot prove RLS/grounding/realtime live behavior.

## Verified here

- Gmail first-to-last thread reviewed, Sep 28–Oct 9 (17 messages) and Oct 9 @paluchi/deadline clarification found.
- Six-page original brief was sent Oct 8; PDF preserved.
- `teamchat-ai-assessment.zip` original intact; 5 fixture SHA256 signatures verified; generated SQL seed inserts 2,753 statements.
- Clean-source baseline of v12: 111 tests passing; new fixes: Cloud Run SIGTERM/SIGINT shutdown handler invocation and cleanup error handling; stale presence/typing frame filtering after room unsubscribe; 4 new tests. **115/115 passing.**
- TypeScript `tsc --noEmit` passes when a **temporary external local `@types/node`** reference is available; no project dependency or authentic npm lockfile was created.
- Actual npm registry query fails DNS `EAI_AGAIN`. `npm run verify:packaging` FAILS (no package-lock.json). `npm run test:postgres:required` FAILS (no DB and test UIDs). These were intentionally not bypassed.

## Unresolved

- Real PostgreSQL role/RLS/constraints, no authenticated DB; cannot label tenant isolation PASS.
- Firebase Auth, real Vertex Gemini streamed tool choices, semantic embeddings/backfill, task worker OIDC, two API instances, two-browser network behavior all unverified.
- React Vite production bundle/build not executed due to missing deps.
- No production Cloud Run/Firebase deployed endpoints, no actual seeded Gemini AI history, no actual GitHub remote, no reviewer credentials/video.
- A model-provided monetary baseline was prohibited as untrusted; current coefficient-only outputs intentionally diverge from the brief's optional validated-user-baseline scenario. Do not claim dollar uplift.

## Locally corrected in this handoff

1. Original `src/server/start.ts` and `src/worker/start.ts` never registered SIGTERM/SIGINT to call available close routines. Both now use `src/runtime/shutdown.ts`; regression tests assert idempotent cleanup, failure signaling, handler unregistering.
2. `apps/web/src/socket.ts` ignored old **durable** room events after unsubscribing but still accepted stale **ephemeral** typing/presence frames. It now limits those to currently subscribed rooms and a regression test confirms it.

## Release-critical order

1. Reproducible npm install/build + genuine lockfiles.
2. Real restricted PostgreSQL RLS test (two tenants, six users, pgvector).
3. Actual Firebase/Vertex/Cloud Tasks/OIDC and AI trace/persistence.
4. Real WebSocket recovery and UI/network/heap tests.
5. GitHub @paluchi access, deployed URL, credentials, demo video, README, final user-reviewed email.

For the detailed 61-item red/green matrix and original-line references see `REQUIREMENTS_LINE_BY_LINE.md` and `.csv`.
