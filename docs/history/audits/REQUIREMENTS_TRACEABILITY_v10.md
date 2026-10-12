# Controlease TeamChat AI — employer acceptance traceability (v10)

**Basis:** Original `teamchat-ai-assessment/ASSESSMENT.md`, original five datasets, and the six-page Technical Brief actually submitted 8 October 2026. Gonzalo subsequently clarified submission is due 16 October 2026. **Statuses below are evidence-based; none imply cloud acceptance.**

Legend: `OFFLINE PASS` = local assertions pass; `SOURCE ONLY` = code/config exists but untested with real services; `OPEN` = requirement unmet; `LIVE GATE` = cannot be asserted without actual integration. Source code passing tests is not a deployed end-to-end result.

| # | Employer scenario | Implementation and verification evidence | Current status |
|---|---|---|---|
| 1 | Two users see ordered room messages | `src/persistence/postgres.ts` transactional room events; `src/server/http-socket.ts` replay; mocked tests | SOURCE ONLY + LIVE GATE |
| 2 | Portable air conditioning code and margin class | `rankCatalog` fixture product families; `get_catalog_code`; code tests | OFFLINE PASS + LIVE GATE |
| 3 | Reverse code lookup, punctuation omitted | `normalizeCatalogCode`, tenant-scoped tool lookup; regression tests | OFFLINE PASS + LIVE GATE |
| 4 | AC and SSD together | Multi-abbreviation interleaved candidate retrieval; tests assert BOTH families | OFFLINE PASS + LIVE GATE |
| 5 | Beekeeping veils absent | Exact token matching; verified no-match message, no fabricated code | OFFLINE PASS + LIVE GATE |
| 6 | ST-4003 uplift, arithmetic and class graph | `retail.ts`, `sql-tools.ts`; model-facing tool cannot introduce a monetary baseline; coefficient scores and supersession verified | OFFLINE PASS + LIVE GATE |
| 7 | ST-4007 suspected gaps + comparison | Tenant-scoped `getStore`, preserved gap evidence and readable client formatting; `calculate_uplift` uses explicit dimensionless assumption | OFFLINE PASS + LIVE GATE |
| 8 | Two coding alternatives same store | Native `compare_assortment_options` tool executes tenant-scoped scoring for both options and a directly computed B-minus-A difference; local and renderer regression tests | OFFLINE PASS + LIVE GATE |
| 9 | Paraphrase seeded decision cross-room | Tenant-scoped pgvector + backfill script and `search_memory` | SOURCE ONLY; LIVE semantic recall OPEN |
| 10 | New contact/deadline shared to another user | Validated flat memories; durable consent flag passed to Gemini as trusted system context and separately enforced server-side; live cross-room verification outstanding | OFFLINE PASS + LIVE GATE |
| 11 | Nested memory failure and repair | `validateMemoryValue` rejects objects and arrays; tool returns field errors, model can retry | OFFLINE PASS; LIVE model-repair OPEN |
| 12 | Same target in two chains returns own figure | Composite keys, forced RLS, tenant-scoped tools, strict live PostgreSQL test | OFFLINE PASS + LIVE GATE |
| 13 | Valley/foreign store vs nonexistent | Both yield indistinguishable NO_MATCH; extended live PostgreSQL tool-level test | OFFLINE PASS + LIVE GATE |
| 14 | Admin-mode prompt / authority note cannot grant access | Firebase-verified UID and server tenant context, tools do not accept tenant override | OFFLINE PASS + LIVE GATE |
| 15 | Two simultaneous AI questions | Separate durable turn/job IDs and leases/fencing, concurrency tests | SOURCE ONLY + LIVE GATE |
| 16 | Refresh / retry during AI answer | Durable `room_events`, planned/completed tool calls, answer blocks, cursor replay; v8 reset event supersedes stale partial blocks and React projection hides them on replay; local regression tests | OFFLINE PASS + LIVE GATE |
| 17 | 30-second disconnect, exactly-once display | Client cursor/dedupe + server ordered replay; race regression | OFFLINE PASS + LIVE GATE |
| 18 | Idle browser with one connection and no polling | Native WebSocket only; no managed listeners, no setInterval; deduplicated presence output | OFFLINE PASS + LIVE network inspection |
| 19 | Presence and typing, including ungraceful disconnect | Presence DB leases, server heartbeat, 5s typing leases and ephemeral notices | SOURCE ONLY + LIVE GATE |
| 20 | Cold-start durable memory | PostgreSQL `memories`, pgvector, backfill and persisted answer blocks | SOURCE ONLY + LIVE GATE |
| 21 | Three users per tenant, both chains seeded | Firebase provisioning validates three per tenant and two shared rooms; seed fixture SQL | SOURCE ONLY; ACTUAL provision OPEN |
| 22 | Real AI conversation history and tool fetch | `scripts/bootstrap-live-demo-history.ts` invokes Gemini and asserts persisted tool trace; no synthetic AI exchange | IMPLEMENTED; execution OPEN |
| 23 | No forbidden realtime service, model chooses native tools | Static forbidden-client check, native Gemini function declarations and typed server execution | OFFLINE PASS + LIVE GATE |
| 24 | Technical Brief mailed BEFORE code | Submitted 8 Oct with attached six-page PDF; kept unchanged | CONFIRMED earlier in Gmail thread |
| 25 | GitHub repository and clean commits | Portable Git history locally; remote repository/URL not published | OPEN |
| 26 | Deploy on Cloud Run/Firebase Hosting, share URL | Dockerfiles and firebase.json prepared; dependency lockfiles absent | OPEN — deployment prohibited until locks/build pass |
| 27 | Reviewer credentials, <=5-minute demo video | Provisioning script and instructions; actual credentials/video not created | OPEN |

