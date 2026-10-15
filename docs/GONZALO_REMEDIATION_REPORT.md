# Remediation after the 14 October review

Status on 15 October 2026, 13:10 Cairo. Branch `fix/gonzalo-conversational-review`. **Production is on hold on `edbdfb2`** (revision 00017, unchanged since the 14 October rollout) by Ashraf's decision at 12:10 Cairo. **Staging runs `b110e54`**: the S06 completeness review plus the C03 fix, neither promoted. See "15 October" sections below.

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

**15 October.** That rollout went ahead while the last staging chain on `edbdfb2` still had a failing step (second acceptance run, S06, exit 1). From now on, any non-zero exit in a staging chain blocks production. On 15 October an S06 fix (`e1fdb8a`) passed two full staging chains with every exit code 0. The third chain failed one step: C03, a different, older flake, exit 1. Under that rule, **production was not redeployed** and stays on `edbdfb2` (API `teamchat-api-00017-7gz`, worker `teamchat-worker-00017-2rb`). At 12:10 Cairo Ashraf put production on hold: no redeploy, and only read-only checks in production.

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

## 15 October: S06 fix-forward (staging only)

**What happened in the failures.** In all three live S06 failures (`5a82e6e`, `a9817cc` and `edbdfb2`), the worker logs show the same thing. Each was a first attempt with no retry. Round 0 called `get_store_assortment`, round 1 spent 3–6 s writing a reply with no tool call, and the loop treated that reply as final. In the three live passes, round 1 called `calculate_uplift`.

**What was ruled out.**
- The stream collector keeps function calls that arrive alongside text.
- The worker uses the same Vertex backend, model and configuration as the replays.
- S06 sends no memory consent.
- 20 new replays of the failed `edbdfb2` turn recorded every round's `finishReason`. All rounds ended with `STOP`, and all 20 reached the calculation (`qa_evidence/experiments/s06-round-finish.json`).

Across all replays, 0 of 68 stopped early, against 3 of 7 live runs since the planner sentence. Why live and replay differ is still unknown.

**Root cause (the part we control).** After a tool round, the loop accepted any reply without a call as the end of the turn. Nothing checked whether the requester's question had been fully answered. The withdrawn continuation note (`a9817cc`) filled that gap but read the whole room, which is how it answered a colleague's question in S14.

**Fix (`e1fdb8a`).** After the first reply without a call, in a turn that ran tools, the worker makes one tool-less review call (`REVIEW_INSTRUCTIONS`, temperature 0, JSON). It sees only:
- the requester's own message;
- the calls made, with the start of each result;
- the tool list.

It returns the missing part of *that* request, or nothing. If something is missing, the planner gets one more `AUTO` round with a note that quotes the part and says not to take up other people's questions. Otherwise the turn ends as before. The review never sees colleagues' messages.

There is no keyword routing and no forced call. A failed review never fails the turn. Every planner round now logs `finishReason`, and every review logs whether it continued.

**Tests.**
- `tests/planner-context.test.ts` has 4 unit tests. They check that the review sees only the request and the calls, that its reply is parsed as data, the note wording, and that `finishReason` is reported.
- `scripts/integration/tenant-chats.test.ts` has 2 scripted-model tests. In the first, the model fetches the gaps and replies early, and the review must lead to `calculate_uplift`; a colleague's earlier SSD question is in the room and must not reach the review. In the second, a complete turn gets no note and no extra round.
- Both integration tests fail on the old worker (18/20) and pass on the new one (20/20).

**Measured before deploying** (`qa_evidence/experiments/completeness-review.json`):
- After a forced early stop of the recorded S06 turn, the review flagged the score change 10 of 10 times, and the planner then called `calculate_uplift` 10 of 10.
- On 46 recorded, completed staging turns, the review flagged 4: S05's "class supersession" twice, and S09's Valley isolation check twice. Each costs one extra planner round, never a new fact.
- A first version that saw only call names flagged 7 of 46 and was not shipped.

**Staging chains on `e1fdb8a`** (same digests throughout: API `sha256:ac35940b…`, worker `sha256:338d4c48…`; Hosting `6bdb55d50b89bb3a`; provenance in `qa_evidence/staging/provenance.json`):

