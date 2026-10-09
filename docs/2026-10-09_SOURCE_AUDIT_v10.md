# TeamChat AI — v10 pre-live requirements and end-to-end source review

**Assessment basis:** Original employer `ASSESSMENT.md`, seven unchanged archive entries (README, assessment, five fixtures), submitted 6-page Technical Brief dated 8 October 2026, v9 implementation and the 27 employer acceptance scenarios.

**Scope:** Static source review, SQL-permission contract, locally executable backend tests and pure TypeScript verification. Not a live integration run.

## Defects reproduced and fixed

### Critical — production AI retry would fail for missing SQL DELETE grant

- **Prior defect:** On reclaiming a previously running AI job, `claimJob()` deletes existing `teamchat.answer_blocks` records before committing an `ai_answer_reset` event. The runtime role had `SELECT` and `INSERT/UPDATE` grants for the table, but not `DELETE`. With a normal, non-owner `teamchat_api` connection the retry would raise `permission denied`, leaving the AI turn un-recoverable. Mocked tests did not model database grants.
- **Fix:** Extend role provisioning to `GRANT DELETE ON teamchat.answer_blocks, teamchat.presence_leases TO teamchat_api`, without granting the runtime role data-directory or migration-owner privileges. Verify with a source-grant contract test and a harmless zero-result DELETE as part of the mandatory real-PostgreSQL test.
- **Verification:** Local contract test passes, but actual PostgreSQL execution must still be observed using the restricted role; no live test credentials were present here.

### High — WebSocket session could outlive an already-old Firebase ID token

- **Prior defect:** Socket connections were closed 45 minutes from connection time, regardless of when the signed Firebase ID token expired. A valid token with only a minute left could therefore keep a connection authorized 45 additional minutes.
- **Fix:** Firebase Admin returns the signed `exp` claim alongside UID for WebSocket authentication. `sessionLifetimeMs()` computes `min(45 minutes, exp - now - 10 seconds)` and rejects already expired/near-expiry sessions. Connection closure during asynchronous membership resolution now stops that attempt from authorizing the dead socket.
- **Verification:** Local expiry-boundary tests pass; acceptance must also inspect actual Firebase tokens and on-the-wire browser reconnects.

### Preventive — SQL permission regressions were absent from CI

- **Change:** Add `tests/runtime-role-contract.test.ts`, which scans SELECT/INSERT/UPDATE/DELETE on `teamchat` tables in runtime TypeScript sources and compares them to all explicit role grants. Removing answer-block DELETE privilege makes this test fail. The test is complementary to live PostgreSQL and cannot establish RLS safety on its own.

## Verification performed

- `npm run check`: PASS, using uncommitted local Node typings from the available toolchain; no project dependency or lockfile was fabricated.
- `npm test`: **96/96 PASS**, zero skipped.
- `npm run verify:fixtures`: PASS; source assessment fixture hashes unchanged.
- `npm run seed:sql`: PASS; 2,753 deterministic INSERT statements.
- `npm run verify:packaging`: FAIL (expected blocker), genuine root and frontend lockfiles do not exist, so `npm ci` is not yet reproducible.
- `npm run test:postgres:required`: FAIL with zero skips (expected blocker), no authorized `DATABASE_URL` / test identities / embedding model configured.
- Full React/Vite build, real Firebase, Vertex AI Gemini and embedding endpoints, Cloud Tasks/OIDC, two-instance cross-worker delivery, browser network analysis, deployment, public URL and five-minute video: **NOT RUN**.

## Release outcome

**DO NOT SUBMIT YET.** v10 fixes known source-level defects and documents remaining incompatibilities. Only run a production-style release after npm lockfiles, restricted Cloud SQL database, Firebase identities, pinned Vertex model, Cloud Tasks and two-browser verification can be configured and exercised with real credentials. The original Technical Brief remains unchanged.
