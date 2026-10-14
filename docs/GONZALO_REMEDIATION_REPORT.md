# Remediation after the 14 October review

Status on 15 October 2026, 01:50 Cairo (14 October, 22:50 UTC). Branch `fix/gonzalo-conversational-review`. Deployed source `edbdfb2`, in staging and production.

**In one paragraph.** All three requested changes are built and **deployed to production**:

- an AI that answers in natural language, decides for itself whether to call a tool, and knows who said what;
- display names and auto-scroll;
- tenant-wide new chats.

Production runs `edbdfb2` (API `teamchat-api-00017-7gz`, worker `teamchat-worker-00017-2rb`, Hosting `33bae4d9769be62c`), the same image digests that were tested on staging. Gate 4 passed: a SUCCESSFUL on-demand backup (`1792017407307`), migration 008 applied as the schema owner, and the previous release still working on the migrated schema. Gate 5 passed in production: S01–S08, S10–S14 and S18 14/14, the browser recovery and UX suite 10/10, 0 leak-scan hits, and a median of 5.0 s per answer. No rollback was needed.

Three things keep this short of "fully verified":

- **New chats were not exercised in production.** No production chats were created, by instruction. They remain **STAGING PASS / PRODUCTION NOT VERIFIED**.
- **S06 is intermittent on staging.** Sometimes Gemini lists a store's gaps but leaves out the score change. It failed in the second acceptance run of the last two staging chains. It passed in production Gate 5 and in every offline replay.
- **S09 was not run in production.** Its recall step posts outside the QA rooms.

See "Remaining issues" for these and the rest.

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

Production runs `edbdfb2` for every row. "Production" lists what Gate 5 exercised there.

| Requirement | Original failure | Root cause | Fix | Tests | Staging | Production |
| --- | --- | --- | --- | --- | --- | --- |
| 1a Natural language; the model decides on tools | Canned "no record" replies; greetings forced into tool calls | `ANY` mode; text discarded | `src/worker/gemini.ts`: `createGeminiProvider` (AUTO every round), `collectGeminiResponse` (keeps text and calls), `executeAiJob` (direct path for checked `say` text) | `tests/native-gemini-stream.test.ts`, `scripts/integration/tenant-chats.test.ts` ("small talk is answered directly…") | **PASS**: C01, C05, REPLAY | **PASS**: S01–S08, S10–S13 answer in prose with tool choice `AUTO` |
| 1b Conversation context, who said what | "What is this chat about?" answered with a memory search | Flattened history with UIDs | `buildConversationContents` (named user turns, model turns, current request marked); `message_quote` fact | `tests/planner-context.test.ts` | **PASS**: C02, C03, REPLAY (summaries of the room) | Not run: the conversational suite and the replay create chats |
| 1c Responsive, never a silent failure | 14–47 s, then "AI processing failed" | Bad arguments retried as transient | `toolArgumentError` sends the error back to Gemini; `withGeminiRetry` only retries outages; progress events `ai_turn_started` and `ai_retrying` | tenant-chats ("a bad tool argument goes back to Gemini…", "Gemini outages retry…") | **PASS**: latencies below | **PASS**: 21 turns, median 5.0 s, p95 11.4 s |
| 2a A name per user | UIDs shown | UI never mapped UIDs | `apps/web/src/App.tsx` and `turns.ts` (`displayName`, initials, "AI Assistant"); source blocks map "Recorded by" (`verified.ts`) | `tests/frontend-turns.test.ts`, `tests/frontend-verified.test.ts` | **PASS**: REPLAY "no answer shows a Firebase UID"; browser suite | **PASS**: UX-BROWSER (names, no UID in the transcript) |
| 2b Auto-scroll | No scrolling | Not implemented | `App.tsx`: follows when near the bottom, otherwise shows "Jump to latest" | `tests/frontend-turns.test.ts`; browser UX-BROWSER | **PASS**: UX-BROWSER | **PASS**: UX-BROWSER (auto-follow, Jump to latest) |
| 3 New chat within the tenant | No create path | Only `GET /api/rooms` | `db/migrations/008_tenant_chats.sql`; `createTenantChat` (`src/persistence/postgres.ts`); `POST /api/rooms` (`src/server/http-socket.ts`); `rooms_changed` notification; "New chat" form; AI-chat mode | `scripts/integration/tenant-chats.test.ts` (as the runtime role) | **STAGING PASS / PRODUCTION NOT VERIFIED**: N01, N02, UX-BROWSER | Deployed; not exercised (no production chats by instruction) |
| Original S01–S19 and isolation | n/a | n/a | n/a | n/a | **PASS** 18/18 in run 1 on `edbdfb2`; run 2 17/18 (S06). S19 PASS | **PASS**: 14/14 (S01–S08, S10–S14, S18); browser S15, S16, S16-OFFLINE, S17 |

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
  - Row-level security for chat creation was tested in PostgreSQL as the runtime role: `WITH CHECK` refusals, reactivation, and concurrent creation and enrolment in either order (`scripts/integration/tenant-chats.test.ts`, 18/18).
  - `teamchat_api` gained only `INSERT` on `room_memberships`, bound by RESTRICTIVE policies. There is no `SECURITY DEFINER` function, and PR #2's function is not reused.
