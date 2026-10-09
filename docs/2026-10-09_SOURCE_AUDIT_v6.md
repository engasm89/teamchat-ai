# TeamChat AI — v6 audited source changes and evidence

Date: 9 October 2026. Employer assessment deadline as clarified in email: 16 October 2026 (exact time unknown).

## Defects corrected in this revision

1. Broad product retrieval could return unrelated matches on substrings such as `thing` in `clothing`. Replaced with word-token scoring and null responses for products not in the fixtures.
2. Combined `AC and SSD` request could exhaust top results on one category. Deterministic interleaving returns verified examples of both, without keyword-routing an AI tool. Gemini still selects tools using native function calls.
3. Reverse code lookup and store input did not handle omitted separators. Added strict canonicalization with no invented records.
4. Local fixture test adapter used a different catalog scoring algorithm from PostgreSQL executor. Both now use the same domain ranking and code normalization.
5. Concurrent room subscribe/unsubscribe operations could overtake each other while waiting for DB lease creation. Added per-socket, per-room async serialization and a regression test.
6. Firebase UID-to-tenant resolution held a DB connection while acquiring a second; a one-connection pool could deadlock. The directory lookup now releases before tenant-scoped transaction.
7. A failed database ROLLBACK could return a poisoned pooled connection. The transaction helper now passes the error to `pg` release, discarding that connection.
8. Repeated presence lease renewals broadcast the same full list every 20 seconds. Cached membership signatures prevent redundant browser application frames while server DB heartbeat continues to detect expiry.
9. Idle React UI rerendered every 3 seconds. Typing-expiration timer now exists only while pending typing indicators have not expired.
10. Absent catalog/memory/store results were rendered as raw empty JSON. The worker now persists fixed, truthful no-match blocks that are safely rendered by the React UI; model prose cannot claim unverified business facts.
11. Memory retrieval for newly saved records exposed Firebase UID rather than a recognizable colleague name. Tenant-scoped membership join now provides display name with original UID/source room/date retained.
12. Original code lacked **genuine model-backed demo transcript bootstrap**. Added an opt-in, fail-closed script using actual Gemini function calling and real persisted tool events in both tenants. It **must be run** after provisioning; it is not claimed as executed here.
13. Employer evaluation was previously tracked primarily by notes. Added a 27-row scenario traceability table covering source, acceptance tests, and live blockers.
14. Live PostgreSQL test now also verifies the public store lookup tool's foreign-versus-unknown equivalence and separator-free existing code lookups.

## Evidence on this source revision

- `npm run check` — backend TypeScript, PASS.
- `npm test` — offline tests (exact count in `docs/evidence/v6_offline_tests.tap`), PASS.
- `npm run verify:fixtures` — five fixture hashes and shapes, PASS.
- `npm run seed:sql` — deterministic fixture SQL, PASS; SQL **not executed** on a PostgreSQL server here.
- Verified code paths and tests for forbidden Firebase DB listener/polling, source-backed block rendering, tenant-scoped transactions and WebSocket lifecycle.
- Full React `vite build` **not executed**, npm dependencies unavailable.
- Strict `npm run test:postgres:required` **blocked** by absent PostgreSQL and credential configuration; not a passed test.
- `npm run verify:packaging` **blocked** by missing genuine lockfiles. Registry attempt failed on DNS (`EAI_AGAIN`). No lockfile was invented.

## Remaining issues that MUST NOT be represented as fixed

- Actual PostgreSQL RLS enforcement, migration success, pgvector, runtime role and pooled-connection safety need live database evidence.
- Source cannot prove cloud SDK compatibility, Firebase token verification, Cloud Tasks OIDC, Vertex model/embedding API semantics, native function-call tool selection and concurrent recovery.
- Memorized paraphrases and nested repair need real Gemini and real seeded embeddings. Similarity threshold must be calibrated from evidence, not assumed.
- Two-instance WebSocket ordering, 30-second disconnect replay, resource leak resistance and cold-start behavior require deployed failure injection.
- Missing npm lockfiles; no verified `npm ci`, Vite/React build, Google Cloud deploy, public URL, reviewer credentials or demo video.
- Room transcript remains intentionally bounded in-browser; full historical paging is not implemented and should be recorded as a conscious limitation.

This is a stronger **pre-live** implementation, not a certification that all end-to-end defects are fixed. Employer pass/fail requirements remain release-blocking until validated against real services.