| Chain | Acceptance 1 | Conversational | Replay | Browser | S19 | Acceptance 2 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 18/18, exit 0 (`…/20261015T075452Z-acceptance-5d9a10`) | 7/7, exit 0 | PASS, exit 0 | 10/10, exit 0 | PASS, exit 0 | 18/18, exit 0 (`…/20261015T081124Z-acceptance-126ce0`) |
| 2 | 18/18, exit 0 (`…/20261015T081921Z-acceptance-b2821c`) | 7/7, exit 0 | PASS, exit 0 | 10/10, exit 0 | PASS, exit 0 | 18/18, exit 0 (`…/20261015T083733Z-acceptance-60adf2`) |
| 3 | 18/18, exit 0 (`…/20261015T084429Z-acceptance-a8f0bf`) | **6/7, C03 failed, exit 1** (`…/20261015T085151Z-conversational-118f78`) | PASS, exit 0 | 10/10, exit 0 | PASS, exit 0 | 18/18, exit 0 (`…/20261015T090052Z-acceptance-9d5398`) |

S06 passed in all six acceptance runs. Run alone 10 times on staging (`e1fdb8a`, 09:08–09:13 UTC), it passed 10 of 10, and every run exited 0. The runs are `qa_evidence/staging/runs/20261015T090832Z-acceptance-b3f553` through `20261015T091249Z-acceptance-03925e`.

The worker logs for those 10 turns qualify the result. In every turn the model called `get_store_assortment` and then `calculate_uplift` on its own, so none of the 10 needed the rescue. The review ran in all 10 and wrongly reported a missing part in 5. Each of those 5 turns took one extra round of about 4–6 seconds, and the model returned the same 2,179-character answer without calling another tool. The answers were unaffected, but this is a latency cost on a turn that was already complete, and it is a higher false-positive rate on this prompt than the 4 of 46 measured offline. The log records only whether the review continued, not what it reported missing.

**Not three in a row.** Chain 3's C03 failure is not S06 and not the review. The follow-up "which one of those is the low-noise model?" got a reply with no tool call that repeated a code from an earlier AI answer. The say check rejected it. The generic escalation note produced text again, and the user saw the fallback.

It reproduces offline: the first round is text-only in 4 of 20, 15 of 40 and 8 of 40 replays. The current escalation note recovered 1 of 15. Running the completeness review there would recover 3 of 14. A note that names the unverified codes ("your draft names APP-100.19, which no tool fetched in this turn…") recovered 8 of 8 (`qa_evidence/experiments/c03-escalation.json`). That note is **not shipped**: it needs its own three green chains.

**Production.** Not redeployed: three consecutive green chains were not reached before the 13:30 Cairo cut-off. Chain 3 ended at about 12:07 Cairo. A chain takes about 25 minutes, and chains share the staging rooms, so they cannot run in parallel. A new series of three would have ended after 13:30. Production remains on `edbdfb2` (API `teamchat-api-00017-7gz` @ `sha256:bb47e840…`, worker `teamchat-worker-00017-2rb` @ `sha256:b622a9a2…`, Hosting `33bae4d9769be62c`). No backup was taken, nothing was migrated, and no production test ran today.

**Per-run data isolation.** Memory keys and S09/S19 topics were already unique per run, and room history is capped at 40 events / 16,000 characters. Running each chain in a fresh staging chat would isolate room history fully, but it was not done: it would change every scenario's room and cannot be mirrored in production, where creating chats is not allowed.

## 15 October: production hold and the C03 fix (staging only)

**Hold.** At 12:10 Cairo, Ashraf decided to keep production on 00017 (`edbdfb2`): no redeploy and no production actions except read-only checks. Three consecutive green chains could not finish before the 13:30 cut-off. Chain 3's evidence is committed as it ran (`6a80c4f`: conversational exit 1, C03 FAIL), and the streak of green chains on `e1fdb8a` ended there.

**C03 root cause.**
- Sources are per turn by design. `SourceLedger` and `TurnSources` are keyed by the turn ID, and the planner instructions say earlier answers are context, not evidence.
- In chain 3's failing turn (`7b2bf86c`), round 0 was a 63-character text reply with no tool call: it repeated a code from the earlier AI answer.
- The say check rejected it. The generic `ESCALATION_NOTE` produced the same text again with no call.
- Compose had no sources, its only segment was rejected ("bad source ref"), and the user saw "I couldn't answer that with information I could verify in this workspace."
- So the model did not fetch the code again, and the server failed closed, as designed.