## Non-negotiable release order

1. Generate **genuine** root and frontend `package-lock.json` against a working npm registry. `npm ci` + `npm --prefix apps/web ci && npm --prefix apps/web run build` must pass. No guessed lockfiles.
2. Apply PostgreSQL migrations 001–007 as database owner and verify `teamchat_api` is not table owner, superuser or `BYPASSRLS`. Seed with original fixture data.
3. Provision six Firebase users, then Vertex memory embeddings. Run `npm run test:postgres:required` **without skip**; test cross-tenant read/write and tool-level no-match equivalence.
4. Boot the actual model-backed demo transcript using `npm run demo:bootstrap:live`; confirm trace events persisted and visible after refresh.
5. Configure Cloud Tasks, private worker OIDC and Cloud Scheduler; verify Gemini native function calling on the pinned model and genuine memory paraphrase, grounding, missing codes and nested repair.
6. Run two browsers and two instances with packet-loss, refresh, task crash, listener failure, revocation and idle-network inspection; check CPU/memory growth and source-card accuracy.
7. Publish a clean repository and working URL; provide private credentials, honest README and demo video. Do not submit until both pass/fail boundaries are proven.

**Explicit limitations:** This container has no PostgreSQL server or cloud credentials and npm registry DNS cannot be resolved.  No live end-to-end test, full React build, real embeddings, Cloud Run deployment, or production RLS test was performed. The submitted technical brief itself was not modified.

## v7 review changes and explicit divergence

- Added native Gemini `compare_assortment_options` for side-by-side, server-calculated comparisons; this strengthens the two-coding evaluation and is in addition to the original six tools.
- Planner gets server-verified room ID and per-turn shared-memory-save consent in system context; retrieved text and user messages still cannot grant permission, and the server independently denies a non-consented save.
- **Money policy tightening:** removed `monetary_baseline` from the model-facing `calculate_uplift` tool. The submitted brief permits explicit user-supplied baselines, but this build did not authenticate a model-proposed baseline against user input; rather than risk fabricated money, v7 shows the verified dimensionless score delta. This is an intentional scope limitation to disclose to reviewers, not a claim of monetary uplift.
- Readable and evidence-attributed store gap display, including explicit `suspected` label, and local normalization of separator-free store IDs.
- Local test assertions are NOT live PostgreSQL/RLS, Gemini, Cloud Tasks, or multi-browser evidence.