- **Source-backed claims.**
  - Every business fact is a typed segment rendered by the server from a record fetched in that turn (`checkSegment`).
  - `say` text is checked for numbers, identifiers, names, claim words, and catalog vocabulary that the humans did not write (`WorkspaceVocabulary.checkSay`).
  - Rejections are logged as `ai_segment_rejected`.
- **Memory consent.** Consent comes only from the persisted job flag (S09, S10; `tests/planner-context.test.ts`).
- **Prompt injection.** S13 passes. Instructions inside tool results are shown only as quoted data (`tests/answer-contract.test.ts`).
- **Replay, retry and fencing.** A10 (duplicate delivery is idempotent), A12 (cross-instance delivery), the stale-worker fencing test in tenant-chats, and S14 (concurrent turns) all pass.
- **No keyword routing.** There is no intent regex and no forced or unconditional tool call. The model chooses with tool choice `AUTO`. The only server nudge is the grounded escalation note, sent when a no-tool draft fails the segment checks. A second nudge, sent after a tool round, was tried and withdrawn because it made Gemini answer a colleague's question (see "What changed during staging").
- **Memory ranking.** `search_memory` now ranks memories that contain an identifier from the query (a word with a digit, such as a case ID or store code) ahead of others. This orders results only; tenant scope, the distance cut-off and the model's choice to search are unchanged.
- **The reviewer's account is protected.** The production target lists `northside.buyer1` under `protectedAccounts`, and `parseTarget` refuses any target that would sign in as it (`tests/acceptance-target.test.ts`). Gate 5 ran as `northside.analyst3`, `northside.buyer2` and `valley.buyer1`, and that account appears 0 times in its evidence.

## Test results

Local, on `edbdfb2` (exit codes recorded):

| Command | Exit | Result |
| --- | --- | --- |
| `npm run check` | 0 | pass |
| `npm test` | 0 | 189/189 pass, 0 cancelled |
| `npm run test:tenant-chats` (local PostgreSQL, runtime role) | 0 | 18/18 pass |
| `npm run test:postgres` | 0 | 0 pass, 1 **skipped** (no database configured), so it counts as not run. The required variant last ran 1/1 against staging on `ac07134` (`qa_evidence/staging/postgres-required-staging.log`); it was not rerun |
| New and changed tests on the old code (`main` @ `5da04b0`) | n/a | 11 of 17 fail as expected (`qa_evidence/remediation/old-code-new-tests.tap`); recorded on `ac07134`, not rerun |
| Old release (`d66da3d`, the source of production 00016) against a 008-migrated database | 0 | PASS 6/6, local (`qa_evidence/staging/runs/20261014T182607Z-compat-old-release-42d607`); in production see Gate 4 |

