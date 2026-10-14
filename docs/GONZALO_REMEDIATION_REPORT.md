# Remediation after the 14 October review

Status on 14 October 2026, 23:05 Cairo (20:05 UTC). Branch `fix/gonzalo-conversational-review`; tested source `ac07134`.

**In one paragraph.** All three requested changes are built and pass on an isolated staging stack:

- an AI that answers in natural language, decides for itself whether to call a tool, and knows who said what;
- display names and auto-scroll;
- tenant-wide new chats.

The original scenarios S01–S19, A02, A10 and A12 also pass there, against the exact deployed source (`ac07134`). **Production has not been changed.** It still runs the earlier release (`teamchat-api-00016-ct7`, `teamchat-worker-00016-24v`). The production rollout needs a decision only Ashraf can make: the migration has to run as the schema owner `postgres`, whose password is not available to me (see "Human-only actions"). Until then, new chats are **STAGING PASS / PRODUCTION NOT VERIFIED**, and so is everything else in this report. This is **not** "ready for Gonzalo", because acceptance criterion 2 (a live authorized production build) is not met.

## The review

Gonzalo's feedback, sent 14 October 2026, 12:26:27 UTC:

1. "The AI is not very responsive … The expects are for the LLM to answer in natural language and decide itself if it makes sense to call a tool. The chatbot should be able to get context about the conversation, see who said what etc."
2. "Can you improve the UX with auto scrolling and a name per user?"
3. "Can you add the capability to start a new chat within the tenant scope?"

## What the reviewer account experienced (forensic summary)

Method: `scripts/forensics/reviewer-session.ts`, read-only. It uses Firebase Admin for the UID only. It reads PostgreSQL as `teamchat_api` inside `BEGIN TRANSACTION READ ONLY`, with transaction-local tenant context and row-level security active, after asserting the role, read-only mode and `rolbypassrls=false`. It then reads Cloud Logging by turn ID. Raw outputs, the exact prompts and the per-message table stay in the git-ignored `audit/` folder and are not reproduced here.

`northside.buyer1@teamchat.internal` is a shared assessment account, so the activity is attributed to the account, not to a person.

- **RECORDED.** On 14 October, 12:17–12:21 UTC, the account sent 8 messages in `#assortment-review`, and no others that day.
  - 5 started AI turns. 3 "completed" with the canned reply "I have no record of that."
  - 2 failed after 5 attempts each, 14 s and 47 s after sending.
  - 3 messages did not start a turn: one had no mention, one used `@gemini` instead of `@AI`, and one was a typo line.
- **Root causes** (RECORDED configuration and logs, INFERRED effect):
  1. Tool choice `ANY` in round 0 forced a tool call even for greetings. Gemini picked the nearest tool: a memory search with the user's words, or a catalog search with an empty query.
  2. Gemini's text was discarded. Only function calls were kept, and empty results became a canned line.
  3. The history was one flattened user message with raw UIDs, and no model turns.
  4. "Invalid query" was not classified as a permanent error. Cloud Tasks retried it 5 times, then the turn failed with a generic message.
  5. The UI showed UIDs, did not auto-scroll, printed tool JSON raw, and had no way to create a chat.

## Requirement status

Production status is "not deployed" for every row.

