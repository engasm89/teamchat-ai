# Pre-email QA, 15 October 2026

Independent verification run before replying to the 14 October review. Production was on hold and checked **read-only**; nothing in production was changed, deployed or written. All interactive testing ran on the isolated staging stack.

## Verdict

**SEND WITH LIMITATIONS**, using the corrected reply (kept privately). The previous draft omitted one material disclosure: an unverified free-text sentence that contradicted a verified fact was shown in production on 14 October.

## What runs where

| Environment | Source | Revisions / version | Contains |
| --- | --- | --- | --- |
| Production (verified read-only, 100% traffic) | `edbdfb2` (tag `prod-00017-edbdfb2`) | API `teamchat-api-00017-7gz` `sha256:bb47e840…`, worker `teamchat-worker-00017-2rb` `sha256:b622a9a2…`, Hosting `33bae4d9769be62c` | AUTO tool choice, named history, display names, auto-scroll, new-chat feature (deployed, creation never exercised in production) |
| `main` | `8b318da` (PR #3 squash) | not deployed | production code plus the S06 completeness review (`e1fdb8a`) and the C03 follow-up note (`b110e54`) |
| Staging | `9506bfe` on `qa/gonzalo-preemail-verification` | API `teamchat-api-staging-00024-zhh`, worker `teamchat-worker-staging-00024-8q2` (same digests as 00023 after S19) | `main` plus the P0 supersession fix `a8dd9d4` |

The only runtime file that differs between production and `main` is `src/worker/gemini.ts`. No production rollout happened after the PR #3 merge.

## Defects

| Priority | Defect | Status |
| --- | --- | --- |
| P0 | A free-text sentence ("There is no class supersession.") was shown beside a verified calculation listing superseded classes 1003 and 506 (production Gate 5, 14 Oct, turn `9a610fd3…`; recorded in `qa_evidence/runs/20261014T224119Z-acceptance-f823b5/S05/s05.json` and the S15 WebSocket frames). The same contradiction appears in 1 of about 20 historical staging S05 runs (`20261015T081921Z-acceptance-b2821c`). The S05 runner passed both, because it checks tool calls and numbers, not every sentence. | **Fix on staging only** (`a8dd9d4`): wider claim vocabulary plus a cross-segment check. Red on `edbdfb2` and `main`, green after; 208/208 unit tests. In 22 new staging S05 runs the contradiction did not occur either before or after the fix, so the live effect is **not yet demonstrated**; proof rests on the unit tests. Production still has the gap. |
| P1 | S06: a two-part question can return only the first part. | Fix on `main`/staging, not production. Staging: 10/10 before the P0 fix, 5/5 after. |
| P1 | C03: a follow-up that refers to an earlier answer can fall back instead of re-fetching. | Fix on `main`/staging, not production. Staging: 10/10. |
| P1 | Speaker attribution is flaky: in the staging reviewer replay, the assistant quoted named speakers on some runs and not on others. | Open. |
| P1 | New-chat creation: never exercised in production. | STAGING PASS / PRODUCTION NOT VERIFIED. |
| P2 | Test oracle gap: S05 assertions do not compare free text with facts. | Open; add a sentence-level consistency assertion. |
| P2 | The P0 fix holds back 2 harmless sentences of 38 recorded, so "I left out part of my reply…" appears somewhat more often. | Accepted trade-off; monitor. |

## Commands and results (15 October)

| Where | Command | Exit | Result |
| --- | --- | --- | --- |
| Local, `main` 8b318da, Node 22.22.3 | `npm ci`, `npm --prefix apps/web ci`, `verify:packaging`, `check`, `verify:fixtures`, web build | 0 each | pass |
| Local, `main` | `npm test` | 0 | 194/194, 0 skipped |
| Local, disposable Postgres 17 | `npm run test:tenant-chats` | 0 | 21/21 |
| Local, disposable Postgres | `npm run test:postgres:required` | 1, then 0 | attempt 1 failed on a QA setup error (kept); attempt 2 1/1 |
| Local | `npm run verify:release` | – | NOT_RUN (would need the staging database while staging suites were running) |
| QA branch | `npm test` after the P0 fix | 0 | 208/208 |
| Local | gitleaks 8.30.1 (checksum-verified), tree / history / PR #3 range | 1 | 20,462 history findings, all triaged as test memory keys, image digests and the public Firebase web key; no real secret |
| Local | exact-value scan of 16 Keychain secrets over `git log --all -p` | 0 | 0 hits |
| GitHub | GitGuardian on PR #3 | NEUTRAL | "Pull request too large to scan" — not a pass |
| Staging, pre-fix | reviewer replay; conversational; C03 ×10; S05+S06 ×10 | 0 each | pass; 7/7; 10/10; 10/10 |
| Staging, P0 fix | S05+S06 ×5; S05 ×5 | 0 each | 5/5; 5/5 |
| Staging, P0 fix | full chain: acceptance, conversational, replay, browser, S19, acceptance | 0 each | 18/18, 7/7, pass, 10/10, 1/1, 18/18 |

This is **one** fully green chain on the fixed build; promotion requires three consecutive chains on the same build. Production was not tested interactively on 15 October; its interactive evidence is historical (Gate 5 on 14 October: 14 selected scenarios and 10/10 browser; demo dry run on 15 October 10:12 UTC: 12/12). Gate 5 did **not** cover all of S01–S19 in production.

## Production read-only checks

- Revisions, digests, traffic and Hosting match the release record; migration 008 columns present.
- Since Gate 5: no 4xx/5xx, no failed AI jobs, no retries; the only AI jobs are the 12 dry-run turns.
- The reviewer account has no activity after the review window and no QA activity under it; no production chats exist.
- Guards: production chat creation, production S19 and the reviewer account are refused by the runners without override.

## Next steps

1. P0: deploy `a8dd9d4` only after three consecutive green staging chains, then Gate 4 and Gate 5 with a sentence-level S05 assertion.
2. Add the sentence-versus-fact consistency assertion to S05 and the conversational suite.
3. Investigate speaker-attribution flakiness.
4. Record staging build-time web overrides in provenance; allowlist test identifiers in gitleaks; review the npm audit advisories.