**Fix (`b110e54`).** When a tool-less draft fails the say check, the escalation note now names the codes and store IDs the draft used. Each named code is one the draft used but no tool fetched in this turn. For example: "your draft names APP-100.19, which no tool fetched in this turn. Earlier answers in the room are not evidence. Fetch it with a tool now, then answer."
- What is unchanged:
  - drafts without identifiers get the old generic note;
  - the note is sent at most once;
  - the tool choice stays `AUTO`;
  - grounding is unchanged: only facts fetched in this turn are shown.
- The identifiers are read from the model's own rejected draft, never from the user's message, and do not choose a tool.
- A new log line, `ai_escalation`, records whether each note was specific.
- **Tests:**
  - `tests/planner-context.test.ts` checks the note for codes, duplicates, trailing punctuation and drafts with no identifier.
  - `scripts/integration/tenant-chats.test.ts` scripts the C03 sequence: a text draft naming APP-100.19, the specific note, `get_catalog_code`, then only the fetched code shown.
  - The integration suite fails on the old worker (20/21) and passes on the new one (21/21); unit tests pass 194/194; `tsc` is clean.

**Alternative considered, not built.** The other way to fix this is to let facts verified in earlier turns of the same room count as sources, with their provenance. That would change the answer contract: an earlier turn's data could be stale, and the rule "this turn's tools only" is what makes the server's checks simple. That is a design decision for Ashraf, not a fix-forward.

**Staging runs on `b110e54`** (API `teamchat-api-staging-00022-k44` @ `sha256:2e9b5264…`, worker `teamchat-worker-staging-00022-49h` @ `sha256:91c34fef…`; Hosting unchanged at `6bdb55d50b89bb3a`, which provenance confirms equals a clean build of `b110e54`):

| Run | Result | Exit |
| --- | --- | --- |
| C03 alone, 11 runs (`20261015T093947Z` … `094405Z-conversational-*`) | C03 PASS 11/11 | 0 each |
| Full conversational suite, run 1 (`20261015T094440Z-conversational-60bfed`) | 7/7 | 0 |
| Full suite, run 2 (`…094604Z-conversational-a4f3e3`) | 6/7: C05 could not create its chat (HTTP 429) | 1 |
| Full suite, runs 3–5 (`…094740Z-…9f7461`, `…094834Z-…f811e4`, `…094930Z-…8fc522`) | 4/7 each: C03, C04 and C05 could not create their chats (HTTP 429); C01, C02, N01 and N02 PASS | 1 each |

- **Not counted:**
  - Two batches of runs never started a test. In the first, 8 full-suite runs and 1 C03-only run were refused by the runner's deployment check, because they started before staging provenance was updated for `b110e54`.
  - Run 6 of the second batch was stopped before it recorded anything.
- **What the 429s mean.** They are the product's limit of 20 new chats per user per hour (`createTenantChat`). The suite creates each scenario's chat as `northside.buyer2`, and about 25 runs in 11 minutes exhausted it. No AI turn ran in those scenarios, so they say nothing about the fix either way. The limit was left as it is.
- **Where C03 actually ran:** 13 times (11 alone and 2 in full runs), PASS 13/13.
- **The worker logs:**
  - The specific note fired on 3 C03 follow-ups. Each time the model then fetched the code (`search_catalog` twice, `get_catalog_code` once) and the answer showed only fetched codes.
  - It also fired twice on C04 ("how many tents did ST-4007 sell last week?"). Once the model fetched the store and showed its summary and gaps. Once it replied in text again and the user got the neutral fallback.
  - C04 passed both times (no invented figures). The store summary answers a question that wasn't asked, which is a wording issue, not a grounding one.
- **Not done:** three consecutive full chains on `b110e54`. That remains the bar for production.

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

