# Release decision: READY FOR ASHRAF APPROVAL

12 October 2026. Every requirement a machine can check passes. Of the 61 requirements, 58 pass, none fail, none are unverified, and 3 are blocked only on actions Ashraf takes himself: sending the submission e-mail and delivering the reviewer passwords. Nothing has been sent to anyone.

The counts come from `scripts/validate-matrix.ts` (validated 2026-10-12T17:59:22Z), which derives each verdict from recorded test runs, the deployment's provenance and live checks. Nothing in the matrix is written by hand: `docs/REQUIREMENTS_FINAL_SUMMARY.md`, `docs/REQUIREMENTS_FINAL_MATRIX.md`, `qa_evidence/matrix-validation.json`.

## What was tested

| | |
| --- | --- |
| Application source | `d66da3d8a9f4908e20b99c3527a3396b479bacd2` (no application file changed since) |
| API image | `sha256:395ba7cf07c5e9a2359e6e6023e536ac5e78a955c31d45b2b065e7f5328a8374` |
| Worker image | `sha256:143dd72530d5fb9980fce223ef7da85fa31c53977b381a2916a23701ea159c69` |
| Serving now | `teamchat-api-00016-ct7`, `teamchat-worker-00016-24v`, 100% traffic each |
| Hosting | release `sites/focus-clean-4b9f4/versions/acca7910fdbc736c`, byte-identical to a clean build of the tested commit |
| Models | Vertex AI `gemini-2.5-flash` and `text-embedding-004` (768 dimensions), both answering on 12 October |

Provenance records revisions 00014. The S19 restart test replaced them with 00016 from the same images. The live-deployment check compares image digests, not revision names, so it passes.

## Results

| Area | Run | Result |
| --- | --- | --- |
| Release gates from a fresh clone of GitHub | `20261012T053729Z-gates-66d3a5` | 12 of 12: `npm ci`, typecheck, 145 of 145 unit tests, fixture hashes, seed SQL, web build equal to Hosting, forbidden-transport scan, live row-level security, fresh migrations, SIGTERM drain, memory repair, secret scan |
| Employer acceptance S01–S19 against production | `20261011T194326Z-acceptance-c335c4`, `20261011T194954Z-acceptance-96ca6e`, `20261011T194223Z-acceptance-restart-ed144a` | All scenarios pass (S01–S18 twice, S19 once) |
| Real-browser checks | `20261011T191641Z-browser-7353aa`, `20261011T192211Z-browser-19dc81` | Pass |
| Reviewer accounts and boundaries | `20261011T222335Z-handoff-2d22a9` (before rotation), `20261012T053205Z-handoff-a9fd34` (after) | 4 of 4 each: six accounts sign in, room memberships, own-chain-only replay, missing or forged token refused, seeded history |
| Password rotation | `20261012T053119Z-rotation-6d7970` | Six new passwords sign in, old ones refused, every earlier session refused, new passwords only in Keychain |
| Narrated walkthrough video | `20261012T162445Z-video-18ab3d` | 22 of 22, including picture-voice sync and the anonymous download from the GitHub Release |

**Secret scan.** gitleaks ran over all 73 commits. Its 2,286 findings are all public values:
- 2,282 memory slot names in recorded WebSocket frames, such as `q1_assortment_target`;
- 2 tested image digests;
- 2 copies of the Firebase web key that the Hosting bundle serves.

The 1,354 publishable files contain none of the six current reviewer passwords, the database password, a JWT or a private key. Each finding and the reason it was accepted are in `gitleaks-triage.json` in that run.

## Links, checked anonymously on 12 October

- App: https://focus-clean-4b9f4.web.app (200)
- API health: https://teamchat-api-1068908463902.us-central1.run.app/health returns `{"up":true}`
- Repository: https://github.com/engasm89/teamchat-ai (public)
- Video: https://github.com/engasm89/teamchat-ai/releases/tag/walkthrough-2026-10-12 (narrated, 2 min 37 s, 1920x1080 H.264 with AAC audio, SHA-256 `821651ae5bca0f9fd0f86aea9a0ea791837926ec00a852f527ad8207fffdc82c`; downloaded without credentials, byte-identical, decodes end to end)

## Left for Ashraf, not done

1. Deliver the six reviewer passwords privately, as `docs/REVIEWER_ACCESS.md` describes, and confirm receipt. This closes D04 and part of D07.
2. Review, edit and send `docs/FINAL_SUBMISSION_EMAIL_DRAFT.md` to gonzalo@controlease.net, cc elisa@controlease.net. This closes E05 and the rest of D07.
3. After both, set `"done": true` on the two `HUMAN-*` checks in `docs/requirements/checks.json` and rerun the validator.

