# Phase 2 checkpoint — 2026-10-09

## Working and tested locally
- Original employer fixture ZIP retained byte-for-byte; all five data files parsed and SHA-256 versions recorded.
- Tenant-scoped fixture adapter (for offline unit tests, **not** production storage), flat memory validator and rejection of unverified factual source references.
- Pure BigInt fixed-scale coefficient-scoring function, supersession traversal and deterministic ST-4003 / ST-4007 checks. This is the rule explicitly **assumed** in the previously submitted brief; the fixtures do not give a complete financial model.
- PostgreSQL migration files for tenant-scoped schema, FORCED RLS, composite tenant FKs, ordered room events, idempotent messages, AI jobs and task outbox.
- Deterministic, repeatable SQL seed generator from source fixtures (`db/generated/seed.sql`).
- Mock-tested PostgreSQL transaction API with restricted tenant context, authorization, message deduplication, durable-event write order and cursor replay.
- Defined native Gemini tool declarations and server-side argument validation; **model invocation not implemented**.
- React UI scaffold with Firebase-auth-only imports and a browser-native WebSocket connection manager; **not built or run due to missing npm packages**.

## NOT complete, must not be represented as completed assessment
- No managed Firebase Auth project, user identities, real accounts, database service, Cloud Run, Cloud SQL, GCP credentials or deployments verified.
- No actual PostgreSQL migration applied or database-backed integration test; no WebSocket server, LISTEN/NOTIFY listener or two-instance test.
- No live Vertex AI Gemini function-calling loop, vector embeddings or semantic memory search. Lexical memory ranking is only a deterministic offline helper.
- No durable background AI jobs via Cloud Tasks, answer streaming, presence/typing, browser E2E or cross-instance reconnect validation.
- No GitHub remote created/pushed (GitHub connector offers repository listing/content writes but not repo creation, and no relevant existing repo found). No demo video or final credentials.

## Security warning
The local fixture repository and event log are deliberately marked *test adapter*. Never expose them in production as they have no verified Firebase membership enforcement or durable persistence. Database forced RLS is DDL only until tested using a restricted non-owner role. Gemini's tool selection must remain native; no keyword-based intent routing is implemented.

## Deployment dependencies
- Provision authorized GCP project and billing with Cloud SQL PostgreSQL, Cloud Run, Cloud Tasks, Secret Manager, Vertex AI Gemini & embeddings and Firebase Auth/Hosting.
- Pin verified available models, regions, IAM grants and service-account scopes; set Cloud SQL connection budgets.
- Install `pg`, `ws`, `firebase-admin`, Google Cloud Tasks and Vertex SDK dependencies and run the integration build/tests.
- Do not place passwords, GCP service JSON or Firebase admin secrets in public source control.
- Until cloud identity and billing are confirmed, **do not provision billable services**.
