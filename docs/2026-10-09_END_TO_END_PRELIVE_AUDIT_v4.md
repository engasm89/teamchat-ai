# TeamChat AI — end-to-end source remediation, v4

**Date:** 2026-10-09. **Scope:** original employer fixtures + Phase 2 v3 source. This is a pre-live code remediation, not a cloud-tested deployment or an assertion of zero remaining defects.

## Corrections since v3

| Area | v3 weakness | v4 correction | Test / evidence |
|---|---|---|---|
| Shared memory | Lexical search missed paraphrases | Vertex text embedding provider; tenant- and model-scoped pgvector cosine retrieval; `007_semantic_memory.sql`; backfill of existing seed memories; embedding generation before DB locks; conservative weak-match exclusion | `tests/semantic-memory.test.ts` (mocked embeddings), live model + recall calibration **PENDING** |
| Catalog lookup | Broad `ILIKE ANY` with alphabetic LIMIT could rank unrelated records ahead of portable AC | Deterministic ranking of actual tenant catalog rows, AC/SSD/HBA/RTW/DIY expansion inside retrieval only, no keyword-based AI tool routing | `tests/catalog-search.test.ts` |
| Slow Gemini calls | No heartbeat while blocked on model request; 4-minute lease could expire | Fenced `renewJobLease` every 45 seconds while waiting; 270-second client-side abort; explicit cleanup | `tests/worker-renewal.test.ts` (mocked SQL), live failure injection **PENDING** |
| Worker errors | First transient SDK/network failure terminally failed job despite retry policy | Retryable failures release fenced lease back to queue; terminal failures and max-attempt failures remain durable; original tool arguments must still match on replay | `tests/worker-renewal.test.ts`, prior replay tests |
| Cloud Tasks | Reused task name could collide with a tombstoned task; dispatched but queued jobs had no recovery | Rotating attempt-suffixed task names; scheduler rechecks overdue dispatched AND pending queued jobs; dispatch limit produces durable `ai_failed` | Source review + unit test for terminal dispatch |
| WebSocket lifecycle | A disconnect during an awaited presence INSERT could resurrect a dead subscription | Closed-socket tracking and lease cleanup after awaited insert; reject sends to closed sockets; explicit HTTPS origins | `tests/socket-lifecycle-race.test.ts` |
| Third-party module loading | CommonJS/ESM named-export differences could crash at runtime | Module export fallback for pg, ws, Firebase Admin, Google Tasks and Auth Library | TypeScript check; actual npm packages **NOT INSTALLED HERE** |
| Startup failure | API/worker could leave PostgreSQL pool active after failed initialization | Close listener and DB pool on failed startup; explicit normal shutdown handles | Source review; real process shutdown **PENDING** |
| Release gate | `test:postgres` skipped on missing environment; easy to misread as passing | New `test:postgres:required` and `verify:release` fail when connection, test UIDs or embedding-model configuration is missing | Expected failure with missing credentials verified |

## Verification executed

- Original five fixture hashes validated; 12 stores + 4 seeded memories in **each** of two tenants.
- Generated `db/generated/seed.sql` with **2,753** idempotent INSERT statements.
- Backend `npm run check`: **PASS** using locally available Node types and TypeScript compiler.
- `npm test`: **53 passed, 0 failed**, domain/mocked SQL/WebSocket only.
- `npm run test:postgres`: **1 skipped**, because DATABASE_URL, test UIDs and model configuration are not available.
- `npm run test:postgres:required`: **intentionally fails** with missing credentials. Therefore the release gate is **RED**, by design.
- Real `pg`, `ws`, Firebase, Cloud Tasks, GenAI libraries: **unavailable for install in this container due npm registry DNS failure**. Their runtime compatibility and browser build cannot be certified here.

## Required live integration, in order (NO SKIPS)

1. On a controlled project/network, install dependencies, generate `package-lock.json` files for root and `apps/web`, commit them, then run `npm ci`, `npm test`, `npm run check` and `cd apps/web && npm run build`. Never push credentials.
2. Provision Cloud SQL with distinct owner/runtime users. Verify Cloud SQL `vector` extension support; run migrations `001`–`007`, provision `teamchat_api` grants, and seed both tenants.
3. Provision exactly three distinct Firebase accounts per company with owner DB access only during provisioning. Run `npm run embed:backfill` using the **restricted runtime** DB role and authorized Vertex embedding credentials. Ensure all 8 seeded memories have 768-dimensional vectors for the configured model.
4. Run `npm run test:postgres:required`. Assert no skipped tests, verify connection-pool tenant resets and foreign write rejection. Perform manual revocation and SQL permission tests too.
5. Configure Cloud Tasks OIDC and Cloud Scheduler recovery; verify one fresh Gemini turn, real tool-call traces, transient retry, forced worker termination, lease fencing, and no duplicate saves.
6. Use two authenticated browsers and **two** API instances: verify chat order, duplicate sends, 30-second reconnect, refresh mid-answer, complete AI output recovery, presence expiry and listener-failure recovery. Confirm no browser polling.
7. Test cross-room paraphrased memory retrieval, nonexistent memory, nested save validation, no cross-tenant data leaks, foreign store indistinguishable from absent, model jailbreak prompts, coefficient calculations and UI accessibility.
8. Deploy public app, verify frontend build/runtime, create controlled evaluation credentials, capture demo, publish GitHub repo and provide final URLs. The original assessment deadline remains **16 October 2026** (time not confirmed).

## Known limitations NOT silently marked fixed

- No PostgreSQL instance in this session. **RLS is not proven against real SQL** and `pgvector` migration has not executed.
- Embedding similarity cutoff (`0.45` cosine distance) is conservative, but must be calibrated using the actual chosen model and seeded decisions; live semantic recall not proven.
- Vertex Gemini function calling, Gemini embeddings, worker timeout, Cloud Tasks/OIDC, and Cloud Run multi-instance LISTEN/NOTIFY have not been exercised live.
- Browser build and SDK integration were not compiled with downloaded packages, because registry networking is unavailable.
- AI UI shows progressively committed verified **tool/result blocks**, not raw Gemini token streaming. This is the submitted brief's documented grounding trade-off.
- Room replay from zero can be expensive in very long rooms; production paging/retention/monitoring remain outside assessment scope.
- No GitHub remote push, cloud provisioning, public deployment or assessment demo has been completed in this remediation.

**Verdict: v4 source is materially stronger and passes the available offline checks. Live release approval remains blocked, intentionally.**
