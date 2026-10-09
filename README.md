# TeamChat AI — Assessment Build

**Phase 2 implementation checkpoint (October 9, 2026)** — NOT a finished assessment. See [`docs/PHASE2_STATUS.md`](docs/PHASE2_STATUS.md) for verified vs missing milestones.

The submitted Technical Brief predates application code and remains unchanged in `phase1-docs/` and Drive. Employer assessment original source is under `teamchat-ai-assessment/`.

## Quick commands (Node 22+)

```bash
npm test                 # pure-domain and mocked SQL transaction tests
npm run check            # TypeScript check (requires dev @types/node + typescript)
npm run verify:fixtures  # verify source fixture counts/hashes
npm run seed:sql         # regenerate db/generated/seed.sql
```

Run database migrations in order as a privileged migration identity, then run generated SQL seed with that identity. Use a different restricted runtime account for all user-initiated queries. Do **not** run the public API as the migration owner. Never set app.tenant_id from a request payload or model output.

## Architecture packages

- `src/fixtures.ts`: parser, fixture integrity/sha256 validation.
- `src/retail.ts`: deterministic arithmetic and transitive class supersession.
- `src/tenant.ts`: isolated context and opaque no-match responses; caller must have verified Firebase identity and membership first.
- `src/repository.ts`: OFFLINE-only domain fixture adapter.
- `src/memory.ts`: flat value validation and lexical test ranking (embeddings pending).
- `src/grounding.ts`: per-turn fetched-source ledger and validated typed answer blocks.
- `src/tools.ts`: declared Gemini functions and safe local execution boundary; no model routing.
- `src/events.ts`: OFFLINE-only event reducer/replay/deduplication model.
- `src/persistence/postgres.ts`: driver-independent transactional SQL contract with membership authorization, per-user advisory deduplication lock, room row lock, atomic message/event insert and authorized replay.
- `db/migrations/`: PostgreSQL RLS schema and event wakeups (not yet applied).
- `db/generated/seed.sql`: deterministic tenant-scoped SQL data loader (not yet applied).
- `apps/web/`: React/Firebase-auth + native websocket UI scaffold (not yet built).

## Known divergences / details from submitted Technical Brief

The submitted brief calls for Cloud SQL PostgreSQL + pgvector, Cloud Run native socket API and private worker, Vertex AI tool selection/embeddings, durable Cloud Tasks jobs and Firebase Hosting. The implementation currently stops at testable pure modules, migration SQL and mocked database API. A temporary in-memory adapter is used **only for unit tests**, not as a substitute for live durable infrastructure. A database memory embedding column has deliberately not been dimension-pinned before selecting and verifying the Vertex embedding model.

The financial coefficient rule remains an **explicit assumption** rather than business truth; show the inputs and no monetary value without supplied baseline.

## Assessment priorities

1. Tenant isolation: cross-tenant foreign lookup is indistinguishable from nonexistent ID. Database RLS MUST be integration tested.
2. Grounding: source-backed typed fields only, failed lookup must never invent a SKU.
3. Durable replay: transaction commits before event delivery. WebSocket listener/process recovery remains untested.
4. Gemini model chooses tools natively. The test fixture adapter is NOT an AI agent.
5. Expose current gaps and test failures honestly.
