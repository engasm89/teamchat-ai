# Controlease TeamChat AI — employer acceptance traceability (v6)

**Basis:** Original `teamchat-ai-assessment/ASSESSMENT.md`, original five datasets, and the six-page Technical Brief actually submitted 8 October 2026. Gonzalo subsequently clarified submission is due 16 October 2026. **Statuses below are evidence-based; none imply cloud acceptance.**

Legend: `OFFLINE PASS` = local assertions pass; `SOURCE ONLY` = code/config exists but untested with real services; `OPEN` = requirement unmet; `LIVE GATE` = cannot be asserted without actual integration. Source code passing tests is not a deployed end-to-end result.

| # | Employer scenario | Implementation and verification evidence | Current status |
|---|---|---|---|
| 1 | Two users see ordered room messages | `src/persistence/postgres.ts` transactional room events; `src/server/http-socket.ts` replay; mocked tests | SOURCE ONLY + LIVE GATE |
| 2 | Portable air conditioning code and margin class | `rankCatalog` fixture product families; `get_catalog_code`; code tests | OFFLINE PASS + LIVE GATE |
| 3 | Reverse code lookup, punctuation omitted | `normalizeCatalogCode`, tenant-scoped tool lookup; regression tests | OFFLINE PASS + LIVE GATE |
| 4 | AC and SSD together | Multi-abbreviation interleaved candidate retrieval; tests assert BOTH families | OFFLINE PASS + LIVE GATE |
| 5 | Beekeeping veils absent | Exact token matching; verified no-match message, no fabricated code | OFFLINE PASS + LIVE GATE |
| 6 | ST-4003 uplift, arithmetic and class graph | `retail.ts`, `sql-tools.ts`, 44 class records and supersession edges; unit fixtures | OFFLINE PASS + LIVE GATE |
| 7 | ST-4007 suspected gaps + comparison | `getStore`, gap evidence, `calculate_uplift` using explicit assumption | OFFLINE PASS + LIVE GATE |
| 8 | Two coding alternatives same store | Different `add_codes`, class dedupe, fixed precision | OFFLINE PASS + LIVE GATE |
| 9 | Paraphrase seeded decision cross-room | Tenant-scoped pgvector + backfill script and `search_memory` | SOURCE ONLY; LIVE semantic recall OPEN |
| 10 | New contact/deadline shared to another user | Validated flat memories and atomic version 1; explicit shared-memory consent; live multi-user test outstanding | OFFLINE PASS + LIVE GATE |
| 11 | Nested memory failure and repair | `validateMemoryValue` rejects objects and arrays; tool returns field errors, model can retry | OFFLINE PASS; LIVE model-repair OPEN |
| 12 | Same target in two chains returns own figure | Composite keys, forced RLS, tenant-scoped tools, strict live PostgreSQL test | OFFLINE PASS + LIVE GATE |
| 13 | Valley/foreign store vs nonexistent | Both yield indistinguishable NO_MATCH; extended live PostgreSQL tool-level test | OFFLINE PASS + LIVE GATE |
| 14 | Admin-mode prompt / authority note cannot grant access | Firebase-verified UID and server tenant context, tools do not accept tenant override | OFFLINE PASS + LIVE GATE |
| 15 | Two simultaneous AI questions | Separate durable turn/job IDs and leases/fencing, concurrency tests | SOURCE ONLY + LIVE GATE |
| 16 | Refresh during AI answer | Durable `room_events`, `tool_calls`, answer blocks and cursor replay | SOURCE ONLY + LIVE GATE |
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