| Requirement | Original failure | Root cause | Fix | Tests | Staging |
| --- | --- | --- | --- | --- | --- |
| 1a Natural language; the model decides on tools | Canned "no record" replies; greetings forced into tool calls | `ANY` mode; text discarded | `src/worker/gemini.ts`: `createGeminiProvider` (AUTO every round), `collectGeminiResponse` (keeps text and calls), `executeAiJob` (direct path for checked `say` text) | `tests/native-gemini-stream.test.ts`, `scripts/integration/tenant-chats.test.ts` ("small talk is answered directly…") | **PASS**: C01, C05, REPLAY |
| 1b Conversation context, who said what | "What is this chat about?" answered with a memory search | Flattened history with UIDs | `buildConversationContents` (named user turns, model turns, current request marked); `message_quote` fact | `tests/planner-context.test.ts` | **PASS**: C02, C03, REPLAY (summaries of the room) |
| 1c Responsive, never a silent failure | 14–47 s, then "AI processing failed" | Bad arguments retried as transient | `toolArgumentError` sends the error back to Gemini; `withGeminiRetry` only retries outages; progress events `ai_turn_started` and `ai_retrying` | tenant-chats ("a bad tool argument goes back to Gemini…", "Gemini outages retry…") | **PASS**: latencies below |
| 2a A name per user | UIDs shown | UI never mapped UIDs | `apps/web/src/App.tsx` and `turns.ts` (`displayName`, initials, "AI Assistant"); source blocks map "Recorded by" (`verified.ts`) | `tests/frontend-turns.test.ts`, `tests/frontend-verified.test.ts` | **PASS**: REPLAY "no answer shows a Firebase UID"; browser suite |
| 2b Auto-scroll | No scrolling | Not implemented | `App.tsx`: follows when near the bottom, otherwise shows "Jump to latest" | `tests/frontend-turns.test.ts`; browser UX-BROWSER | **PASS**: UX-BROWSER |
| 3 New chat within the tenant | No create path | Only `GET /api/rooms` | `db/migrations/008_tenant_chats.sql`; `createTenantChat` (`src/persistence/postgres.ts`); `POST /api/rooms` (`src/server/http-socket.ts`); `rooms_changed` notification; "New chat" form; AI-chat mode | `scripts/integration/tenant-chats.test.ts` (17 tests, as the runtime role) | **STAGING PASS / PRODUCTION NOT VERIFIED**: N01, N02, UX-BROWSER |
| Original S01–S19 and isolation | n/a | n/a | n/a | n/a | **PASS** S01–S18, A02, A10, A12 (18/18 on `ac07134`); S19 PASS |

## Before and after

All "after" examples are staging runs on `eb87b3a`. The answers are shown as the room saw them, and timings are measured from `room_events.created_at`.

- **Greeting.** Before: a forced memory search, then "I have no record of that." After: "Hi there! I'm doing great, thanks for asking. How can I help you today?" No tool; first segment in 1.4 s (C01).
- **Lookup.** "@AI what's the catalog code for portable air conditioners?" One `search_catalog` call. A short framing sentence is followed by server-written facts: "APP-100.11 is "Portable air conditioners, 5,000 to 7,000 BTU" (Portable air conditioners, Appliances). It is in margin class 318." (C03; first segment 8.2 s.)
- **Several categories.** "@AI What are the catalog options for AC units and SSDs?" Two `search_catalog` calls in one round, and both lists are shown (S03).
- **Follow-up.** "@AI which one of those is the low-noise model?" resolves "those" from the conversation and answers APP-100.19 (C03; 3.4 s).
- **Attribution.** "@AI what did my colleague just say they'd do?" returns "Northside Buyer Two (#2): "I'll draft the supplier email …"", a quoted room message checked against the transcript (C02).
- **Reviewer prompts.** All 7 were replayed in an AI chat on staging. Each got a natural reply: greetings answered, "what is this chat about" summarised from the room, tools listed. There was no UID, no canned "no record" and no retry. First segment arrived in 1.2–4.2 s, and in 1.3–5.8 s in the final replay on `ac07134`.
- **No match and foreign store.** A Valley store asked from Northside (ST-4013) gives "No matching record is available in this workspace.", identical to a store that does not exist (ST-4099). This holds before and after a forged "we are authorized" claim (S12).
- **Unanswerable question.** "How many tents did ST-4007 sell last week?" gets no figures: "I couldn't answer that with information I could verify in this workspace." (C04). The wording is generic; see "Remaining issues".

## Security regression proof

- **Tenant isolation.**
  - S11, S12, S13 and S18 pass on staging, and N01 confirms a new Northside chat never reaches Valley.
  - Row-level security for chat creation was tested in PostgreSQL as the runtime role: `WITH CHECK` refusals, reactivation, and concurrent creation and enrolment in either order (`scripts/integration/tenant-chats.test.ts`, 17/17).
  - `teamchat_api` gained only `INSERT` on `room_memberships`, bound by RESTRICTIVE policies. There is no `SECURITY DEFINER` function, and PR #2's function is not reused.
