# Full line-by-line requirement verdict — strict evidence standard

**Source precedence:** (1) Original `ASSESSMENT.md` inside the employer ZIP; (2) Gonzalo's Oct 8–9 email clarifications; (3) six-page Technical Brief submitted Oct 8; (4) checked project code. Where the brief deviates, label the difference; never silently overwrite the original promise.

**Status:** ✅ GREEN means the precise **offline/documentary assertion** was reproduced or confirmed. It does **not** confer overall deployment acceptance. ❌ RED means the **required employer-facing behavior/deliverable** has not passed real evaluation, or is missing. The RED status includes source code present but not validated live. This is intentionally stricter than the previous source-only matrices.

**No overall green verdict:** tenant isolation, grounding, realtime two-browser operation, production build, deployment, genuine history, GitHub and video have no valid live evidence. **Submission is BLOCKED.**

Total criteria: 61; green 17; red 44.

## Correspondence

| ID | Requirement | Source | Code / file | Verdict | Required closure |
|---|---|---|---|---|---|
| E01 | Original application and recruitment conversation reconstructed | Gmail/Technical Brief | docs/FINAL_HANDOFF_2026-10-09/EMAIL_CHRONOLOGY.md | ✅ GREEN — documented/offline verified | Retain thread reference |
| E02 | October 16 Friday deadline replaces obsolete Feb 9 IST | Gmail/Technical Brief | EMAIL_CHRONOLOGY.md | ✅ GREEN — documented/offline verified | Submit by Oct 16; confirm time zone if needed |
| E03 | Evaluation GitHub collaborator @paluchi | Gmail/Technical Brief | docs/FINAL_HANDOFF_2026-10-09/EMAIL_CHRONOLOGY.md | ✅ GREEN — documented/offline verified | Add @paluchi if repo private; document public repo access |
| E04 | Six-page Technical Brief emailed before coding | Gmail/Technical Brief | reference/submitted_technical_brief_2026-10-08.pdf | ✅ GREEN — documented/offline verified | Do not resend |
| E05 | Final email to Gonzalo, cc Elisa with submission | Gmail/Technical Brief | - | ❌ RED — not proven end-to-end | Draft for explicit user review; do not send automatically |

## Ground rules

| ID | Requirement | Source | Code / file | Verdict | Required closure |
|---|---|---|---|---|---|
| G01 | No Firebase database listeners, managed realtime transport or browser polling | ASSESSMENT.md:L108 | apps/web/src/socket.ts; src/server/http-socket.ts | ❌ RED — not proven end-to-end | Inspect browser DevTools for a minute / no polling |
| G02 | Native Gemini function calling; model chooses tool, server executes | ASSESSMENT.md:L119 | src/worker/gemini.ts; src/tools.ts | ❌ RED — not proven end-to-end | Run live tool-driven prompts, inspect tool traces |
| G03 | All catalog/store/coefficient responses grounded in fetched tenant data | ASSESSMENT.md:L121 | src/server/sql-tools.ts; src/worker/verified-block.ts | ❌ RED — not proven end-to-end | Attempt 20 unfetched codes, foreign facts and malicious memories |
| G04 | No cross-tenant disclosure via any interface, read, memory, error | ASSESSMENT.md:L123 | db/migrations/001_schema.sql; src/persistence/postgres.ts | ❌ RED — not proven end-to-end | Run required real PostgreSQL tests + adversarial attacks |
| G05 | Firebase Auth, Vertex AI Gemini, Cloud Run, Firebase Hosting, React/TypeScript | ASSESSMENT.md:L125 | apps/web/src/App.tsx; deploy/Dockerfile.api; deploy/Dockerfile.worker | ❌ RED — not proven end-to-end | Prove Firebase Hosting + Cloud Run + real login |
| G06 | Only supplied datasets; no live catalog lookup at request time | ASSESSMENT.md:L127 | src/fixtures.ts; src/server/sql-tools.ts | ✅ GREEN — documented/offline verified | Verify fixture hashes on target deployment |

## Employer evaluation

