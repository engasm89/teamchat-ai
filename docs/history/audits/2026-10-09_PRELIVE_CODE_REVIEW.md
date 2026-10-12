# TeamChat AI — pre-live code review and corrected checkpoint

Date: 2026-10-09. Scope: source-only audit and tests before accessing production Firebase, Cloud SQL, Cloud Tasks, or Vertex AI.

## Corrections made in this review

1. **AI-message retry/consent divergence (high).** Existing client message IDs now return their original turn ID and reject changes to the originally recorded shared-memory consent flag. Added a regression test.
2. **AI operation replay mismatch (critical for grounding).** When a worker retries, it checks stored tool name AND canonicalized arguments against the new function call before reusing any result. A changed plan fails closed, rather than presenting an unrelated result as verified. Added tests.
3. **AI lease progress and exhausted retries (high).** Every fenced progress commit renews the current lease. An expired job with five claimed attempts is finalized with a durable `ai_failed` event instead of remaining `running` forever. Added tests. Long single SDK calls can still outlast a lease and require live fault-injection tests.
4. **Privileged SQL credential misuse (critical security configuration).** The API and worker inspect their actual database role at startup and refuse superuser, BYPASSRLS, table-owner, or non-`teamchat_api` roles. Added startup regression tests.
5. **Frontend auth race (medium).** WebSocket subscribe, send, and typing frames are deferred until authentication acknowledgement. Added a browser socket regression test.
6. **Account-switch data exposure (high privacy).** Transcript, presence, typing, channels and shared-memory consent are scoped to the current Firebase UID; old network promises are aborted/ignored on user change and stale socket events are ignored.
7. **Presence identity lifecycle (medium).** Presence/typing broadcasts revalidate receiver room membership and filter deactivated users. Event pump exits when a subscription is replaced; a closed socket is not advanced by replay.
8. **Command flooding (medium).** Per-socket concurrent commands and typing updates are bounded. This is a local mitigation, NOT a comprehensive rate-limiting/DDOS solution.
9. **Demo-user registration (medium).** Provisioning rejects duplicate emails and refuses a preexisting Firebase UID mapped to another tenant instead of continuing silently.
10. **Long-session UI memory (medium).** Recent rendered event lists are capped at 500 entries per room. Long-history paging and bounded initial replay remain pending design work.
11. **Documentation (low).** Corrected migration range to 001–006, updated review notes and evidence.

## Security and quality checks performed

- Verified all five unchanged employer fixtures and regenerated the original 2,753 tenant-scoped SQL inserts.
- Ran project offline regression suite and backend TypeScript typecheck; exact results archived in `docs/evidence/prelive_v3_offline_tests.tap` and `prelive_v3_tsc.txt`.
- Checked `git diff --check`, repository status, and JSON parsability where possible.
- No external database, Firebase identity provider, Vertex AI model, Cloud Tasks queue or public deployment was accessed.

## RELEASE BLOCKERS — do not submit as completed

- **Real PostgreSQL/RLS proof:** No accessible DB instance or restricted runtime credentials; `npm run test:postgres` skips without them. FORCE RLS cannot be proven by SQL text or mocks.
- **Live dependencies and frontend build:** npm registry access and local frontend dependencies are not available. Generate and commit real npm lockfiles before Cloud Run/Firebase builds, then run the React build.
- **Gemini native SDK integration and progressive output:** SDK config is implemented, but actual function calls, token/partial-block streaming, limits and cancellation need live tests. The worker currently emits verified result blocks, not validated token-by-token prose.
- **Semantic organizational memory:** Current SQL `search_memory` uses tenant-scoped lexical PostgreSQL full-text retrieval; the required embedding-based semantic/paraphrase search is NOT implemented. Choose an allowed Vertex embedding model, dimension and `pgvector` migration, then re-seed embeddings and test cross-room paraphrases.
- **Failure injection:** Real concurrent socket instances, notification disconnect/recovery, Cloud Task retries, worker restarts mid-turn, lease fencing and OAuth/OIDC handling remain untested.
- **Scale/pagination:** Replaying a room from sequence zero can retrieve all history even though browser rendering is capped. Add bounded historical snapshots or paging for production scale.
- **Deployment:** No cloud resources or live environment variables have been configured, no public URL exists, and no remote GitHub repository has been pushed.

## Required live-gate order

1. Install pinned dependencies and produce reproducible lockfiles; run backend/React builds and dependency audit.
2. Provision PostgreSQL and execute migrations as owner; seed original data; provision distinct runtime role and real Firebase UIDs.
3. Run `npm run test:postgres` with all required credentials and assert **zero skipped tests**. Extend with revocation, grants, concurrent transactions and cross-tenant SQL tool tests.
4. Run Firebase token tests and WebSocket multi-instance/reconnect/replay tests; inspect idle network traffic and pooled connection leaks.
5. Implement and verify semantic memory using live Vertex embeddings; execute native Gemini tools, adversarial grounding, source verification and Cloud Task retry scenarios.
6. Build frontend; verify two-company accounts/browser history, consent, presence, typing; deploy and record reproducible evidence.

This review is a pre-live **source checkpoint**, not evidence of production correctness or completion of the employer assessment.