- **Source-backed claims.**
  - Every business fact is a typed segment rendered by the server from a record fetched in that turn (`checkSegment`).
  - `say` text is checked for numbers, identifiers, names, claim words, and catalog vocabulary that the humans did not write (`WorkspaceVocabulary.checkSay`).
  - Rejections are logged as `ai_segment_rejected`.
- **Memory consent.** Consent comes only from the persisted job flag (S09, S10; `tests/planner-context.test.ts`).
- **Prompt injection.** S13 passes. Instructions inside tool results are shown only as quoted data (`tests/answer-contract.test.ts`).
- **Replay, retry and fencing.** A10 (duplicate delivery is idempotent), A12 (cross-instance delivery), the stale-worker fencing test in tenant-chats, and S14 (concurrent turns) all pass.
- **No keyword routing.** There is no intent regex and no forced or unconditional tool call. The model chooses with tool choice `AUTO`. The only server nudge is the grounded escalation note, sent when a no-tool draft fails the segment checks.

## Test results

Local, on the final source:

| Command | Result |
| --- | --- |
| `npm run check` | pass |
| `npm test` | 179/179 pass, 0 cancelled |
| `npm run test:tenant-chats` (local PostgreSQL, runtime role) | 17/17 pass |
| `npm run test:postgres:required` against `teamchat_staging` as `teamchat_api_staging` (via cloud-sql-proxy) | 1/1 pass, 0 skipped (`qa_evidence/staging/postgres-required-staging.log`) |
| `npm --prefix apps/web run build` | pass |
| New and changed tests on the old code (`main` @ `5da04b0`) | 11 of 17 fail as expected: `qa_evidence/remediation/old-code-new-tests.tap` |
| Old release (`d66da3d`, the source of production 00016) against a 008-migrated database | PASS, 6/6: sign-in, room list including a new chat, send, `@AI` with a tool, posting into a new chat, replay equals the database (`qa_evidence/staging/runs/20261014T182607Z-compat-old-release-42d607`) |

Staging (`TEAMCHAT_TARGET=staging`). Every run is bound to the digests serving at the time:

| Source | Suite | Result | Evidence |
| --- | --- | --- | --- |
| `4bf13f0` | employer acceptance | 17/18 (S10 failed) | `qa_evidence/staging/runs/20261014T182752Z-acceptance-e10fcd` |
| `8fe96b8` | employer acceptance | 16/18 (S09, S10 failed) | `…/20261014T184201Z-acceptance-646f95` |
| `8fe96b8` | conversational | 7/7 | `…/20261014T184844Z-conversational-7f6b69` |
| `282ab9f` | employer acceptance | 17/18 (S06 failed) | `…/20261014T185347Z-acceptance-18e348` |
| `282ab9f` | conversational | 7/7 | `…/20261014T190036Z-conversational-e54380` |
| `eb87b3a` | employer acceptance | **18/18** | `…/20261014T190357Z-acceptance-224ea6` |
| `eb87b3a` | conversational | **7/7** | `…/20261014T191103Z-conversational-7b6647` |
| `eb87b3a` | reviewer replay (private output under `audit/`) | **PASS** (5 assertions) | `audit/gonzalo-2026-10-14/staging-runs/20261014T191220Z-reviewer-replay-486b10` |
| `eb87b3a` | browser | 9/9 | `…/20261014T191302Z-browser-d8632d` |
| `bfa0edf` | employer acceptance | S10 failed (embedding stall); run interrupted to ship the fix | `qa_evidence/staging/s10-embedding-stall-bfa0edf.log` |
| `ac07134` | employer acceptance, run 1 | 17/18: A12 failed because a local API instance orphaned by the interrupted `bfa0edf` run still held port 18080, so the new instance could not start. The orphan was killed; run 2 passed A12 | `…/20261014T194100Z-acceptance-ba2f84` |
| `ac07134` | conversational | **7/7** | `…/20261014T194625Z-conversational-31e775` |
| `ac07134` | reviewer replay (private output under `audit/`) | **PASS** (5 assertions; all 7 prompts got a natural reply, no tool needed, first segment 1.3–5.8 s, none retried) | `audit/gonzalo-2026-10-14/staging-runs/20261014T194749Z-reviewer-replay-e5b560` |
| `ac07134` | browser, including UX-BROWSER (names, auto-follow and Jump to latest, no page overflow, a new chat seen live by a teammate, AI chat without `@AI`) | **10/10** | `…/20261014T194833Z-browser-47506f` |
| `ac07134` | S19 (`--restart`) | **PASS** | `…/20261014T195417Z-acceptance-restart-768612` |
| `ac07134` | employer acceptance, run 2 (after the S19 restart) | **18/18** | `…/20261014T195527Z-acceptance-cc2c94` |

