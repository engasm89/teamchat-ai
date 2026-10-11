# WebSocket fault-injection experiments (2026-10-11)

Run against the live Hosting app and Cloud Run API with Playwright 1.64.0 /
Chromium 1248. Raw output sits beside this file; the scripts are in
`scripts/experiments/`.

## Questions and results

| Question | Result |
| --- | --- |
| Does `context.setOffline(true)` close an open WebSocket? | **No.** Socket stayed open for 20 s, status stayed `online`, no reconnect (`websocket-faults.json` → `setOffline`). |
| Does CDP `Network.emulateNetworkConditions {offline:true}` (what DevTools "Offline" uses) close it? | **No.** Same as above (`cdpOffline`). |
| Do those mechanisms flip `navigator.onLine` and fire `offline`/`online` events? | **Yes**, both (`online-events.json`). |
| Can `page.routeWebSocket` proxy the live socket and inject faults? | **Yes.** Duplicated frame rendered once; dropped frame was recovered by the client's gap replay; a forced close (code 4000) produced `reconnecting` → `online` and later messages arrived (`websocket-faults.json` → `routeWebSocket`). |

## Consequences

1. The earlier S16 evidence (`scripts/browser-e2e-evidence.ts`, cited in
   `docs/FINAL_GO_NO_GO_REPORT.md`) used `setOffline` and therefore never
   disconnected the socket. That evidence is void.
2. A reviewer toggling DevTools "Offline" sees the same thing: messages keep
   arriving and nothing is lost, because nothing was disconnected. The app
   ignores `offline`/`online` events, so it cannot honour the simulation.
3. The browser client has no liveness check of its own. The server sends
   protocol pings every 25 s, but browsers answer pings invisibly, so a
   silently dead link is only noticed when TCP gives up.
4. Fault injection for S16 and the negative controls uses `routeWebSocket`:
   close the proxied socket and refuse reconnects for the outage window, drop
   or duplicate frames, and suppress replay requests where a control needs
   the client's recovery to be defeated.

# save_memory argument schema (2026-10-11)

Acceptance run `20261011T175804Z-acceptance-4b04a5` showed every live
`save_memory` call storing `{}` and reporting `saved: true` (S09 contact and
deadline, S10 nested roster, S10 flat value). `scripts/experiments/save-memory-schema.ts`
asks Vertex `gemini-2.5-flash` directly, with the production system instruction,
temperature 0 and function-calling mode `ANY`, changing only the declaration of
the value parameter. Two trials per prompt.

| Declaration of the value | Flat contact/deadline prompt | Nested roster prompt |
| --- | --- | --- |
| `value: {type: OBJECT}` with no properties (deployed until the fix) | `{}` 2/2 | `{}` 2/2 |
| JSON Schema `value: {type: object}`, open properties | `{}` 2/2 | `{}` 2/2 |
| `value_json: STRING`, the text of a JSON object | correct fields 2/2 | full nested JSON 2/2 |

Raw output: `save-memory-schema.json` (before the fix) and
`save-memory-schema-after-fix.json` (with the fixed `src/tools.ts`, which
now behaves like the `value_json` row).

Consequence: with constrained decoding the model cannot put anything into an
object parameter that declares no properties, so shared memory silently stored
empty values, the exact "silent truncation" the S10 runbook forbids. The fix
declares `value_json`, parses it on the server, keeps the field-level rejection
of nested values, and rejects empty values.

## The one controlled repair

With the schema fixed, a live S10 turn (scratch run) rejected the nested roster
with field-level reasons and then ended. The worker's `MemoryRepairBudget`
allows exactly one repair, but nothing told the model it could repair.
`scripts/experiments/save-memory-repair.ts` replays round 2 of that turn (the
rejection as the function response, mode `AUTO`, three trials):

| System instruction | Repair call made |
| --- | --- |
| As deployed in 75de127 | 0/3 (the model apologised and stopped) |
| Plus: "If save_memory returns validation_errors, make exactly one corrected save_memory call with the same key and a flat value_json (express nested lists as plain text fields), then stop retrying." | 3/3, same key, every lead, day and store kept as flat text |

