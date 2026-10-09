# TeamChat AI v8 — Pre-live requirements, failure-path and source audit

**Date:** 2026-10-09. **Basis:** original `teamchat-ai-assessment/ASSESSMENT.md`, unchanged five supplied datasets, the six-page Technical Brief submitted 8 October 2026, and the inherited v7 Git history. Gonzalo clarified a Friday 16 October delivery deadline.

## Corrected in v8

1. **Unsafe partial AI retry presentation.** Prior source kept `answer_blocks` on reclaim; a retry inserted new blocks with the same indexes using `ON CONFLICT DO NOTHING`, so the browser could show output from different attempts as one answer. `claimJob` now clears incomplete answer blocks within the claim transaction and appends a committed `ai_answer_reset` event when a prior partial existed. The PostgreSQL `room_events` audit is retained. Events include `turnId`; the browser uses a deterministic replay projection to hide only the superseded blocks for that particular turn, not other simultaneous turns.
2. **Side-effecting tool had no persisted pre-execution plan.** Previously `SqlToolExecutor.execute` ran before `persistTool`; a process interruption between a memory write and its tool-result record could lead to undocumented work and retry ambiguity. `persistToolPlan` now transactionally saves tool name/arguments with `planned` status and broadcasts a committed `ai_tool_start` trace before execution. `persistTool` finishes *only* the matching planned operation; mismatches fail closed. On retry, the recorded plan is checked before any side effect, while completed results are reused without running the operation again. Memory saves retain their existing idempotence guards.
3. **Room enumeration revocation window.** Identity resolution confirmed active membership, but subsequent `/api/rooms` listing did not repeat the active check. The room query now joins active user memberships in the tenant-scoped transaction.
4. **Replay interface omitted AI turn identifier.** `replayRoom` and WebSocket event envelopes now include the persisted `turn_id`; this is needed for accurate per-turn recovery and concurrent turn separation.
5. **Frontend trace clarity.** `ai_tool_start`, `ai_answer_reset` and `ai_failed` have explicit readable states instead of generic 'AI processing update'.

## Reproducible offline validation

- `npm test`: **90 passed, 0 failed, 0 skipped**. Includes new retry/reset, transcript projection, tool-plan persistence and divergence tests.
- `npm run check`: **passed** for core/server TypeScript. Tests use the local preexisting Node typings as a development aid; no lockfile was invented.
- All five original fixture hashes validated unchanged with `npm run verify:fixtures`. Seed generator emits **2,753 data INSERTs** across two tenants.
- Five frontend TS/TSX sources parsed with the installed global TypeScript transpiler; this is **not** a Vite production build or complete React type-check.
- Git source and ZIP integrity verification must be rechecked after packaging; the submitted Technical Brief is not modified.

## Requirements and remaining gaps

- The original evaluation prioritizes **tenant isolation** and **source grounding** as pass/fail gates. Mocked tests check source contracts, but PostgreSQL RLS enforcement and real Gemini tools have **not** been verified.
- Repeated model execution can still fail if Gemini materially changes an already-persisted tool plan on retry; the worker safely fails rather than silently substituting another result. A replayed turn has accurate source traces, but uninterrupted completion under all failure scenarios requires live testing.
- Native Gemini function calling, Vertex embedding/backfill, cold-start memory, Cloud Tasks OIDC, multi-instance LISTEN/NOTIFY, Firebase authentication, production browser idle traffic, and 30-second disconnect recovery are **source implemented, live unverified**.
- The root/frontend `package-lock.json` files are absent. The npm registry lookup fails with DNS `EAI_AGAIN`, so no genuine dependency installation, `npm ci`, Vite build, or Cloud Run Docker image verification was possible. Do not create fabricated lockfiles.
- PostgreSQL and GCP credentials are not present in this environment. Mandatory PostgreSQL integration gate must run against the nonowner `teamchat_api` role without skips. Demo identities, a genuine model-backed seed exchange, public deployment URL, GitHub remote, evaluator credentials and five-minute video remain outstanding.
- The briefing's optional monetary scenario formula is deliberately not enabled without a server-verified user baseline; dimensionless scores must not be labeled monetary sales uplift. Document this difference at submission.

## Release decision

**NOT ACCEPTED FOR FINAL SUBMISSION.** v8 fixes demonstrable offline defects and strengthens the transcript/tool replay contract, but it cannot prove complete end-to-end requirements without real PostgreSQL, Firebase, Vertex Gemini, Cloud Tasks and multi-browser testing. The next step is to resolve npm network access, generate authentic lockfiles, run the full production build and required live isolation/concurrency tests, and only then claim a working deployment.
