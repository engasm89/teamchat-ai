# Architecture and implementation contracts

This expands the latest brief into agent guidance. Employer mandates are in 01_REQUIREMENTS.md. Record deviations in the repository README.

## Module boundaries

| Module | Owns | Must not own |
|---|---|---|
| packages/contracts | Validated command/event/answer schemas | DB access, secrets, business side effects |
| apps/web | React room UI, one socket manager, reducer, source cards | Direct database access or business-tool routing |
| apps/api | Auth, membership, commands, replay, socket lifecycle | Gemini prompt business logic |
| apps/worker | AI job leases, native tool loop, persisted blocks | Browser socket ownership |
| packages/data | Tenant-scoped repositories, migrations, seed | Client rendering or model-selected authority |
| packages/retail | Pure decimal calculation and supersession | LLM-generated arithmetic |
| packages/agent | Tool declarations, validation, source ledger, memory | Unscoped queries or unchecked output |
| infrastructure | GCP configuration, IAM, deploy, recovery dispatch | Embedded credentials |

These are proposed paths to establish, not existing code. Engineers can work against typed interfaces and fixture mocks; integration tests verify actual boundaries. One owner coordinates migration order. Avoid splitting into more deployed services without evidence.

## Data and authorization

Protected records include tenant_id. Composite foreign keys include tenant_id. Important uniqueness constraints:
- (tenant_id, room_id, sequence) for room events.
- (tenant_id, author_uid, client_message_id) for send idempotency; compare payload and reject conflicting reuse.
- Tenant-scoped store ID, catalog code, memory key and tool operation ID.

Tables: tenants, users, memberships, rooms, room_memberships, messages, room_events, ai_jobs, task_outbox, tool_calls, answer_blocks, catalog, margin_classes, supersession_edges, segment_coefficients, stores, store_carried_codes, store_gaps, memories, memory_versions, presence_leases.

Bootstrap identity through a narrow verified-UID lookup. Internal job lookup returns only the job's owner/tenant to a trusted worker. Tools never accept authoritative tenant IDs. A membership change invalidates relevant live subscriptions. Restrict these lookup interfaces; do not give the API a general cross-tenant query escape hatch.

Use forced PostgreSQL RLS and a non-owner runtime role without BYPASSRLS. Set transaction-local tenant context before every protected query. Separate migration privileges. Runtime context is a second barrier against missed filters, not protection against a fully compromised trusted server or SQL injection; use parameterized queries and fixed tool interfaces.

## Real-time protocol

Authenticate the WebSocket with an initial frame; verify token and Origin. Limit unauthenticated sockets; pause access on expiry until reauthentication. Do not put tokens in URLs. Client receives no direct DB subscription.

A durable event envelope includes schema version, event ID, room ID, sequence, type, turn ID where relevant and validated payload. Commands include client_message_id where relevant. Server derives author and tenant. Ack only after message/event/job/outbox commit.

Allocate room sequences under a transactional room-row lock. Persist before broadcasting. Client deduplicates by event ID/sequence and detects gaps. Keep a bounded account-specific queue for unacknowledged sends; clear on logout.

Register local room subscription before reading. In a repeatable-read transaction capture history, answer state and high-water sequence. Buffer newer notifications, replay after cursor, then drain events above the watermark in order. Cap batches and buffers; disconnect slow consumers with a resumable reason.

Committed events trigger PostgreSQL NOTIFY with opaque identifiers/high-water marks, never business text. Dedicated LISTEN connections stay outside long transactions. Notifications are not protected by RLS: trusted servers still authorize every fetched event and recipient. Notification is only a wake-up; durable rows own recovery. On listener failure close affected sockets and require replay after reconnect. Configure keepalive/failure deadlines and test loss of the final notification, not only gaps followed by later events.

Presence leases are per connection. Renew live connections in batches every 20 seconds; expire after 60 seconds. Peers receive renewal signals to extend local expiry, but browsers do not receive unchanged presence repeatedly. Join snapshots exclude expired leases. Aggregate tabs by user. Typing expires in five seconds. One low-frequency socket heartbeat is allowed for liveness; no HTTP data polling.

## AI jobs and grounding

Cloud Tasks dispatch is backed by task_outbox; a private authenticated recovery endpoint retries pending dispatches. OIDC authenticates task invocation. Hold the worker request through execution; cap a turn at five minutes below the configured deadline. Use a renewable lease/fencing token. Persist tool plan/operation ID before execution. Side effects and operation results commit atomically; retries reuse them. Leased duplicate tasks are retryable; completed jobs acknowledge without rerunning.

Freeze the transcript cutoff per turn and keep separate turn IDs/buffers. Revision events replace incomplete generated output after a retry. Never splice regenerated prose onto an old partial answer. Limit queue depth, concurrent turns, prompt size, model rounds and tool calls; expose queued/failed states.

Gemini chooses search_catalog, get_catalog_code, get_store_assortment, calculate_uplift, search_memory and save_memory natively. Mention detection starts a turn only. Code normalization and abbreviation expansion happen inside retrieval, never as intent dispatch.

Maintain a per-turn source ledger. Answer blocks reference fetched record/field IDs or deterministic calculation IDs. Resolve all values on the server. Render fixed narrative templates and fetched fields, not unrestricted generated factual prose. Buffer incomplete structured blocks, validate, commit, then broadcast incrementally. Reject unfetched references. One repair attempt; fallback shows verified tool records and an explicit incomplete-answer state.

Do not assume an SDK supports every combination of function calls, streaming and structured output. Verify the actual pinned model/SDK. If separate tool-selection and answer-generation calls are needed, keep the native tool loop and source ledger intact; record the change.

## Retail rule version 1: explicitly assumed

Let C be distinct non-null classes mapped from the selected codes. Remove every class reachable through supersedes from another class in C. Score = sum(surviving segment-specific margin coefficients) × matching channel/format/segment coefficient. Delta = proposed score - baseline score. Use decimal arithmetic; round only at presentation. Validate graph targets and reject cycles.

Duplicate codes/classes never double count. Unmapped codes are excluded and reported. Adding APP-100.12 to ST-4003 adds no new class under this model. In a scenario that adds 318 and 321 at ST-4007, retain 318 once and remove 321. Evaluate combined gap additions as a set; do not sum individual deltas if their classes overlap or supersede each other.

A monetary scenario requires an explicit user baseline and labelled assumption (baseline × score delta); the score has no supplied financial calibration. Never call it forecast revenue or interpret it as a percentage. Without baseline return a numerical coefficient delta and explain what is missing. Preserve suspected-gap evidence and fixture contradictions.

## Memory

Tenant-filtered lexical + exact vector ranking over key and flat value. Generate embeddings through Vertex AI and pin model/dimension. Fit thresholds against paraphrased seeded examples and genuine no-match cases; do not hardcode answers.

Values: flat scalar object, at most 20 fields/8 KB; no arrays/nested objects. Provide field-level errors. Lossless flattening may repair; losing fields/changing meaning requires confirmation. Only acknowledge when text/embedding commit. Version-check updates, preserve earlier values and return conflicts explicitly. Source author/date/room is server provenance; an agreed_by field remains recorded content, not an authenticated approval grant.

## Resource lifecycle

Clean sockets, handlers, timers, subscriptions and aborted requests. Bound pools/queues/history and apply backpressure. Cap Cloud Run instance/pool totals against database limits; keep DB and model calls out of oversized transactions. Collect resource counts and memory behavior under repeated churn and idle load. Record actual tested load; do not claim unlimited scalability.