Earlier failures are kept on purpose. Each one led to a fix, described below.

## What changed during staging, and why

- **S10 (`4bf13f0`, `8fe96b8`).** With tool choice `AUTO`, Gemini read the `save_memory` description ("nested structures are rejected") and refused in prose instead of calling the tool. On the real room history it called the tool 1 time in 5. The description now leaves validation to the server, which made it 5 in 5. The server already uses the requester's own JSON verbatim and performs the single controlled repair. Evidence: `qa_evidence/experiments/save-memory-auto-live-{before,after}.json`. Guarded by `tests/memory-value-json.test.ts`, which fails on the old description.
- **Reviewer replay (`8fe96b8`).** "What is this chat about?" fell back to a generic sentence: the summary used words the humans had typed ("outerwear"), and the catalog-vocabulary check blocked them. The `say` check now allows words from human messages in the conversation shown to the model. Earlier AI answers are excluded, and names, numbers, codes and claim words are still blocked. Covered by `tests/answer-contract.test.ts`.
- **S06 (`282ab9f`).** Gemini fetched the store's gaps but did not price closing them. A planner sentence ("Answer every part of the request…") raised the second-round tool call from 5/8 to 7/8 in a replay of the recorded turn (`qa_evidence/experiments/s06-answer-every-part.json`). This is guidance, not forcing, so it can still happen occasionally.
- **S10 embedding stall (`bfa0edf`).** After the controlled repair, the embedding request for the saved memory never answered. The turn failed 301 s later with "fetch failed" (undici's 300 s headers timeout), so the human saw a failure instead of the saved record (`qa_evidence/staging/s10-embedding-stall-bfa0edf.log`). `withEmbeddingTimeout` (`src/worker/embeddings.ts`) now aborts each attempt after 15 s and retries once. The Vertex SDK was checked to honour the abort signal. Covered by `tests/semantic-memory.test.ts`, which cannot pass without the function.
- **Fallback wording.** The no-source fallback no longer says "I couldn't find a confirmed record", which was misleading for saves and small talk. It now says "I couldn't answer that with information I could verify in this workspace."

### Test changes and why they are not weaker

- **S09 oracle.** It used to require the saved value to contain "Dana <random tag>" as one string. The tag looks like an ID, and Gemini sometimes stores the name and the ID as separate fields (2 of 5 in `save-memory-auto-isolated-after.json`). The check now requires "Dana", the unique tag and the deadline to each be stored verbatim. Recall must return that record. Valley must not see the unique tag anywhere, which is stricter than before.
- **Reviewer replay.** Added "every prompt got a real reply, not only the generic fallback". The earlier version passed while the fallback bug was visible.
- **`scripts/integration/tenant-chats.test.ts`.** The forged-claim check now inspects only the text shown to users, because generated UUIDs and timestamps containing "500" produced false failures.
- **Acceptance runners.** These now take an explicit target and write staging evidence to `qa_evidence/staging/runs`. The assertions are unchanged apart from the two items above. `expectedProjection` now also counts `ai_answer_segment` events, the new event type.

## Staging stack

- **Isolation.**
  - Services `teamchat-api-staging` and `teamchat-worker-staging`, service account `teamchat-staging-runner`, and queue `teamchat-ai-tasks-staging`.
  - Secret `teamchat-staging-database-url`, database `teamchat_staging` on the same Cloud SQL instance, owner `teamchat_staging_owner`, runtime role `teamchat_api_staging` (no memberships, `NOBYPASSRLS`; `CONNECT` revoked from `PUBLIC` on that database).
  - Firebase users `*.staging@teamchat.internal`, with passwords only in Keychain `teamchat-ai-staging`.
  - Hosting preview channel `staging` (<https://focus-clean-4b9f4--staging-yxk0bcnc.web.app>).
  - Proven: the staging role gets "permission denied" on the production schema. The staging service account can read only the staging secret and enqueue only to the staging queue.
- **Deployed now.**
  - Source `ac0713467542844d818e3107d6fc0c48926fb910`, Cloud Build `3e043c2a-03aa-4221-b43e-f0e2bfbc3571`.
  - API `teamchat-api-staging-00009-7fm` @ `sha256:142a5fad8b8934cc15cd9d7d3e5fb84ea12d6363d05d67ebfbd1fb1295fafd1f`.
  - Worker `teamchat-worker-staging-00009-8cx` @ `sha256:4b51303239293f1622ea3c5c1d31ccf38a543a378eaecb98e3e97a9e725dd43f`.
  - Revision 00008 was the deploy; S19 restarted both services into 00009 with the same digests.
  - Hosting version `719e276975e46c6a`, deployed from `bfa0edf`. The web app has not changed between `bfa0edf` and `ac07134`, and the served assets equal a clean-clone build at `ac07134` (`qa_evidence/staging/provenance.json`).
- **Compromise, recorded.** Staging shares the production Cloud SQL instance and GCP project, so the S19 guard cannot refuse on project equality. It refuses on services, URLs, database, secret, role, Keychain service and accounts instead (`scripts/acceptance/target.ts`, `tests/acceptance-target.test.ts`).

## Production

- **Current state, unchanged.**
  - API `teamchat-api-00016-ct7` @ `sha256:395ba7cf07c5e9a2359e6e6023e536ac5e78a955c31d45b2b065e7f5328a8374`.
  - Worker `teamchat-worker-00016-24v` @ `sha256:143dd72530d5fb9980fce223ef7da85fa31c53977b381a2916a23701ea159c69` (source `d66da3d`).
  - Hosting version `acca7910fdbc736c`.
  - The `teamchat` schema has no `schema_migrations` table, so it is at 007 and was migrated by hand.
- **Blocker.** The `teamchat` schema and its tables are owned by `postgres`. Migration 008 must run as that owner (`scripts/db/migrate.ts` refuses runtime roles and non-owners). The password is not in Secret Manager or Keychain. Resetting it with `gcloud sql users set-password` is an administrative credential change, and I did not make it.
- **No backup was taken.** The on-demand backup belongs immediately before the migration, so none was taken while the migration is blocked.

### Rollout steps (when unblocked and all gates are green)

1. Record the rollback points: the revisions and digests above, Hosting `acca7910fdbc736c`, and `schema_migrations` (absent).
2. Take the on-demand backup: `gcloud sql backups create --instance teamchat-pg-instance --project focus-clean-4b9f4`. Wait for `SUCCESSFUL` and record the ID.
3. Dry-run the migration: `MIGRATION_DATABASE_URL=<postgres via proxy> node --experimental-strip-types scripts/db/migrate.ts --dry-run`. Expect baseline 001–007 and pending 008. Then run it without `--dry-run`, and run `scripts/db/provision-runtime-role.ts` for `teamchat_api`.
4. Deploy the worker, then the API, by the digests of the tested build, so production runs the same source as staging. Then build the web app with the production URLs and deploy Hosting. Run `TEAMCHAT_TARGET=production node --experimental-strip-types scripts/evidence/record-provenance.ts`.
5. Run Gate 5 in production: S01–S18 without `--restart`, never as buyer1, in the QA rooms. There is no chat creation in production unless separately authorized.

### Rollback runbook

- **Cloud Run.** Run `gcloud run services update-traffic teamchat-api --to-revisions teamchat-api-00016-ct7=100`, and the same for `teamchat-worker` with `teamchat-worker-00016-24v`.
- **Hosting.** Run `firebase hosting:clone focus-clean-4b9f4@acca7910fdbc736c focus-clean-4b9f4:live --project focus-clean-4b9f4`. The source form is `<site>@<version>`; the rehearsal caught that `<site>:@<version>` is rejected.
- **Schema.** The schema stays at 008. It is additive, and the old release was proven to work against it (compat run above). Chats created after the rollout stay readable by the old code, which ignores `ai_chat`.
- **Backup.** The backup is for disaster recovery only, never a routine rollback.
- **Rehearsal on staging (PASS).** The same commands were run against staging on 14 October:
  - Cloud Run: traffic moved from 00008 (`ac07134`) to 00007 (`bfa0edf`) and back with `--to-latest`. `/health` returned 200 at every step (`qa_evidence/staging/rollback-rehearsal-cloudrun.log`).
  - Hosting: version `0ae01a284e045cb6` (web from `eb87b3a`) was cloned into the `staging` channel, which then served its older bundle, and version `719e276975e46c6a` was cloned back (`qa_evidence/staging/rollback-rehearsal-hosting.log`).
  - Not rehearsed: rolling production itself, and restoring a Cloud SQL backup.

## Remaining issues

- **Gemini nondeterminism.** A multi-part request can still get a partial answer (S06 7/8 in replay). Facts shown are always checked; what can be missing is part of the answer.
- **The `say` check is a heuristic.** It is conservative, and when it rejects text the user sees a neutral fallback or "I left out part of my reply…". It may still let through harmless paraphrase, or block a legitimate phrase.
- **Wording polish.** The C04 fallback is generic. Catalog lists often show two lines per code, "APP-100.16 is … It is in margin class 318." followed by "APP-100.16 has margin class 318." (visible in `…/20261014T194833Z-browser-47506f/UX-BROWSER/names-and-scroll.png`). This is redundant, not wrong, but noisy. A likely fix is for the server to drop a margin-class fact when a catalog fact in the same answer already states it. It is not done, because it would need another build and full staging run.
- **QA chats accumulate.** There is no archive or delete for chats, so every staging run adds chats to every staging Northside user's sidebar. Production is unaffected while chat-creating suites refuse the production target.
- **A12 can be fooled by a leftover process.** Its health check accepts whatever answers on port 18080. It failed correctly here, but it should check that its own child process is alive.
- **A retried turn can diverge from its persisted plan.** Tool records are fenced and replayed by operation ID, but a second Gemini call may choose different tools.
- **Shared instance.** Staging shares the production Cloud SQL instance (documented above).
- **Production `CONNECT`.** `CONNECT` on the production `teamchat` database is still granted to `PUBLIC`. Not changed; worth tightening separately.
- **Hardening carried over from before.** Cloud SQL has automated backups disabled, a public IP and unencrypted connections allowed. Unchanged.

## Human-only actions

1. **Production migration owner.** Either provide the `postgres` password privately (for example in Keychain service `teamchat-ai-prod-owner`), or authorize a reset with `gcloud sql users set-password postgres`. Then decide whether to roll out before the 1:30 PM Cairo cut line on 15 October.
2. **Production chat creation test.** Authorize it, or accept "STAGING PASS / PRODUCTION NOT VERIFIED". New chats appear in every Northside user's list, including the reviewer's.
3. **Pull request and merge.** No pull request has been opened, because a new PR could notify repository watchers outside the team. Open one from `fix/gonzalo-conversational-review` when you want to, review it, and merge it to `main`. `main` is protected, and merging needs your approval.
4. **PR #2.** Close it as superseded.
5. **Reply to Gonzalo.** Review and send it yourself. A suggested note is in `audit/gonzalo-2026-10-14/SUGGESTED_GMAIL_REPLY_PRIVATE.md`. Nothing has been sent to anyone at Controlease.
