# TeamChat AI — v9 pre-live code audit (9 October 2026)

## Review basis
- Employer's immutable `teamchat-ai-assessment/ASSESSMENT.md` and all five original fixture files.
- The six-page Technical Brief that was submitted on 8 October 2026.
- v8 working tree, implementation contracts, 27-scenario traceability matrix, previous test coverage, and deployment instructions.

## Proven regression and correction
### Critical: Cloud Tasks outages can leave AI jobs queued indefinitely
**Previously:** `dispatchJob` read `task_outbox.dispatch_attempts`, called Cloud Tasks and incremented the counter only on success. If the Cloud Tasks API was unreachable or returned an error, the counter stayed unchanged. Cloud Scheduler could retry a job forever and `failExhaustedDispatch` would never fire. Two dispatchers could also read the same counter concurrently and attempt the same named task.

**Corrected:** `reserveDispatchAttempt` uses one PostgreSQL `UPDATE … RETURNING` reservation within a tenant-scoped transaction. It checks job eligibility, enforces `next_retry_at`, atomically increments `dispatch_attempts`, and reserves the next retry before external I/O. The task name incorporates the reserved attempt. Duplicate-task responses are treated as successes. Successful remote submissions mark `dispatched` only for the matching reservation. Failed requests remain counted and retryable. The existing scheduler and `failExhaustedDispatch` path can now reach a visible terminal state after 12 failed attempts.

**Regressions:** `tests/task-dispatch-recovery.test.ts` checks 12 consecutive failed submissions, no thirteenth dispatch, one reservation for concurrent dispatchers, and ALREADY_EXISTS handling. This test uses a controlled SQL mock and controlled remote task transport; it is **not evidence of real Cloud SQL or Cloud Tasks integration**.

## Verification evidence
- `npm run verify:prelive`: passes; TypeScript `tsc --noEmit`, 93/93 Node offline tests, original fixture hashes, deterministic SQL generated with 2,753 inserts.
- `npm run verify:packaging`: intentionally fails; neither root nor React has a generated npm lockfile. Offline npm registry DNS resolution is unavailable. Do **not** fabricate lockfiles or replace npm ci with uncontrolled production install.
- `npm run test:postgres:required`: intentionally fails, zero skips, because `DATABASE_URL` and test identities and embedding model are not provisioned.
- Source checked against employer's criteria; v8's 27-item traceability matrix is carried forward, with this derived requirement explained in v9.

## Cannot yet be asserted
- Full frontend Vite production build, Docker image, dependency/SBOM audit.
- PostgreSQL RLS in a real restricted connection, migration/seed execution, and side-effect isolation.
- Firebase identity verification and six assessment users.
- Native Vertex Gemini function calls and semantic paraphrase retrieval.
- Real Cloud Tasks OIDC and outage recovery including rate limits and IAM.
- Cross-instance WebSocket ordering/replay, 30-second offline recovery, long AI answer refresh, idle resource profile.
- Live demo history, public deployed URL, GitHub repository and 5-minute video.

## Release decision
**NOT RELEASE-READY.** The substantive source defect is corrected and the offline suite passes. This is the highest confidence attainable for these checks without live infrastructure; the user must not represent it as passing the actual evaluator session.