Raw output: `save-memory-repair.json`.

That sentence shipped in 26276b1 and did not hold up. Re-running both rounds
against it (temperature 0) gave:

- Round 1: with the sentence in the system instruction the model often
  pre-flattens the roster into keys like `leads_0_shifts_0_stores_1` without
  ever being rejected (1 of 2 trials stayed nested), so S10's "rejected first"
  path is not reliably reached.
- Round 2: given the rejection, the model made the repair call in 1 of 3
  trials; twice it apologised and asked the user instead.

Raw output: `save-memory-recheck-round1.json`, `save-memory-recheck-round2.json`.

A prompt that works some of the time is not a control. The sentence was
removed and the repair moved into the worker: when `save_memory` returns
`validation_errors` and the value has nested fields, the worker makes exactly
one further `save_memory` call with the same key, each nested field re-encoded
as JSON text (`controlledMemoryRepair` in `src/memory.ts`), and persists both
operations so a re-run replays rather than re-executes. If the repair is also
rejected (for example it exceeds 2048 characters), any further save in that
turn is refused with "Repair limit reached" and nothing is stored. The gates
test `MEMORY-REPAIR` drives the real worker loop and real SQL with a scripted
model to show both paths.

This is a product decision taken without Ashraf (the run was unattended): the
stored value keeps every field, but nested ones become text, not structure.

## The model reshapes the value once a room has history

With the worker repair deployed (f2e60bc), a live S10 turn still failed: the
model rewrote the roster as `{"leads":"Ana: Mon (ST-4001, ST-4002); Ben: Tue
(ST-4003)"}` before calling `save_memory`, so it passed validation and the user
was never told it did not fit. `scripts/experiments/save-memory-fidelity.ts`
(production declarations, temperature 0, mode `ANY`, 5 trials per cell) shows
the trigger is the room's history:

| Earlier transcript sent to the model | Roster kept nested | Unseen planogram kept nested |
| --- | --- | --- |
| Empty | 5/5 | 5/5 |
| The 15 live `supply-planning` events before that turn | 0/5 | 0/5 |
| Same, plus "Put the details into value_json exactly as the user gave them…" | 1/5 | 1/5 |

Flat requests saved both facts in every cell. Raw output:
`save-memory-fidelity-empty-transcript.json`, `save-memory-fidelity-live-transcript.json`.

Prompting does not fix it, so the worker does (decision approved by Ashraf):
when the requester's own message contains exactly one JSON object, that object,
not the model's copy, is what `save_memory` validates, repairs and stores
(`requesterMemoryValue` in `src/memory.ts`); the audit record carries
`valueSource: "requester_message"`. Free-text requests are unchanged. The gates
test `MEMORY-REPAIR` includes a scripted model that sends the flattened copy.

## S06: pricing every gap in one calculation

Official acceptance run 2 on 0919a9b failed S06: after `get_store_assortment`
the model called `calculate_uplift` with one gap code per round, hit the
worker's six-round limit and the turn ended `ai_failed`.
`scripts/experiments/s06-batching.ts` replays round 2 of that turn (the same 15
earlier room events, the recorded store result, production streaming config,
mode `AUTO`) and varies only the `calculate_uplift` declaration:

| Declaration | Every gap priced in one call |
| --- | --- |
| As deployed in 0919a9b ("…using additional existing codes") | 4/24 (2/8, 2/16); otherwise eight single-code calls |
| Description says the codes are added together and several additions go in one call; `add_codes` says "all together in this one call" | 22/24 (7/8, 15/16); the miss was eight single-code calls |
| The same plus a system-instruction sentence | 11/16; five trials made no calculation at all, so the sentence was not adopted |

Raw output: `s06-batching-description-8.json`, `s06-batching-description-16.json`,
`s06-batching-description-plus-instruction-16.json` (in these files
"production" means the 0919a9b declaration). The clarified declaration
shipped. About one S06 turn in twelve may still split the codes; that residual
rate is a model behaviour this change reduces, not removes.
