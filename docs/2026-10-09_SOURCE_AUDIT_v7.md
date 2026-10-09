# TeamChat AI — v7 employer requirements and pre-live audit

**Date:** 2026-10-09. Source basis: original Controlease ASSESSMENT.md, unmodified five fixture datasets, original submitted 6-page Technical Brief, inherited v6 source and history.

## Reproducible defects found and corrected

1. **Unimplemented direct alternative comparison:** v6 calculated per-option store scores but could not show the direct numerical difference between two proposed codings for one store. Added the native Gemini `compare_assortment_options` declaration, independent server-side scoped code checks, fixed-precision same-baseline A/B scoring, B-minus-A result, source record and UI formatting. Added regression tests for supersession, duplicated classes, unknown codes, tenant no-match, forged tenant override, and shorthand store ID.
2. **Trusted memory consent absent from the AI planner:** explicit consent was persisted and enforced at tool execution, but Gemini was never given the verified flag/room. Added server-authored system context for authorized room and turn-specific consent, with a double gate: only a direct user request plus server-verified consent should cause a save, and SQL executor still rejects unauthorized saves. Added tests.
3. **Model-controlled invented monetary scenarios:** previously the model-facing `calculate_uplift` allowed a free-form `monetary_baseline` parameter; code did not establish that it came from a user or a fixture. Removed that argument from Gemini's callable schema, local executor and PostgreSQL executor. The evaluator now gets a defensible dimensionless coefficient delta, not a fabricated dollar amount. A future user-controlled, server-authenticated numeric field is needed to restore currency scenarios.
4. **Store gap presentation:** structured verified store facts and evidence were dumped as raw JSON. Added readable, source-attributed store/gap rendering with clear suspected-not-confirmed and no invented seasonality labels.
5. **Inconsistent normalization:** local comparison/calculate fixture executor rejected bare store ID `4007` though the database tool accepted it. Standardized parsing. Updated the runtime-role grants script comment to require all migrations, including 006.

## Local test evidence

- TypeScript backend: PASS with the environment's pre-existing `@types/node` symlink used only for offline typechecking (not included in distribution; it is not an npm dependency lock).
- Node native TypeScript tests: 84 PASS, 0 FAIL, 0 SKIPPED.
- Original 5 fixture hashes: identical to v6. Deterministic generated fixture SQL: 2,753 inserts.
- Frontend verified-result formatter imported and tested via native Node test runner. Full React/Vite production build unavailable without npm registry access.
- Release gate is intentionally incomplete: root and frontend `package-lock.json` do not exist; there is no live `DATABASE_URL`, Firebase Admin project, Vertex model, or Cloud Tasks credentials accessible here.

## Blocking acceptance tests — NOT performed

- Apply migrations and seed against real PostgreSQL; verify strict non-owner role, forced RLS, pooled tenant reset and no foreign information in all tools including the new comparison.
- Install real dependencies and generate legitimate npm lockfiles, build production Vite frontend and both Cloud Run images.
- Native Vertex Gemini function calling with verified consent, malformed memory repair, semantic paraphrase retrieval, no-match rejection, reliable retry and tool result grounding.
- Multi-user, two-instance WebSocket ordering, reconnection, background model persistence, presence/typing expiration and no idle polling.
- Production Cloud SQL, Cloud Run worker OIDC/Tasks, Firebase hosting, real seeded AI transcript, demo credentials, GitHub repository, and five-minute demo video.

## Release verdict

**NOT APPROVED FOR FINAL SUBMISSION.** v7 eliminates additional verifiable source defects but cannot be called fully end-to-end correct without executing the real systems. Do not overwrite or resend the original technical brief; document deviation around monetary baseline in delivery README. Employer deadline clarified separately as Friday 16 October 2026; original assessment PDF's February date is superseded by Gonzalo's email.