## v8 delta and evidence

- A durable `ai_answer_reset` event is now committed on worker reclaim when incomplete blocks exist; old blocks are removed from the active answer snapshot, and the client projects replay deterministically by turn ID.
- `ai_tool_start` is persisted before each tool invocation, and completed results must match the planned name and JSON arguments. Planned operations are revalidated on retry; completed results are reused. Side-effecting memory writes remain idempotent by tenant/key/value/source.
- `/api/rooms` rechecks active membership in the same scoped query after token resolution.
- These are source-level/mocked-test improvements only. Genuine PostgreSQL RLS, Gemini, two-instance WebSocket behavior, npm installation, Cloud Tasks, live seeded history, deployment and video are outstanding.


## v9 verified Cloud Tasks delivery correction

**Derived acceptance requirement:** A Cloud Tasks outage must never leave an AI turn queued forever; a retry after a transient failure must not enqueue multiple overlapping tasks in parallel. The pre-v9 implementation incremented `task_outbox.dispatch_attempts` only after successful task creation, so repeated remote failures did not consume the 12-attempt budget and the exhaustion handler was unreachable. The new `reserveDispatchAttempt()` atomically increments the attempt counter and defers the next attempt **before** calling Cloud Tasks. It uses an eligibility predicate, a three-minute retry reservation and a restricted terminal-state check. Duplicate task-creation responses are treated as successful dispatches; failures remain counted. Scheduler recovery now observes the bounded retry budget and can emit the pre-existing durable failure event.

**Offline evidence:** `tests/task-dispatch-recovery.test.ts`: repeated remote failure, competing dispatcher instances, `ALREADY_EXISTS` response. Whole suite: 93/93, TypeScript clean, unchanged five-fixture manifest and 2,753 seed INSERTs.

**Live gate remains OPEN:** Real Cloud Tasks and Scheduler failure injection must prove retry counter persistence, exactly one observed turn result, terminal event visibility, OIDC rejection, Cloud Run restart survival and eventual dispatch on recovery.


## v10 source audit and pre-live contract changes (9 October 2026)

- **Requirement #16 (refresh/AI retry):** `claimJob` must delete superseded `answer_blocks` before recording the durable `ai_answer_reset`. The restricted role grants from `db/provision_runtime_role.sql` now explicitly include `DELETE ON teamchat.answer_blocks`, and the required live PostgreSQL test contains a zero-match, zero-impact execution of that DML under `teamchat_api`. **Offline grant-contract PASS; actual PostgreSQL DELETE gate still OPEN.**
- **Authentication/session lifecycle (#12, #14, #17, #18):** Production Firebase token verification now exposes the cryptographically verified JWT `exp`. API sockets may run for no more than the smaller of the signed token's remaining lifetime minus a 10-second safety margin or 45 minutes. Closed sockets are not authorized after async membership lookup completes. **Offline expiry tests PASS; genuine Firebase and live WebSocket expiry gate still OPEN.**
- **Runtime SQL/role drift:** `tests/runtime-role-contract.test.ts` scans all runtime source DML and validates the provisioning role grants; it fails if the permission to delete superseded AI answer blocks is removed. **Static contract PASS; cannot replace live RLS testing.**
- **Overall offline checks:** 96/96 tests, backend TypeScript type-check, original data integrity and deterministic seed re-generation. `npm run verify:packaging` and `npm run test:postgres:required` remain **BLOCKED/failed as designed**, not waived. React production build, Firebase, Vertex AI, Cloud Tasks and two-instance tests have not passed.