- **Cloud Run.** Run `gcloud run services update-traffic teamchat-worker --to-revisions teamchat-worker-00016-24v=100 --region us-central1 --project focus-clean-4b9f4`, then the same for `teamchat-api` with `teamchat-api-00016-ct7`. Pass `--region` and `--project` explicitly; the earlier version of this line omitted them and relied on local gcloud defaults.
- **Hosting.** Run `firebase hosting:clone focus-clean-4b9f4@acca7910fdbc736c focus-clean-4b9f4:live --project focus-clean-4b9f4`. The source form is `<site>@<version>`; the rehearsal caught that `<site>:@<version>` is rejected.
- **Schema.** The schema stays at 008. It is additive, and the old release was proven to work against it (compat run above). Chats created after the rollout stay readable by the old code, which ignores `ai_chat`.
- **Backup.** `1792017407307` is for disaster recovery only, never a routine rollback.
- **Rehearsal on staging (PASS).** The same commands were run against staging on 14 October:
  - Cloud Run: traffic moved from 00008 (`ac07134`) to 00007 (`bfa0edf`) and back with `--to-latest`. `/health` returned 200 at every step (`qa_evidence/staging/rollback-rehearsal-cloudrun.log`).
  - Hosting: version `0ae01a284e045cb6` (web from `eb87b3a`) was cloned into the `staging` channel, which then served its older bundle, and version `719e276975e46c6a` was cloned back (`qa_evidence/staging/rollback-rehearsal-hosting.log`).
  - Not rehearsed: rolling production itself, and restoring a Cloud SQL backup.

## Remaining issues

- **S06 in production.** Production (`edbdfb2`) does not have the completeness review, so it can still stop after the gaps. The fix is on staging (`e1fdb8a`). Why live runs stop early when replays never do is still unexplained.
- **C03 in production.** On `edbdfb2`, a follow-up can be answered from an earlier AI message without a fetch, and then falls back. It failed live in 2 of 9 staging chains and offline in about 1 in 4. The fix (`b110e54`) is on staging only: C03 passed 13 of 13 there, and the note rescued all 3 follow-ups where it fired. The full-suite count is limited by the chat-creation rate limit (see "15 October: production hold").
- **The review's false positives.** In chain 1, the review asked for one more round in about 1 in 15 reviewed turns (S05, S09's Valley check, and S06 after the calculation). In the 10 S06-only runs it did so in 5 of 10. Those extra rounds changed no answer, but each cost about 4–6 s. The next step is to log what the review reports missing, then tighten the review or skip it when the last round already called the tools that cover the request.
- **Other Gemini nondeterminism seen once.** C03 (a follow-up fell back, `5a82e6e`) and A02 (4 typing frames arrived more than 1 s after leaving a room, `fec3b9e`, right after an S19 restart). A02's control saw only 1 frame in 4 s, so this looks like delayed delivery rather than a leak, but the test cannot tell the two apart. Neither recurred in the next two chains.
- **The `say` check is a heuristic.** It is conservative. When it rejects text, the user sees a neutral fallback or "I left out part of my reply…". It may still let through harmless paraphrase, or block a legitimate phrase.
  - **One unverified sentence did get through, in production.** In Gate 5's S05 answer, a `say` segment read "There is no class supersession." The verified fact beside it listed superseded classes 1003 and 506 (`qa_evidence/runs/20261014T224119Z-acceptance-f823b5/S05/s05.json`).
  - The cause: `CLAIM_WORDS` matches `supersed(e|es|ed|ing)` but not "supersession".
  - Not fixed yet. The fix (add the noun form, plus a unit test that fails on the old pattern) needs the same staging bar as any other change. The demo note flags it, and the 15 October dry run of that prompt did not repeat it.
- **Wording polish.** The C04 fallback is generic. Catalog lists often repeat the margin class on a second line for each code. Redundant, not wrong.
- **QA memories in production.** A read-only listing (`teamchat_api`, READ ONLY, `app.tenant_id` set; details in the git-ignored `audit/gonzalo-2026-10-14/QA_MEMORIES_PRIVATE.md`) found 37 memories in Northside beyond the 4 seeded.
  - All 37 came from QA prompts, none from a person using the product.
  - 35 are attributed to `northside.buyer1`, the reviewer's account, because production acceptance on 11 October signed in as it. All 35 were created on 11 October, none during the reviewer's 14 October session. The other 2 are by `northside.analyst3` (Gate 5).
  - Memory search is tenant-wide. None of the reviewer's 7 recorded prompts brings one into the top 5, but generic recall questions do. "Who is our escalation contact?" returns 4, and "What did we decide about the supplier dispute?" returns 5, shown as "Recorded by Northside Buyer One".
  - **Decision (Ashraf, 15 October 12:35 Cairo): leave them in place.** Nothing was deleted or changed. If one appears in a demo, the demo note gives a one-line explanation, and the suggested reply to Gonzalo mentions them.
  - Staging also accumulates chats and memories every run, and there is no archive or delete for either.