**The runners now fail loudly.** Before `5a82e6e`, an acceptance run with a FAIL still exited 0. `RunRecorder.finish()` now sets the exit code: 1 for any FAIL, 2 when something was blocked, unverified or nothing ran, and 0 only when every test passed. This covers employer acceptance (including `--restart`), the conversational suite and `--replay`, the browser suite, the compat and live-smoke suites, all through `scripts/evidence/lib.ts`. `tests/acceptance-runner-exit.test.ts` runs real recorder suites in child processes and checks exit codes 1, 0 and 2. The staging chains below show the exit codes live.

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

From `5a82e6e` on, each chain ran six steps in order from a bash script with argument arrays (no zsh `$VAR` expansion), and each step's exit code was recorded. The steps are: acceptance, conversational, reviewer replay, browser, S19 restart, then acceptance again. The replay's output is private (under `audit/`); only its verdict and exit code are given here.

| Source | Acceptance 1 | Conversational | Replay | Browser | S19 | Acceptance 2 |
| --- | --- | --- | --- | --- | --- | --- |
| `5a82e6e` | 17/18, S06, exit 1 (`…/20261014T202350Z-acceptance-171e2c`) | 5/7, C02 and C03, exit 1 (`…/20261014T203100Z-conversational-690429`) | PASS, exit 0 | 10/10, exit 0 (`…/20261014T203250Z-browser-96acb9`) | PASS, exit 0 | 18/18, exit 0 (`…/20261014T203946Z-acceptance-17c944`) |
| `fec3b9e` | 17/18, S09, exit 1 (`…/20261014T205917Z-acceptance-ba41e7`) | 7/7, exit 0 | PASS, exit 0 | 10/10, exit 0 | PASS, exit 0 | 16/18, S14 and A02, exit 1 (`…/20261014T211714Z-acceptance-9c3cd1`) |
| `a9817cc` | **18/18**, exit 0 (`…/20261014T213607Z-acceptance-d9b4d1`) | **7/7**, exit 0 | PASS, exit 0 | **10/10**, exit 0 | PASS, exit 0 | 16/18, S06 and S10, exit 1 (`…/20261014T215328Z-acceptance-c17a74`) |
| `edbdfb2` (deployed) | **18/18**, exit 0 (`…/20261014T220432Z-acceptance-842411`) | **7/7**, exit 0 (`…/20261014T221146Z-conversational-d84302`) | PASS, exit 0 | **10/10**, exit 0 (`…/20261014T221339Z-browser-25cbc8`) | PASS, exit 0 (`…/20261014T221924Z-acceptance-restart-813bfe`) | 17/18, S06, exit 1 (`…/20261014T222033Z-acceptance-f24ec8`) |

Earlier failures are kept on purpose. Each one led to a fix, described below.

## What changed during staging, and why

