# TeamChat AI — v5 source-to-source end-to-end review

**Assessment:** Controlease TeamChat AI. **Date:** 2026-10-09. **Delivery:** 2026-10-16 (time not confirmed).
**Evidence standard:** Offline/mocked success is NOT live PostgreSQL RLS, Firebase Auth, Google Cloud or web-build success. No deployment, privileged cloud testing, or external submission was performed.

## 1. Reproduced baseline and changes

The v4 archive contained 53 offline tests, passing backend TypeScript, a pre-deployment worker, and missing npm lockfiles. Examining the implementation revealed additional reliability, authorization and release-gating problems that previously passed unnoticed.

| Defect identified in v4 | v5 action | Verification |
|---|---|---|
| Cloud Scheduler retried only **queued** jobs; an expired `running` lease could remain stranded forever | `recoverableJobs` includes expired-running leases; `failExhaustedJob`/`failExhaustedDispatch` also handle that state | `tests/worker-lease.test.ts`; 62 offline tests pass; live recovery pending |
| Duplicate message acknowledgement could schedule another Cloud Task | Dispatch new messages once; recovery handles an earlier failed enqueue | code review; live task audit pending |
| Changed chat room remained subscribed and continued receiving presence events | Explicit `unsubscribe` command cleans typing/presence leases and room fanout, preserving cursor for future re-subscription | `tests/api-auth.test.ts`, `tests/browser-socket.test.ts` |
| Replaced/logged-out socket could process late `auth_ok`/events or stale close callback | Ignore messages and closes from sockets that are no longer current | browser regression test |
| Upgraded WebSockets, including unauthenticated ones, could delay Cloud Run shutdown | Bound connections and terminate **all** socket clients on shutdown | source review; real shutdown test pending |
| First-time memory insert did not create its initial version-history row | Create memory and `memory_versions(version=1)` in same transaction | success/rollback mocked SQL tests |
| Native Gemini function-call response omitted optional call ID | Include call ID in function response when Gemini supplies one | source review; live Vertex response pending |
| Firebase Admin implicitly inferred project from ambient service account | Require explicit `FIREBASE_PROJECT_ID`; check default Admin app project matches | pure validation test; live token verification pending |
| API could start with broken Cloud Tasks/OIDC settings | Validate queue path, private HTTPS worker, invoker and audience before startup in API and worker | configuration test; live permissions pending |
| `verify:release` never checked frontend build, despite submission requiring a deployed React app | Release gate now checks npm lockfiles, core, offline tests, fixtures, required PostgreSQL integration and frontend build | missing lockfile correctly fails |

## 2. Local checks actually executed

- **Backend TypeScript:** `npm run check` PASS.
- **Offline tests:** `npm test` **62 passed, 0 failed, 0 skipped**; mocked SQL, browser sockets and domain logic only.
- **Fixture integrity:** `npm run verify:fixtures` PASS. 1,000 products, 289 unmapped, 44 margin classes, 12 segment coefficients, 12 stores and four seeded memories per tenant. Original five data hashes retained.
- **Seed generator:** `npm run seed:sql` PASS, **2,753 inserts**. It is *not* equivalent to applying SQL to PostgreSQL.
- **Frontend source syntax:** App.tsx, main.tsx, socket.ts parsed successfully with TypeScript's transpiler. **Full React production build not run** because dependencies are not installed.
- **Source hygiene:** `git diff --check` PASS. A limited credential-pattern scan of application code found no obvious private keys or API keys; not a complete security audit.
- **Strict PostgreSQL test:** `npm run test:postgres:required` FAILS with missing `DATABASE_URL` / test UID / embedding-model configuration. **No real RLS behavior proven.**
- **Packaging gate:** `npm run verify:packaging` FAILS for missing `package-lock.json`. Both Dockerfiles use `npm ci`; without correctly resolved root and `apps/web` lockfiles, the deployment cannot build. A networked `npm install --package-lock-only` attempt failed DNS resolution (`EAI_AGAIN`), so no fabricated lockfile was checked in.

## 3. Correct order for the next *real* verification

1. On a machine with npm registry access, generate **real** root and `apps/web` lockfiles; run `npm ci`, `npm --prefix apps/web ci`, `npm run check`, `npm test`, `npm --prefix apps/web run build`. Commit lockfiles, inspect dependency warnings and pin the approved versions.
2. Provision Cloud SQL PostgreSQL with pgvector. Run migrations 001–007 as owner, apply `db/provision_runtime_role.sql`, seed fixture SQL; use a separate restricted `teamchat_api` runtime account.
3. Provision six Firebase users in the explicitly configured project, three per tenant. Populate mappings/room membership; backfill all eight memory embeddings via Vertex.
4. Run `npm run test:postgres:required` (zero skips), then test real cross-tenant reads/writes, copied Firebase tokens, revoked memberships, no user-selected tenant, unknown/foreign stores, and connection pooling.
5. Verify Cloud Tasks OIDC authentication, task creation and recovery, Gemini native tool calls, non-fabrication, persisted traces, memory saves and retries after worker crashes. Check model function-call IDs and schema compatibility with the pinned SDK.
6. Run two API/worker instances and two browsers; inspect event ordering, duplicate sends, reconnect after 30s offline, historical replay, room switch cleanup, presence, typing, shutdown, cold starts and failure recovery.
7. Verify required evaluation scenarios, create demo video, GitHub URL, deployment URL, and private reviewer credentials. Do not submit before these gates pass.

## 4. Residual risks — do not mislabel as fixed

- Missing installed `pg`, `ws`, Firebase Admin, Cloud Tasks, Google GenAI, Firebase web SDK, React/Vite: **live runtime imports and full frontend build unverified**.
- No PostgreSQL database available here: **SQL migrations, grants, row security, pgvector, LISTEN/NOTIFY all unexecuted**.
- No OIDC tokens, Vertex models or Cloud Run configuration: provider compatibility, model streaming, embeddings quality and retries **unverified**.
- Browser and WebSocket lifecycle tests are simulated; scale, outage, resource budgets and two-instance correctness need real failure injection.
- The formula for monetary uplift remains an explicit assumption, not a measured business model. No invented sales forecasts are permissible.
- `npm ci` Docker builds require real committed lockfiles; the v5 release gate intentionally stays RED until they exist.
- Genuine end-to-end completion requires deployment, testing, repository publication and reviewer access. This source code review does not prove all defects are absent.

**Decision:** v5 is an improved, locally validated pre-live source checkpoint, not a release-ready deliverable.
