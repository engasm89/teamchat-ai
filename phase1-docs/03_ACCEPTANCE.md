# Acceptance and pass criteria

## How to use this file

Create one evidence entry per ID. Status is NOT RUN, PASS, FAIL, BLOCKED or DEFERRED. PASS requires actual observed evidence, commit SHA, environment and date. Never mark a design promise or green documentation checklist as a tested pass. Distinguish employer scenarios from additional engineering checks.

The employer can probe beyond this matrix and determines the final score. Satisfying this matrix is not a guaranteed offer.

## Hard gates

| ID | Requirement | Evidence needed |
|---|---|---|
| G01 | Brief submitted before application coding | **Submission VERIFIED**: Gmail sent item 1a11cb0c10ca3fc6, 8 Oct 2026 18:05:07 +03:00; **first application commit timestamp still to verify** once the actual repository is inspected |
| G02 | Exact mandatory platform | Actual Firebase Auth/Hosting, Cloud Run and Vertex AI configuration plus successful live requests |
| G03 | Custom transport; no forbidden client listeners or polling | Source/dependency review and idle browser Network capture; socket heartbeat distinguished from data fetch |
| G04 | Gemini natively selects tools | Real Vertex response functionCall, validated server execution and corresponding functionResponse trace; no keyword intent dispatch |
| G05 | Tenant isolation | Real restricted-role SQL/API/socket/tool/memory tests; no foreign record, name, value or inferred existence disclosed |
| G06 | Grounding | Rendered facts map to source-ledger records fetched for that turn; unsupported references are rejected before broadcast |

**Submission cannot be described as passing if G02–G06 fail. G01 is a required process condition.** Never silently weaken a gate. If a gate is blocked, report it.

## Employer evaluation session

| ID | Scenario | Pass criterion |
|---|---|---|
| E01 | Portable AC lookup in two Northside browsers | Both see live tool activity and correct fetched candidates/class mapping, not a guessed single code |
| E02 | Reverse lookup | Given code resolves to its actual record; separator normalization preserves ambiguity handling |
| E03 | AC + SSD in one request | Gemini performs needed lookups, distinguishes candidates and invents nothing |
| E04 | Beekeeping veils | No match is reported; no synthetic code appears |
| E05 | Margin uplift for ST-4003 | Ordered fetched inputs, visible supersession and exact arithmetic under documented formula; fixture conflict and missing baseline disclosed |
| E06 | ST-4007 gaps and value | Supplied gaps/evidence fetched, combined numerical score delta returned, seasonality limitations and monetary assumptions visible |
| E07 | Compare two codings | Both retained/removed class sets and difference are reproducible; no double counting |
| E08 | Paraphrase a seeded memory from another room | Meaning-based retrieval succeeds with source author/date/room; exact-key-only matching fails this test |
| E09 | Save contact/deadline, switch user and room | Successfully committed memory is retrieved by another member of same tenant |
| E10 | Elaborately nested memory | Schema rejects original structure, explains fields and allows safe repair; no silent lossy write |
| E11 | Same target key in both tenants | Each sees only its own value, including q1_assortment_target |
| E12 | Foreign store; then claimed authorization | Same generic no-match both times; second attempt identifiable in authorized logs without foreign-record disclosure |
| E13 | Admin-mode prompt | No new privileges or cross-tenant data |
| E14 | Simultaneous AI requests | Two separate real turns or explicit queueing; no corrupt combined output |
| E15 | Refresh during generation | Complete persisted text/tool trace restored and original job followed to completion; no orphan duplicate job |
| E16 | Network disabled for 30 seconds | Missed events appear once in committed room order after reconnect |
| E17 | One idle minute | One established application socket; no polling/listeners/repeating data fetch; document normal heartbeat frames |
| E18 | Valley login | Own data resolves; Northside-only lookup reveals nothing |
| E19 | Force backend cold start/restart | Previously saved memory remains retrievable from durable storage |
| E20 | Code/log review and walkthrough | Trace one real turn through identity, tenant context, tool selection, storage, calculation and rendering |

Re-read the original scenario wording before the final demo. E05/E06 use our declared formula assumption; employer acceptance of that business interpretation is unconfirmed. Progressive validated blocks must visibly update during generation; merely replacing a spinner with a finished answer is not sufficient.

## Additional engineering checks from the brief

| ID | Check | Expected result |
|---|---|---|
| H01 | Two API instances, users deliberately connected to different instances | Same committed transcript and live tool/output sequence; no reliance on sticky sessions |
| H02 | Same send ID repeated; then conflicting payload | One committed message for identical retry; conflicting reuse rejected |
| H03 | Snapshot/live race | Inject commit during initial load; neither event loss nor duplicate state application |
| H04 | LISTEN disconnect, including final notification | API becomes unhealthy for stream delivery, closes sockets, reconnects/replays final event |
| H05 | Presence churn, multiple tabs, renewal and abrupt death | Live peers stay present during renewals; one closed tab does not hide others; stale presence expires |
| H06 | Typing without stop frame | Indicator expires in five seconds |
| H07 | Task redelivery and worker lease expiry | One effective side effect; stale fence cannot write; completed task does not call Gemini again |
| H08 | Crash after memory write and before task completion | Persisted operation result is reused, not duplicate memory version creation |
| H09 | Tenant context on pooled connections | Alternating tenant requests never reuse the previous context; missing context fails closed |
| H10 | Unauthorized room/history/cursor/job references | No protected rows or events disclosed via any entry point |
| H11 | Invalid token, expired session, Origin mismatch, membership removal | Unauthorized sockets/commands rejected; subscriptions stop delivering after invalidation |
| H12 | Nested/oversized memory, concurrent update, embedding failure | Defined errors; no acknowledged partial save; no silent overwrite |
| H13 | Supersession chains, duplicates, null classes and combined gaps | Deterministic reference arithmetic passes; graph validation catches cycles/unknown targets |
| H14 | Poisoned memory and tool text | Treated as data, not instructions or executable HTML |
| H15 | Unfetched answer reference or arbitrary factual field | Validator blocks it before client broadcast; repair/fallback visible |
| H16 | Large history, slow browser, connect/disconnect repetition | Bounded queues/pools; cleanup counts return to baseline; actual load recorded |
| H17 | New deployment from clean seed | Fixture counts/relations reproduce; both tenants get usable users and rooms; second run is safe/idempotent |
| H18 | Repository/console/log inspection | No secrets or demo passwords in public artifacts; stack/version/config documented |

## Deliverable checklist

- [ ] Submitted brief and submission evidence.
- [ ] Public GitHub URL with real commit history; secret scan complete.
- [ ] Live Firebase Hosting URL and healthy Cloud Run backend.
- [ ] Repeatable migration/seed instructions from clean setup.
- [ ] Three or more users per tenant; rooms and genuine fetched AI history.
- [ ] Test credentials and tenant isolation instructions shared privately.
- [ ] README: run/deploy, architecture, transport/recovery guarantees, model/tool boundary, changes from brief and honest limitations.
- [ ] Tests for both pass/fail rules and arithmetic, plus recovery evidence.
- [ ] Demo video at most five minutes.
- [ ] Final evidence review, blockers and known omissions documented.

## Evidence record template

```text
ID:
Status: NOT RUN | PASS | FAIL | BLOCKED | DEFERRED
Commit:
Date/time and timezone:
Environment: unit | local integration | Firebase emulator | live cloud
Setup and accounts (no passwords):
Actual command/action:
Expected:
Observed:
Evidence path or safe link:
Limitations:
```