## Why the earlier published matrix was wrong

The matrix published at `66502b6` (11 PASS, 8 FAIL, 1 BLOCKED, 41 NOT VERIFIED) was generated at 16:16Z on 11 October, before the deployment provenance and most test runs were committed, and was never regenerated. Its four engineering failures now pass on concrete evidence:
- G05: image labels, live digests and API health;
- G06: the live database's dataset hashes equal the supplied fixtures;
- A09: Hosting assets equal a clean build;
- A14: every live memory row has a 768-dimension embedding.

The API health check uses `/health`, because Google's front end reserves paths ending in `z` and answers `/healthz` itself with a 404.

The previous version of this report claimed GO on revision 00007, a different commit, a `.webm` video and scripts that no longer exist. It has been replaced.

## Problems found and fixed in this batch

- **The first video scan was blind.**
  - Cause: OCR on a whole 1920x1080 frame missed small text. One frame yielded 426 characters, against 2,531 when read in overlapping tiles.
  - Fix: the verifier now reads every frame whole and in 21 tiles. It is calibrated by planted decoy credentials that must be found when visible and unreadable under the recording's redaction.
- **OCR swaps lookalike letters.**
  - What happened: a Cyrillic М for M, 0 for o, l for I. A planted password was read correctly by eye but missed by exact matching in 2 of 5 frames.
  - Fix: text and secrets are now folded the same way before matching, and any matching line is withheld from the published OCR text.
- **The Valley re-sign-in was not in the crop review.**
  - Cause: caption times are recording time, while the published cut is sped up.
  - Fix: the verifier maps them through the speed segments and writes a crop sheet for it. Frames at 0.2 s steps were also checked by eye: the address is blurred and the password masked throughout.
- **Revocation missed sessions started in the same second.**
  - Cause: Firebase stores revocation time in whole seconds, so a session started in that second survives it. An experiment confirmed it twice: same second accepted; two seconds earlier refused.
  - Fix: rotation now waits two seconds after the last pre-rotation sign-in. Every real earlier session predates that by far.
- **The video drifted against its own timeline.**
  - Cause: each speed segment was trimmed to whole frames, losing up to a frame per segment. The first narrated build's picture ended 0.68 s before its sound.
  - Fix: one time map for the whole cut, resampled to 25 fps once. Audio and picture now both last 156.68 s.
- **The right window was recorded about half a second early.**
  - What happened: its status turned offline at 118.80 s, before the recorder took it offline at 119.24 s, and it showed every broadcast 0.31 s before the left window did.
  - Fix: the narrated cut takes off measured capture leads of 0.47 s (right) and 0.16 s (left), recorded with the method in `docs/video/narration-cues.json`.
- **Narration sync is checked on the published file.** Each caption change is found in the picture and must fall inside a pause in the voice; each paragraph must be spoken under its own caption; each of 19 named events (a message arriving, a tool result, the reload, going offline, the replay) must play where its words are spoken. The first version of this check read the wrong output stream and failed; once fixed, it caught one caption changing 0.24 s late, as the next paragraph started. That was a rounding difference magnified by a held frame, and it is fixed.
- **The new video run checks the current passwords.** The recording typed the reviewer passwords that were rotated afterwards; those are dead, were masked on screen, and the earlier run `20261012T052525Z-video-179bab` found none of them readable in the same recording.
- **The secret scan crashed on large evidence files.**
  - Cause: a 1 MB process buffer. gitleaks also flagged memory slot names, because the JSON field is called `key`.
  - Fix: a large buffer, and triage by the flagged value's shape or exact value, recorded per finding.

## Credentials

- **Rotation.** The six reviewer passwords were rotated on 12 October at about 05:31Z. They exist only in the macOS login keychain (service `teamchat-ai-reviewer`).
- **Repository.** No file in the workspace contains them, the source ZIP included (`scripts/handoff/scan-credentials.ts`).
- **Older passwords** written down before the rotation no longer work.

## Raise separately

These were found during the audit and were deliberately not changed here:

- Cloud SQL has backups disabled, a public IP, and allows unencrypted connections (no authorized networks are configured). This is fine for a demo, but not for production.
- Setting `GEMINI_API_KEY` silently moves the worker from Vertex AI to the Gemini Developer API.
- No Cloud Scheduler job is deployed to recover AI jobs that were recorded but never dispatched.
- The web app keeps its own copy of the event types (`apps/web/src/socket.ts`) instead of sharing them with the server.
- `scripts/e2e-two-browser.ts` has `@ts-nocheck`.
- Product limitations (raw user IDs as sender names, no auto-scroll, terse answers, model nondeterminism) are listed in the README under "What does not work".
