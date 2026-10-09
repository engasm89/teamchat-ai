# Mandatory live release gate — TeamChat AI v6

**No deployment or cloud test is claimed complete by this checklist.** Follow this order in an authorized Google Cloud project.

1. **Dependencies:** Generate and commit actual root and frontend npm lockfiles in a networked environment; run `npm ci` and `cd apps/web && npm ci && npm run build`. Pin and audit versions. Node >=22.10.
2. **Cloud SQL:** Install PostgreSQL and pgvector (`vector`) using the permitted Cloud SQL privileged role, then apply migrations `001`–`007` as migration owner. Create runtime role `teamchat_api` as nonowner without SUPERUSER/BYPASSRLS. Run `db/provision_runtime_role.sql` after migrations.
3. **Data:** `npm run verify:fixtures`, `npm run seed:sql`, execute generated SQL with owner, confirm 12 stores and 4 memories per tenant.
4. **Firebase:** Enable email/password, set Firebase Admin credentials via service account, run `npm run provision:users` with 3 real users per company, all in `assortment-review` and `category-strategy`. Store passwords separately and privately.
5. **Semantic memory:** Select a supported Vertex embedding model/region; set `VERTEX_EMBEDDING_MODEL_ID`, `GCP_PROJECT_ID`, `GOOGLE_CLOUD_REGION`, and restricted `DATABASE_URL`; run `npm run embed:backfill` before launching the Gemini worker. Verify model and embedding dimension 768.
6. **Strict database test:** Set `TEST_NORTHSIDE_UID` and `TEST_VALLEY_UID`, then run `npm run test:postgres:required`. It must PASS with zero skips. Test foreign/nonexistent lookup equivalence, forced RLS, tenant reset on pooled connections, illegal cross-tenant writes and all seeded vectors.
7. **Real AI fixture history:** Set second user UIDs `TEST_NORTHSIDE_UID_2` and `TEST_VALLEY_UID_2`; run `npm run demo:bootstrap:live`. Require recorded `ai_tool`/`ai_complete` in both tenants before evaluator use. Never invent model activity.
8. **Model + durable tasks:** Set verified `VERTEX_MODEL_ID`. Configure Cloud Tasks queue, OIDC audience, private worker IAM and Cloud Scheduler recovery. Confirm real native Gemini tool calls and source-backed result blocks. Inject failures and task retries; ensure no lost turn, duplicate memory, or authorization bypass.
9. **Cloud Run:** Deploy API and private worker with respective Dockerfiles and production environment variables. Configure WebSocket request timeout and instance concurrency; **enable liveness probe** on `/healthz`. Two-instance LISTEN/NOTIFY fanout and 30-second reconnect are required. PostgreSQL connection budget must cover per-instance pool + dedicated LISTEN connection.
10. **Firebase Hosting:** Build React client with real Firebase/API/WebSocket endpoints and deploy. Use two logged-in browsers, verify access boundary, messages, typing/presence, transcript restore, and idle network free of polling.
11. **Evaluation:** Test every employer scenario; investigate semantic paraphrase similarity threshold and no-match behavior. Capture tests/logs; provide public URL, GitHub URL/commits, controlled credentials, README and under-five-minute demo by October 16, 2026 (exact time unconfirmed).

**Stop release on ANY failed or skipped tenant-isolation, grounding, live PostgreSQL, or browser/worker acceptance check.** See `2026-10-09_END_TO_END_PRELIVE_AUDIT_v5.md` for limitations and changed code.

**v6 source review:** See `2026-10-09_SOURCE_AUDIT_v6.md` and `REQUIREMENTS_TRACEABILITY_v6.md`. Test expired-running Cloud Task recovery, room unsubscribe, stale browser sockets, and graceful shutdown before signoff.

## v8 retry/replay contract

- A worker reclaim with incomplete answer blocks emits one durable `ai_answer_reset` event in the same transaction as clearing active blocks; `turn_id` is propagated in replay frames. A client must hide earlier answer blocks for that turn when displaying historical events, including after refresh.
- `ai_tool_start` records immutable name/arguments before a tool side effect. A matching persisted plan is required before storing `ai_tool` results; retry may reuse completed tools and must fail on divergent requests.
- Verify a worker interruption after `ai_tool_start` and after the first `ai_answer_block`, then reconnect a second browser and assert no mixed prior/retry content, with full committed tool history.