- **S10 (`4bf13f0`, `8fe96b8`).** With tool choice `AUTO`, Gemini read the `save_memory` description ("nested structures are rejected") and refused in prose instead of calling the tool. On the real room history it called the tool 1 time in 5. The description now leaves validation to the server, which made it 5 in 5. The server already uses the requester's own JSON verbatim and performs the single controlled repair. Evidence: `qa_evidence/experiments/save-memory-auto-live-{before,after}.json`. Guarded by `tests/memory-value-json.test.ts`, which fails on the old description.
- **Reviewer replay (`8fe96b8`).** "What is this chat about?" fell back to a generic sentence: the summary used words the humans had typed ("outerwear"), and the catalog-vocabulary check blocked them. The `say` check now allows words from human messages in the conversation shown to the model. Earlier AI answers are excluded, and names, numbers, codes and claim words are still blocked. Covered by `tests/answer-contract.test.ts`.
- **S06 (`282ab9f`).** Gemini fetched the store's gaps but did not price closing them. A planner sentence ("Answer every part of the request…") raised the second-round tool call from 5/8 to 7/8 in a replay of the recorded turn (`qa_evidence/experiments/s06-answer-every-part.json`). This is guidance, not forcing, so it can still happen occasionally.
- **S10 embedding stall (`bfa0edf`).** After the controlled repair, the embedding request for the saved memory never answered. The turn failed 301 s later with "fetch failed" (undici's 300 s headers timeout), so the human saw a failure instead of the saved record (`qa_evidence/staging/s10-embedding-stall-bfa0edf.log`). `withEmbeddingTimeout` (`src/worker/embeddings.ts`) now aborts each attempt after 15 s and retries once. The Vertex SDK was checked to honour the abort signal. Covered by `tests/semantic-memory.test.ts`, which cannot pass without the function.
- **S06 again (`5a82e6e`).** Replaying the failed turn with the history the worker really loads showed Gemini listing the gaps, writing "I will now calculate the score change", and ending its turn. Only 38/80 first rounds called `calculate_uplift`. The planner now says "Never say that you will call a tool or calculate something next: make the call in this response" (57/64). A server note after the first reply of a tool turn ("call it now, or reply DONE") reached 64/64 and shipped in `9b4f9f7` (`qa_evidence/experiments/s06-continuation.json`).
- **That note was withdrawn (`a9817cc`).** On `fec3b9e`, S14 failed: two users asked at the same instant, and after the air-conditioner turn's tool round the note made Gemini search for the *other* user's SSD question and answer it instead. Replaying through the worker loop with real tool results, 11/12 trials did this, all after the note and none before it; a note scoped to the "CURRENT REQUEST" still did 10/12. With the planner sentence alone, the S06 replay reached the calculation 12/12 before the note was ever sent. The note was removed, and an integration test pins the round count (`qa_evidence/experiments/continuation-withdrawn.json`). Answering the wrong person is worse than a partial answer.
- **S06 is still intermittent, cause unknown.** On `a9817cc` and `edbdfb2`, S06 passed in the first acceptance run and failed in the second. Replaying the failed `edbdfb2` turn 12 times with the worker's own streaming provider, and 12 times non-streaming, called `calculate_uplift` every time. The model, region, config and history query are identical to the worker's, so the live/replay difference is unexplained (`qa_evidence/experiments/s06-live-vs-replay.json`). It passed in production Gate 5. When it fails, the gaps are shown and the score change is missing; no unchecked fact is shown.
- **Who said what (C02, `9b4f9f7`).** "What did my colleague just say?" sometimes came back as "Your colleague said…" with no name. In replay, the planner named the colleague in 0/12 first drafts. "When you tell someone what a person in the room said or will do, name that person and quote their words" raised that to 6/12. A named draft fails the direct `say` check, so it goes through the checked `message_quote` path. C03's live failure (a follow-up that fell back) did not reproduce in 24 replays, so nothing was changed for it (`qa_evidence/experiments/conversation-replay.json`).
- **S09 memory recall (`85abea0`).** On `fec3b9e`, a decision saved for case `mv8lh9zk-jaw8` was missing from the top five results for a question about that exact case. It was crowded out by older look-alike decisions from earlier runs (same contact, other case IDs), which the embeddings rank as close or closer. Memories that contain an identifier from the query (a word with a digit) now rank first. The integration test plants six closer look-alikes and fails on the old query.
- **S10 field names (`edbdfb2`).** On `a9817cc`, Gemini saved `{"flat check value": …}` for "Remember that X is Y", and the user got "Not saved … Invalid field name". The one controlled repair now also turns a spaced or punctuated field name into its underscored form. Values are never changed, and names that would collide or stay invalid are not repaired, so the field-level reason is shown as before (`tests/memory-value-json.test.ts`).
- **A12 trusts only its own instance (`5a82e6e`).** It picks a free port and checks that the process answering on it is its own child (`lsof`), and that the child is alive. It reads RSS and socket counts only from a live PID, and kills the child on SIGINT or SIGTERM (`scripts/acceptance/local-instance.ts`, four tests in `tests/acceptance-runner-exit.test.ts`).
- **Fallback wording.** The no-source fallback no longer says "I couldn't find a confirmed record", which was misleading for saves and small talk. It now says "I couldn't answer that with information I could verify in this workspace."

### Test changes and why they are not weaker

- **S09 oracle.** It used to require the saved value to contain "Dana <random tag>" as one string. The tag looks like an ID, and Gemini sometimes stores the name and the ID as separate fields (2 of 5 in `save-memory-auto-isolated-after.json`). The check now requires "Dana", the unique tag and the deadline to each be stored verbatim. Recall must return that record. Valley must not see the unique tag anywhere, which is stricter than before.
- **Reviewer replay.** Added "every prompt got a real reply, not only the generic fallback". The earlier version passed while the fallback bug was visible.
- **`scripts/integration/tenant-chats.test.ts`.** The forged-claim check now inspects only the text shown to users, because generated UUIDs and timestamps containing "500" produced false failures.
- **S10 flat check (`edbdfb2`).** It used to read only the first `save_memory` call of the flat turn. It now accepts a save made directly or by the one controlled repair. It still requires at most two calls and the requested value to be stored. This is a deliberate change: a flat value saved after the server fixed a spaced field name now counts, because that is the behaviour the repair was built for.
- **Production accounts.** The production target's Northside requester (`n1`) is now `northside.analyst3`, because `northside.buyer1` is the reviewer's account and is protected. The assertions are unchanged.
- **Acceptance runners.** These now take an explicit target and write staging evidence to `qa_evidence/staging/runs`. The assertions are unchanged apart from the two items above. `expectedProjection` now also counts `ai_answer_segment` events, the new event type.

## Staging stack

- **Isolation.**
  - Services `teamchat-api-staging` and `teamchat-worker-staging`, service account `teamchat-staging-runner`, and queue `teamchat-ai-tasks-staging`.
  - Secret `teamchat-staging-database-url`, database `teamchat_staging` on the same Cloud SQL instance, owner `teamchat_staging_owner`, runtime role `teamchat_api_staging` (no memberships, `NOBYPASSRLS`; `CONNECT` revoked from `PUBLIC` on that database).
  - Firebase users `*.staging@teamchat.internal`, with passwords only in Keychain `teamchat-ai-staging`.
  - Hosting preview channel `staging` (<https://focus-clean-4b9f4--staging-yxk0bcnc.web.app>).
  - Proven: the staging role gets "permission denied" on the production schema. The staging service account can read only the staging secret and enqueue only to the staging queue.
- **Deployed now.**
  - Source `edbdfb2b21b2c246000a2c42c8908eef2972bf9f`, Cloud Build `1b6bcd57-cf89-460d-b7ec-b70d00ed7b41`.
  - API @ `sha256:bb47e840488d280355210a9a50d0f9e83253a62aef2be77ffee6becf131475f2`, worker @ `sha256:b622a9a2388ee9fdcdf972cb9583351e47e8c7ce91d1603e2cce88f729692880`. Revisions 00016 were the deploy; S19 restarted both services into `teamchat-api-staging-00017-mls` and `teamchat-worker-staging-00017-9v7`, with the same digests.
  - Hosting channel `staging` version `79bc724d6d4afcb9`; the served assets equal a clean-clone build (`qa_evidence/staging/provenance.json`).
- **Compromise, recorded.** Staging shares the production Cloud SQL instance and GCP project, so the S19 guard cannot refuse on project equality. It refuses on services, URLs, database, secret, role, Keychain service and accounts instead (`scripts/acceptance/target.ts`, `tests/acceptance-target.test.ts`).

## Production

- **Before (rollback points, `qa_evidence/production/rollback-points.json`).**
  - API `teamchat-api-00016-ct7` @ `sha256:395ba7cf07c5e9a2359e6e6023e536ac5e78a955c31d45b2b065e7f5328a8374`.
  - Worker `teamchat-worker-00016-24v` @ `sha256:143dd72530d5fb9980fce223ef7da85fa31c53977b381a2916a23701ea159c69` (source `d66da3d`).
  - Hosting version `acca7910fdbc736c`. Schema at 007, no `schema_migrations` table.
- **Now (`qa_evidence/provenance.json`).**
  - Source `edbdfb2`, Cloud Build `1b6bcd57-cf89-460d-b7ec-b70d00ed7b41`.
  - API `teamchat-api-00017-7gz` @ `sha256:bb47e840488d280355210a9a50d0f9e83253a62aef2be77ffee6becf131475f2`.
  - Worker `teamchat-worker-00017-2rb` @ `sha256:b622a9a2388ee9fdcdf972cb9583351e47e8c7ce91d1603e2cce88f729692880`.
  - Hosting version `33bae4d9769be62c`, released 22:40:26 UTC.
  - Provenance confirms the assets equal a clean-clone build, the dataset hashes match the fixtures, and no memory lacks its embedding. The digests are the ones tested in the `edbdfb2` staging chain.

### Gate 4 (`qa_evidence/production/gate4.json`)

1. **Nothing in production used `postgres`.** Both production services read `DATABASE_URL` from `teamchat-database-url`, whose user is `teamchat_api`. There are no Cloud Run jobs, functions or scheduler jobs. The only client sessions visible were `teamchat_api`'s (as that role, `pg_stat_activity` may show only its own sessions).
2. **Owner password reset, authorized.** A 64-character random password was generated in-process and written to Keychain service `teamchat-ai-prod-postgres-owner` (account `postgres`) over stdin. It was then set through the Cloud SQL Admin API `users.update`, with the value read from Keychain inside the process: operation `cdf7acf9-…`, `UPDATE_USER`, `DONE` at 22:36:28 UTC. It never appeared in argv, logs, evidence or Git. The owner connection reports `current_user=postgres`, not a superuser, and `postgres` owns the tables (checked on `rooms`).
3. **Backup.** `1792017407307`, ON_DEMAND, **SUCCESSFUL** (22:36:47–22:37:48 UTC).
4. **Migration.** The dry run showed baseline 001–007 and pending 008. 008 was then applied (sha256 `9b243ca9…`, 1.9 s), and `teamchat_api` was provisioned. Afterwards, `schema_migrations` tracks 001–008 with nothing pending.
5. **Backward compatibility.** The previous release (00016) was still serving on the migrated schema and passed the live smoke: health, room list, delivery, an `@AI` answer with `search_catalog`, and replay equal to the database. Exit 0, `qa_evidence/runs/20261014T223840Z-live-smoke-94e042`.
6. **Deploy.** Worker, then API, by digest (22:39 UTC). Then the web app was built with the production URLs and deployed to Hosting live. Provenance recorded.

### Gate 5 (`qa_evidence/production/gate5.json`)

Accounts `northside.analyst3`, `northside.buyer2` and `valley.buyer1`, never `northside.buyer1`. QA rooms only (`supply-planning`, `range-planning`). No chats created (0 in both tenants afterwards), no S19, no seeds, nothing posted outside the QA rooms.

| Check | Exit | Result | Evidence |
| --- | --- | --- | --- |
| Employer acceptance `--only` S01–S08, S10–S14, S18 | 0 | **14/14** | `qa_evidence/runs/20261014T224119Z-acceptance-f823b5` |
| Browser: S01-BROWSER, UX-BROWSER (without its new-chat step), S15, S16, S16-OFFLINE, S17, negative controls | 0 | **10/10** | `qa_evidence/runs/20261014T224458Z-browser-b70bb3` |
| Leak scan (`scripts/evidence/leak-scan.ts`): publishable files, the branch diff and the run logs, against 20 Keychain and Secret Manager secrets (including the new owner password) and 4 credential shapes | 0 | **0 hits** | `/tmp` log only |
| Latency, question to terminal event from `room_events.created_at` (`scripts/evidence/turn-latency.ts`) | 0 | 21 turns: median 5.0 s, p95 11.4 s, max 12.1 s | `qa_evidence/latency/20261014T224119Z-acceptance-f823b5.json` |

Not run in production: S09 (its recall posts in `category-strategy`, which is not a QA room); S19 (it restarts services); A02, A10 and A12; the conversational suite and the reviewer replay (both create chats); and chat creation. **No rollback was performed; none was needed.**

### Rollback runbook

- **Cloud Run.** Run `gcloud run services update-traffic teamchat-api --to-revisions teamchat-api-00016-ct7=100`, and the same for `teamchat-worker` with `teamchat-worker-00016-24v`.
- **Hosting.** Run `firebase hosting:clone focus-clean-4b9f4@acca7910fdbc736c focus-clean-4b9f4:live --project focus-clean-4b9f4`. The source form is `<site>@<version>`; the rehearsal caught that `<site>:@<version>` is rejected.
- **Schema.** The schema stays at 008. It is additive, and the old release was proven to work against it (compat run above). Chats created after the rollout stay readable by the old code, which ignores `ai_chat`.
- **Backup.** `1792017407307` is for disaster recovery only, never a routine rollback.
- **Rehearsal on staging (PASS).** The same commands were run against staging on 14 October:
  - Cloud Run: traffic moved from 00008 (`ac07134`) to 00007 (`bfa0edf`) and back with `--to-latest`. `/health` returned 200 at every step (`qa_evidence/staging/rollback-rehearsal-cloudrun.log`).
  - Hosting: version `0ae01a284e045cb6` (web from `eb87b3a`) was cloned into the `staging` channel, which then served its older bundle, and version `719e276975e46c6a` was cloned back (`qa_evidence/staging/rollback-rehearsal-hosting.log`).
  - Not rehearsed: rolling production itself, and restoring a Cloud SQL backup.

## Remaining issues

- **S06 is intermittent and unexplained.** On staging it failed in the second acceptance run of the last two chains. When it fails, Gemini lists the gaps and leaves out the score change. Offline replays of the failed `edbdfb2` turn never fail (0/24, plus 0/12 of the earlier failed turn), so the cause is still open. What can be missing is part of the answer; facts shown are always checked.
- **Other Gemini nondeterminism seen once.** C03 (a follow-up fell back, `5a82e6e`) and A02 (4 typing frames arrived more than 1 s after leaving a room, `fec3b9e`, right after an S19 restart). A02's control saw only 1 frame in 4 s, so this looks like delayed delivery rather than a leak, but the test cannot tell the two apart. Neither recurred in the next two chains.
- **The `say` check is a heuristic.** It is conservative. When it rejects text, the user sees a neutral fallback or "I left out part of my reply…". It may still let through harmless paraphrase, or block a legitimate phrase.
- **Wording polish.** The C04 fallback is generic. Catalog lists often repeat the margin class on a second line for each code. Redundant, not wrong.
- **QA data accumulates.** Staging gains chats and memories every run, and production gains QA memories from S10 in the Northside tenant, which every Northside user can search. There is no archive or delete for chats or memories.
- **A retried turn can diverge from its persisted plan.** Tool records are fenced and replayed by operation ID, but a second Gemini call may choose different tools.
- **Shared instance.** Staging shares the production Cloud SQL instance (documented above).
- **Production hardening, unchanged.** `CONNECT` on `teamchat` is still granted to `PUBLIC`. Cloud SQL has automated backups disabled, a public IP and unencrypted connections allowed.
- **A new standing credential.** The `postgres` owner password now lives in Keychain `teamchat-ai-prod-postgres-owner` on this Mac. It is needed for future migrations. Rotate or remove it if this machine is not where it should live.

## Human-only actions

None of these has been done.

1. **Decide whether this is ready to show Gonzalo.** Production is green on Gate 5. New chats are STAGING PASS / PRODUCTION NOT VERIFIED, and S06 is intermittent. Claiming "fully fixed" would overstate it.
2. **Production chat creation.** Authorize a test of it in production, or keep the label above. Any chat created in production appears in every Northside user's list, including the reviewer's.
3. **Pull request and merge.** No PR has been opened. Open one from `fix/gonzalo-conversational-review`, review it, and merge it to `main` (protected; merging needs your approval). Production already runs `edbdfb2` from this branch, so `main` is now behind production.
4. **PR #2.** Close it as superseded.
5. **Reply to Gonzalo.** Review and send it yourself. A suggested note is in `audit/gonzalo-2026-10-14/SUGGESTED_GMAIL_REPLY_PRIVATE.md`; it predates the production rollout, so update it first. Nothing has been sent to anyone at Controlease.
6. **The owner credential.** Keep, rotate or delete Keychain `teamchat-ai-prod-postgres-owner` (see "Remaining issues").