| ID | Requirement | Source | Code / file | Verdict | Required closure |
|---|---|---|---|---|---|
| S01 | Portable AC code & margin, two users watch fetch | ASSESSMENT.md:L190 | src/catalog-search.ts; src/worker/gemini.ts; apps/web/src/App.tsx | ❌ RED — not proven end-to-end | Two live browsers; trace/logs/code |
| S02 | Reverse code-to-description lookup | ASSESSMENT.md:L191 | src/server/sql-tools.ts | ❌ RED — not proven end-to-end | Live get_catalog_code call |
| S03 | AC + SSD in same query | ASSESSMENT.md:L192 | src/catalog-search.ts; src/tools.ts | ❌ RED — not proven end-to-end | Real native Gemini calls; both families |
| S04 | Beekeeping veils must return no data | ASSESSMENT.md:L193 | src/worker/verified-block.ts; src/catalog-search.ts | ❌ RED — not proven end-to-end | Live no-match and zero invented codes |
| S05 | ST-4003 margin score and class supersession | ASSESSMENT.md:L194 | src/retail.ts; src/server/sql-tools.ts | ❌ RED — not proven end-to-end | Check retained/removed classes and no fabricated money |
| S06 | ST-4007 gaps+evidence+coefficient result | ASSESSMENT.md:L195 | src/server/sql-tools.ts; apps/web/src/verified.ts | ❌ RED — not proven end-to-end | Store + calculation tools in order; source refs |
| S07 | Compare two proposed codings | ASSESSMENT.md:L196 | src/retail.ts; src/server/sql-tools.ts | ❌ RED — not proven end-to-end | Direct B-minus-A authoritative result |
| S08 | Paraphrased seeded memory from different room | ASSESSMENT.md:L197 | src/worker/embeddings.ts; src/server/sql-tools.ts | ❌ RED — not proven end-to-end | Real Vertex embeddings/backfill; author/date/ref |
| S09 | New contact/deadline accessible across users and rooms | ASSESSMENT.md:L198 | src/server/sql-tools.ts; db/migrations/007_semantic_memory.sql | ❌ RED — not proven end-to-end | Save consent; refresh user B, search other room |
| S10 | Nested memory validation and single repair attempt | ASSESSMENT.md:L199 | src/memory.ts; src/worker/gemini.ts | ❌ RED — not proven end-to-end | Actual invalid nested payload and repair path |
| S11 | Overlapping tracked target tenant-only | ASSESSMENT.md:L200 | src/server/sql-tools.ts; db/migrations/001_schema.sql | ❌ RED — not proven end-to-end | Both tenants same intent, isolation verified |
| S12 | Foreign store invisible after forged access claim | ASSESSMENT.md:L201 | src/server/sql-tools.ts; src/tenant.ts | ❌ RED — not proven end-to-end | Unknown == foreign response; logs generic |
| S13 | Admin-mode prompt injection no bypass | ASSESSMENT.md:L202 | src/worker/gemini.ts; src/server/sql-tools.ts | ❌ RED — not proven end-to-end | Attack prompt and memory injection live |
| S14 | Two concurrent AI turns independent | ASSESSMENT.md:L203 | src/server/ai-jobs.ts; src/worker/gemini.ts | ❌ RED — not proven end-to-end | Two simultaneous turns, separate tool IDs |
| S15 | Refresh mid-turn replays full answer and tool results | ASSESSMENT.md:L204 | src/server/ai-jobs.ts; apps/web/src/transcript.ts | ❌ RED — not proven end-to-end | Refresh browser during active Gemini call |
| S16 | 30-second disconnect ordered gap-free replay | ASSESSMENT.md:L205 | src/server/http-socket.ts; apps/web/src/socket.ts | ❌ RED — not proven end-to-end | Network offline 30s; no missing/duplicates |
| S17 | Idle one socket and no polling or resource growth | ASSESSMENT.md:L206 | apps/web/src/socket.ts; src/server/http-socket.ts | ❌ RED — not proven end-to-end | Browser network/CPU/heap on idle |
| S18 | Valley gets only its own tenant answer | ASSESSMENT.md:L207 | src/server/sql-tools.ts; db/migrations/001_schema.sql | ❌ RED — not proven end-to-end | Test both tenants, foreign/no-match equivalence |
| S19 | Cold-start persistence of saved shared memory | ASSESSMENT.md:L208 | src/server/sql-tools.ts; src/worker/embeddings.ts | ❌ RED — not proven end-to-end | Scale down/restart worker+API, query memory |

