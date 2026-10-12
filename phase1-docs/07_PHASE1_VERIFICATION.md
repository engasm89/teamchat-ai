# Phase 1 verification record — TeamChat AI

**Owner:** Ashraf Al-Madhoun  
**Date:** 9 October 2026  
**Status:** Phase 1 deliverables VERIFIED. Stage 2 implementation NOT STARTED IN THIS SESSION.

## 1. Evidence of required Phase 1 submission

- Gmail sent message ID: `1a11cb0c10ca3fc6`.
- Sent: **8 October 2026, 18:05:07 (+03:00)** (mailbox connector email timestamp).
- To: `gonzalo@controlease.net`; CC: `elisa@controlease.net`.
- Attachment: `TeamChat_AI_Technical_Brief_Ashraf.pdf`, preserved byte-for-byte in this package under `TeamChat_AI_Technical_Brief_SUBMITTED_2026-10-08.pdf`.
- PDF: **6 pages**, rendered and visually reviewed, includes user stories and acceptance checks, implicit requirements, design/alternatives, data model, cuts and risks.
- This establishes email submission. The ordering relative to the *first application code commit* must be checked when the actual repository is located. No runnable application appears in the two provided ZIP packages.

## 2. Employer requirements and document provenance

Precedence: employer clarification > unmodified `ASSESSMENT.md` > six-page submitted PDF > supporting agent planning documents. The pack's `ORIGINAL_ASSESSMENT.md` matches the original employer document byte for byte. The submitted technical brief is **not** revised or resubmitted.

- Employer clarified delivery deadline: **Friday, 16 October 2026**; exact hour and timezone not specified in the clarification. The stale February 9 date in the source file is not operative.
- Repository may be selected by Ashraf; public GitHub is intended based on sent reply. No GitHub repository URL or reviewer handle has been verified.
- Gonzalo additionally emphasized module separation, architecture flexibility, scalability, self-documentation and avoiding memory/resource leaks.

## 3. Verified fixture facts

| Source | Verified records | Key finding |
|---|---:|---|
| `product_codes.csv` | 1,000 | 1,000 unique catalog codes; 289 missing margin classes; 100 unspecified entries |
| `promo_coefficients.csv` | 44 | Class 318 supersedes 319/321, and 319 supersedes 321; all referenced targets exist |
| `segment_coefficients.csv` | 12 | channel / store format / segment cross-sections |
| `stores.json` | 24 | 12 Northside / 12 Valley; all carried/gap code references resolve to catalog |
| `team_memory_seed.json` | 8 | 4 per tenant; shared key `q1_assortment_target` needs strict isolation |

Source byte hashes are in `DATA_FIXTURE_MANIFEST.json`. The source files were not edited.

### Verified scoring examples (implementation golden values only)

These are *not employer-prescribed monetary calculations*. They validate the score assumption documented in the submitted brief: **score = sum of non-superseded, distinct mapped-class coefficients for the store's segment × channel/format/segment coefficient**. Use Decimal, retain full precision internally, and label these numbers as dimensionless **assortment score**, not sales/revenue or percentage.

- **Northside ST-4003**: baseline score `1.047585`; adding `APP-100.12` = `1.047585`; delta **0.000000** because class 318 already exists.
- **Northside ST-4007**: baseline score `0.984775`; adding `APP-100.11`, `.12`, `.13`, plus `APP-169.16` = `1.100550`; delta **0.115775**. Class 318 supersedes 321 in this combination.
- A monetary figure cannot be inferred without a user-provided baseline and an explicit assumption; score deltas are not percentages or forecasts.
- **Known contradiction:** ST-4003 carries mapped class-318 `APP-100.11` and unmapped `APP-100.99`; its suspected-gap evidence portrays an unspecified-line assortment. Display that discrepancy rather than overwriting it.

## 4. Architecture commitment (documented, not implemented)

- React/TypeScript on Firebase Hosting; Firebase Authentication identity only in client.
- Node.js/TypeScript Cloud Run API with one native browser WebSocket per session; no managed realtime client sync or polling.
- Cloud SQL PostgreSQL + pgvector with server-derived tenant context, forced RLS, composite tenant keys and separate migration/runtime roles.
- Transactional room sequence/event ledger/outbox + PostgreSQL NOTIFY wakeups + dedicated LISTEN connection per API instance; replay is authoritative after disconnect and cross-instance failover.
- Private Cloud Run AI worker dispatched via Cloud Tasks with OIDC; durable turn state, idempotency, leasing and fencing.
- Vertex AI Gemini native function calling, server-executed tenant-scoped tools, fetched-source ledger and validated incremental answer blocks.
- Memory shared within tenant across rooms, with source/creator timestamps and guarded flat-value schema.

Official documentation checked on 9 October 2026:
- Cloud Run WebSockets: https://docs.cloud.google.com/run/docs/triggering/websockets (request timeout, reconnect and inter-instance sync).
- Cloud SQL Cloud Run connections: https://docs.cloud.google.com/sql/docs/postgres/connect-run (connection caps/pools).
- Vertex AI native function calling: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling.
- Cloud Tasks OIDC: https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks.

## 5. Risk register and unresolved decisions

| Risk | Consequence | Action before or during Phase 2 |
|---|---|---|
| GCP/Firebase permissions, billing or quotas not verified | deployment / Gemini / DB blocked; unexpected spend | Read-only account/project audit; ask before billable provisioning |
| Cloud SQL + dedicated LISTEN sockets across Cloud Run instances | connection budget, listener failure and memory/resource leaks | set max instance/connection caps; test two instances, listener death and reconnect |
| Structured, validated answer blocks vs token-by-token narrative | evaluator may reject apparent non-streaming | test visible progressive blocks with real Vertex AI; disclose documented trade-off |
| Class-scoring formula not provided by employer | wrong business interpretation, especially when asked for money | show exact inputs, deterministic score and explicit baseline requirement; version deviations |
| Memory embeddings, Gemini model/region and quotas unavailable | semantic retrieval or native tool calls blocked | pin verified supported model/embedding configuration; no false fallback claims |
| Foreign store / memory / room lookup | immediate pass/fail gate | restricted-role RLS + negative tests + model prompt-injection tests |
| Reconnection and persisted AI jobs | lost turns, order races, duplicates | write/replay ordering tests, idempotency and worker retry tests before UI polish |
| Missing deadline hour/timezone | last-minute cutoff risk | target completed final delivery by 15 October, not last hour of the 16th |

## 6. Phase 1 exit / Phase 2 entry

**COMPLETE:** original requirements audited; seed counts and references checked; architecture, alternatives and data model documented; six-page Technical Brief confirmed sent before this session; acceptance matrix E01–E20, H01–H18 and hard gates G01–G06 documented.

**NOT CLAIMED:** cloud account access, deployment, actual tenant SQL isolation, live Gemini behavior, running code, test passes, and final submission. Phase 2 must supply implementation evidence; documentation is not a passing test.

**Next single action:** inspect any pre-existing GitHub repository and GCP/Firebase project/billing/quotas read-only. Confirm the first application commit happened after 8 October 2026 18:05:07 +03:00 (or verify no earlier application implementation existed). Then begin M1 schema/auth/tenant-scoped seeding.

**Communication rule:** no automatic email to Controlease; draft-only until Ashraf explicitly authorizes an individual send.