- **A retried turn can diverge from its persisted plan.** Tool records are fenced and replayed by operation ID, but a second Gemini call may choose different tools.
- **Shared instance.** Staging shares the production Cloud SQL instance (documented above).
- **Production hardening, unchanged.** `CONNECT` on `teamchat` is still granted to `PUBLIC`. Cloud SQL has automated backups disabled, a public IP and unencrypted connections allowed.
- **A new standing credential.** The `postgres` owner password now lives in Keychain `teamchat-ai-prod-postgres-owner` on this Mac. It is needed for future migrations. **Decision (Ashraf, 15 October ~13:20 Cairo): keep it there.** It exists only in that Keychain item and was never written to argv, logs, evidence or Git. Follow-up: move migrations to Cloud SQL IAM database authentication so no long-lived owner password is needed.

**Production dry run of the demo script (15 October, about 13:20 Cairo).**
- On production `edbdfb2` (00017), as `northside.analyst3` in the existing `#supply-planning` QA room: 11 prompts, plus a who-said-what prompt after a line posted by `northside.buyer2`.
- No chats created, no memories saved, never the reviewer's account.
- **Result: 12/12 met their checks.** Each turn completed, and every code shown was fetched in that turn. No retries.
- Latency from question to final event: median 4.8 s, range 3.3–10.0 s.
- "I left out part of my reply…" appeared on 3 of the 12: the gaps-only question and both isolation questions.
- The prompts and raw results stay in the git-ignored demo note.

## Human-only actions

Items 3, 4, 6 and 7 are decided (15 October). The rest are still open.

1. **Decide whether this is ready to show Gonzalo.** Production is green on Gate 5. New chats are STAGING PASS / PRODUCTION NOT VERIFIED, and S06 is intermittent. Claiming "fully fixed" would overstate it.
2. **Production chat creation.** Authorize a test of it in production, or keep the label above. Any chat created in production appears in every Northside user's list, including the reviewer's.
3. **Pull request and merge: approved by Ashraf on 15 October.** The branch is squash-merged into `main` (which has no branch protection). The production source is tagged `prod-00017-edbdfb2`. After the merge, `main` is *ahead* of production: it also contains the staging-only S06 (`e1fdb8a`) and C03 (`b110e54`) changes.
4. **PR #2: closed as superseded** by the merged PR.
5. **Reply to Gonzalo.** Review and send it yourself. The suggested note in `audit/gonzalo-2026-10-14/SUGGESTED_GMAIL_REPLY_PRIVATE.md` was updated on 15 October to the actual state. It covers production on `edbdfb2`, new chats verified on staging only, the S06 and C03 limitations, and the test memories. Nothing has been sent to anyone at Controlease.
6. **The owner credential: decided, keep it** in Keychain `teamchat-ai-prod-postgres-owner` (see "Remaining issues"). Follow-up: Cloud SQL IAM database authentication for migrations.
7. **QA memories in production: decided, leave them** (15 October, 12:35 Cairo). No action. Revisit only if they get in the way. Deleting them would be an owner-run SQL change, since the app has no delete path.
8. **Next rollout.** Production is on hold on `edbdfb2` by your 12:10 decision. Staging runs `b110e54` (S06 review and C03 note). Before any promotion: three consecutive full chains on one commit with every exit 0, spaced to stay under the 20-chats-per-user-per-hour limit, then Gate 4/5.
9. **Demo.** Read `audit/gonzalo-2026-10-14/DEMO_READINESS_PRIVATE.md` (git-ignored) before any live demo on 00017. It covers what works reliably, the S06 and C03 behaviours, phrasings that avoid them, and live recovery.