## Phase 1

| ID | Requirement | Source | Code / file | Verdict | Required closure |
|---|---|---|---|---|---|
| B01 | Brief sent before application code | ASSESSMENT.md:L17 | reference/submitted_technical_brief_2026-10-08.pdf | ✅ GREEN — documented/offline verified | Preserve original email and PDF |
| B02 | User stories with acceptance criteria | ASSESSMENT.md:L158 | Technical Brief pp.1–2 | ✅ GREEN — documented/offline verified | Present committed scope |
| B03 | Derived requirements | ASSESSMENT.md:L160 | Technical Brief pp.1–2 | ✅ GREEN — documented/offline verified | Explain tenant context, durable ACKs |
| B04 | Alternatives and architecture tradeoffs | ASSESSMENT.md:L162 | Technical Brief pp.2–4 | ✅ GREEN — documented/offline verified | Discuss PostgreSQL NOTIFY vs Redis |
| B05 | Data model and performance tradeoffs | ASSESSMENT.md:L164 | Technical Brief p.3 | ✅ GREEN — documented/offline verified | Explain RLS and room seq lock |
| B06 | Explicit exclusions and risks | ASSESSMENT.md:L166 | Technical Brief p.6 | ✅ GREEN — documented/offline verified | Keep README divergence accurate |

## Deliverables

| ID | Requirement | Source | Code / file | Verdict | Required closure |
|---|---|---|---|---|---|
| D01 | Deploy public Firebase Hosting app with seeded data | ASSESSMENT.md:L217 | apps/web/firebase.json; deploy/Dockerfile.api | ❌ RED — not proven end-to-end | Deploy and verify public URL |
| D02 | GitHub repository, clean commit history, no secrets, repeatable seed | ASSESSMENT.md:L218 | https://github.com/engasm89/teamchat-ai; scripts/generate-seed-sql.ts | ✅ GREEN — documented/offline verified | Published clean history at https://github.com/engasm89/teamchat-ai without secrets |
| D03 | README complete: run/deploy/transport/agent/recovery/brief divergence/limits | ASSESSMENT.md:L172 | README.md; docs/DEPLOYMENT_CHECKLIST.md | ❌ RED — not proven end-to-end | Update instructions after live verification |
| D04 | Test credentials for 3+ users in each tenant | ASSESSMENT.md:L220 | scripts/provision-demo-users.ts | ❌ RED — not proven end-to-end | Provision 6 Firebase users; share secrets privately |
| D05 | Tests for tenant isolation, grounding, and arithmetic | ASSESSMENT.md:L221 | tests/*.test.ts; scripts/integration/live-postgres.test.ts | ❌ RED — not proven end-to-end | Run actual RLS with restricted login and Gemini adversarial tests |
| D06 | Demo video max five minutes | ASSESSMENT.md:L222 | - | ❌ RED — not proven end-to-end | Record truthful 5m or shorter video |
| D07 | Submission includes repo URL, live URL, private credentials, and brief | ASSESSMENT.md:L236 | docs/FINAL_HANDOFF_2026-10-09/EMAIL_CHRONOLOGY.md | ❌ RED — not proven end-to-end | Draft final email after passing gates |
| D08 | Seed genuine fetched AI history in both tenants | ASSESSMENT.md:L180 | scripts/bootstrap-live-demo-history.ts | ❌ RED — not proven end-to-end | Run genuine model/tool exchange, inspect DB replay |
| D09 | 3+ users per tenant and populated rooms | ASSESSMENT.md:L180 | scripts/provision-demo-users.ts; db/generated/seed.sql | ❌ RED — not proven end-to-end | Create real Firebase accounts and room memberships |

## Engineering/brief gaps

| ID | Requirement | Source | Code / file | Verdict | Required closure |
|---|---|---|---|---|---|
| A01 | API/worker SIGTERM/SIGINT closes server, WebSockets, listeners and pool | Gmail/Technical Brief | src/runtime/shutdown.ts; src/server/start.ts; src/worker/start.ts | ✅ GREEN — documented/offline verified | Live send SIGTERM and verify exit/drain |
| A02 | No late presence/typing frames after unsubscription | Gmail/Technical Brief | apps/web/src/socket.ts | ✅ GREEN — documented/offline verified | Live switch rooms under rapid typing and presence |
| A03 | Offline tests finish with 0 failed | Gmail/Technical Brief | tests/*.test.ts | ✅ GREEN — documented/offline verified | Run again after installing pinned dependencies |
| A04 | Backend type-check passes under temporary external node types | Gmail/Technical Brief | tsconfig.json; src/**/*.ts | ✅ GREEN — documented/offline verified | npm ci and repeat in clean CI |
| A05 | All five supplied fixture hashes unchanged | Gmail/Technical Brief | teamchat-ai-seed-data/* | ✅ GREEN — documented/offline verified | Do not mutate fixture data |
| A06 | SQL seed generates 2,753 inserts | Gmail/Technical Brief | scripts/generate-seed-sql.ts; db/generated/seed.sql | ✅ GREEN — documented/offline verified | Run actual migrations + seed twice |
| A07 | Genuine root/web npm package-locks and npm ci | Gmail/Technical Brief | package.json; apps/web/package.json | ✅ GREEN — documented/offline verified | Locks generated against registry, committed, verify:packaging passes |
| A08 | Real PostgreSQL RLS + grants + forbidden-write isolation | Gmail/Technical Brief | db/provision_runtime_role.sql; scripts/integration/live-postgres.test.ts | ✅ GREEN — documented/offline verified | Proven against local PostgreSQL 17 + pgvector + restricted teamchat_api login; test:postgres:required 1/1 pass |
| A09 | Vite/React production build and hosted asset load | Gmail/Technical Brief | apps/web/package.json | ✅ GREEN — documented/offline verified | apps/web build passes clean with typed vite/client; production bundle generated |
| A10 | Cloud Tasks OIDC, recovery, duplicate dispatch | Gmail/Technical Brief | src/server/task-dispatch.ts; src/worker/http.ts | ❌ RED — not proven end-to-end | Inject failures and verify end-to-end terminal state |
| A11 | Gemini model native stream + parallel function calls | Gmail/Technical Brief | src/worker/gemini.ts | ❌ RED — not proven end-to-end | Real Vertex calls under pinned model |
| A12 | Cross-instance LISTEN/NOTIFY, bounded socket resources | Gmail/Technical Brief | src/server/http-socket.ts; src/server/database.ts | ❌ RED — not proven end-to-end | Deploy 2 instances, network loss, leak tests |
| A13 | Original Technical Brief monetary-baseline promise | Gmail/Technical Brief | src/retail.ts; src/server/sql-tools.ts | ❌ RED — not proven end-to-end | Implement verified user-provided baseline or document cut explicitly |
| A14 | Memory paraphrase retrieval using 768-dim embeddings | Gmail/Technical Brief | src/worker/embeddings.ts; db/migrations/007_semantic_memory.sql | ❌ RED — not proven end-to-end | Backfill and test cross-room paraphrases |
| A15 | Actual 3-user x 2-tenant seeded chat with genuine AI exchange | Gmail/Technical Brief | scripts/bootstrap-live-demo-history.ts | ❌ RED — not proven end-to-end | Run script and verify as reviewer |
| A16 | Reviewer GitHub @paluchi actually has access | Gmail/Technical Brief | - | ✅ GREEN — documented/offline verified | Public repository published at https://github.com/engasm89/teamchat-ai accessible to @paluchi |

