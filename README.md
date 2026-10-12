# TeamChat AI — Controlease technical assessment

A multi-tenant team chat where an AI participant answers retail questions by calling tools against each chain's own data. Two chains (Northside Outfitters and Valley Home Goods) share one deployment and never see each other.

- Live app: https://focus-clean-4b9f4.web.app
- Walkthrough video, narrated and captioned (2 min 37 s): https://github.com/engasm89/teamchat-ai/releases/tag/walkthrough-2026-10-12
- Technical brief as submitted on 8 October 2026: `reference/submitted_technical_brief_2026-10-08.pdf`
- Requirement status, derived from evidence rather than written by hand: `docs/REQUIREMENTS_FINAL_SUMMARY.md` and `docs/REQUIREMENTS_FINAL_MATRIX.md`
- Release decision: `docs/FINAL_GO_NO_GO_REPORT.md`

## How to run

Requirements: Node.js 22.10 or later, PostgreSQL 15+ with the `vector` extension, a Firebase project with email/password sign-in, and a Google Cloud project with Vertex AI enabled.

```bash
npm ci && npm --prefix apps/web ci
npm run check            # TypeScript, backend and scripts
npm test                 # unit and mocked-integration tests (no network)
npm run verify:fixtures  # the five supplied datasets are byte-identical to the originals
npm run seed:sql         # regenerates db/generated/seed.sql from the datasets
```

Database, as a privileged migration role (never the runtime role):

1. Apply `db/migrations/001_schema.sql` to `007_semantic_memory.sql` in order (`007` needs `CREATE EXTENSION vector`).
2. Create the login `teamchat_api` (not superuser, not owner, no `BYPASSRLS`) and apply `db/provision_runtime_role.sql`.
3. Run `db/generated/seed.sql`.
4. `DATABASE_ADMIN_URL=... ASSESSMENT_USERS_JSON=... npm run provision:users` creates the six Firebase users and their memberships. Passwords come from the environment and are never printed.
5. `npm run embed:backfill` writes 768-dimension Vertex embeddings for the seeded memories.
6. `npm run test:postgres:required` runs the row-level-security tests as `teamchat_api`; it fails instead of skipping when anything is missing.

Run locally:

```bash
DATABASE_URL=postgres://teamchat_api:...@localhost/teamchat FIREBASE_PROJECT_ID=... ALLOWED_ORIGINS=http://localhost:5173 \
  GCP_PROJECT_ID=... GOOGLE_CLOUD_REGION=us-central1 npm run start:api
DATABASE_URL=... GCP_PROJECT_ID=... GOOGLE_CLOUD_REGION=us-central1 VERTEX_MODEL_ID=gemini-2.5-flash \
  VERTEX_EMBEDDING_MODEL_ID=text-embedding-004 npm run start:worker
cd apps/web && npm run dev   # needs VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_API_URL, VITE_WEBSOCKET_URL
```

The API queues AI jobs through Cloud Tasks (`CLOUD_TASKS_QUEUE_PATH`, `CLOUD_TASKS_WORKER_URL`, `CLOUD_TASKS_INVOKER_EMAIL`, `CLOUD_TASKS_AUDIENCE`), so AI turns need a queue that can reach the worker.

## How it is deployed

| Piece | Where | How |
| --- | --- | --- |
| React app | Firebase Hosting, site `focus-clean-4b9f4` | `npm --prefix apps/web run build`, then `firebase deploy --only hosting` from a clean clone |
| API and WebSocket server | Cloud Run `teamchat-api`, us-central1, up to 5 instances, 3600 s request timeout | image built by `deploy/cloudbuild.yaml`, deployed by digest |
| AI worker | Cloud Run `teamchat-worker`, private | same build; only the Cloud Tasks service account may invoke it (OIDC) |
| Database | Cloud SQL PostgreSQL 17 with pgvector | `DATABASE_URL` for `teamchat_api` comes from Secret Manager |
| Model | Vertex AI `gemini-2.5-flash`; embeddings `text-embedding-004` (768 dimensions) | set by `VERTEX_MODEL_ID` and `VERTEX_EMBEDDING_MODEL_ID` on the worker |

Images are built from a clean clone at an exact commit:

```bash
gcloud builds submit --config deploy/cloudbuild.yaml --substitutions=_GIT_SHA=$(git rev-parse HEAD)
```

Each image is tagged with the commit SHA and carries the label `org.opencontainers.image.revision`. Services are updated to the image digest, not a tag. `scripts/evidence/record-provenance.ts` then writes `qa_evidence/provenance.json`: source SHA, both digests and labels, live revisions, the Hosting release and the hash of every served asset compared with a local build, the model configuration, and the dataset hashes stored in the database. Every test runner refuses to produce evidence if the live digests differ from that file.

Cloud Run's front end reserves paths ending in `z`, so the health endpoint to use is `/health`; `/healthz` is answered by Google with a 404 before it reaches the service.

## Architecture

```
Browser (React)  ──one WebSocket──▶  Cloud Run API ──SQL (tenant context, RLS)──▶ Cloud SQL PostgreSQL
      │ Firebase Auth (sign-in only)        │  ▲ LISTEN/NOTIFY wake-ups              ▲
      │                                     │  └───────────── every API instance     │
      │                                     └─ Cloud Tasks (job ID only) ─▶ private worker ─▶ Vertex AI Gemini
      │                                                                        └─ tools run as SQL in the tenant context
```

- `apps/web` — React client: sign-in, one connection manager (`src/socket.ts`), an ordered event reducer, tool and answer cards.
- `src/server` — HTTP and WebSocket server, Firebase token verification, tenant resolution, room subscriptions, AI job creation and task dispatch.
- `src/worker` — Cloud Tasks handler: leases a job, streams Gemini with native function declarations, executes tools, validates and persists answer blocks.
- `src/persistence/postgres.ts` — every query runs inside `inTenantTransaction`, which sets a transaction-local tenant before any statement.
- `src/retail.ts`, `src/catalog-search.ts`, `src/memory.ts`, `src/grounding.ts` — deterministic calculation, catalog matching, memory validation and the answer-block contract. These are pure functions with unit tests.
- `db/migrations` — schema, forced row-level security on every tenant table, notification triggers, grants for the restricted role, pgvector.

Isolation is enforced twice. The server derives the tenant from the verified Firebase token and the membership table; tenant IDs from the browser or the model are ignored, and tool declarations have no tenant parameter. Under that, PostgreSQL row-level security (forced, and the runtime role cannot bypass it) filters every table by the transaction's tenant. A store from the other chain returns exactly the same payload as a store that does not exist.

## Real-time delivery

The browser opens one native WebSocket to the API. Firebase is used only to sign in; there are no Firebase database listeners, no managed sync service and no polling. The ID token travels in the first frame (`auth`), never in the URL, and the server checks the Origin allowlist.

1. Sending a message commits the message, its room event, any AI job and a task-outbox row in one transaction. The room sequence number is allocated under a row lock, so order is the same for every instance. A repeated `clientMessageId` returns the original result.
2. A trigger issues PostgreSQL `NOTIFY` with only the room and sequence. Each API instance holds a dedicated `LISTEN` connection; on a wake-up it reads the authoritative events from the table and sends them to its subscribed sockets. Notifications carry no content, so a lost or merged notification costs nothing: the next read starts from the last sequence.
3. The client keeps a cursor per room in `sessionStorage` (keyed by user) and applies each event once by event ID and sequence. On reconnect or refresh it subscribes with `after=<cursor>` and the server replays everything after it, then continues live.
4. Presence and typing are short-lived database leases, not transcript events. An idle browser exchanges only WebSocket ping/pong frames.
5. Sockets are rotated before the Firebase token expires (at most 45 minutes); the client reconnects and replays, so rotation is invisible.

How each behaviour in the assessment is guaranteed, and where it is tested against the deployment (`scripts/acceptance`, results in `qa_evidence/runs`):

| Behaviour | Mechanism | Evidence |
| --- | --- | --- |
| Both browsers see the fetch live | tool start, tool result and answer blocks are room events | S01 (protocol), BROWSER-S01 (two real browsers) |
| Two simultaneous questions | separate jobs, turn IDs, tool records and transcript cutoffs | S14 |
| Refresh mid-answer | answer blocks are persisted before broadcast; the worker is unaffected by the browser; replay rebuilds the turn | BROWSER-S15, with a negative control that suppresses the turn |
| 30 s network cut | replay from the saved cursor, deduplicated by event ID | BROWSER-S16: a real TCP cut through a proxy, compared event by event with the database |
| Idle minute | one socket, ping/pong only | BROWSER-S17: socket count, request allowlist and frame rates measured from before sign-in |
| Second API instance | LISTEN/NOTIFY fan-out | A12 |
| Cold start keeps memory | memories live in PostgreSQL | S19 forces new API and worker revisions, then recalls a unique value |

## How the model acts

The worker sends Gemini native function declarations (`src/tools.ts`): `search_catalog`, `get_catalog_code`, `get_store_assortment`, `calculate_uplift`, `compare_assortment_options`, `search_memory` and `save_memory`. The `@AI` mention only starts a turn; Gemini chooses the tools. Nothing routes a question to a tool by keyword.

At the boundary the model is treated as untrusted:

- The server validates the tool name, arguments, size and call budget, then runs the tool with the server's tenant context. The model cannot name a tenant.
- Tool results are structured records with source references, stored as `ai_tool` events and shown to everyone in the room.
- Business facts (codes, margin classes, coefficients, store facts, calculations) reach the screen only as typed answer blocks that the server renders from records fetched in that turn (`src/worker/verified-block.ts`). A block that refers to something not fetched is rejected. The model's free prose is not broadcast.
- `calculate_uplift` and `compare_assortment_options` compute the assortment coefficient score on the server: distinct mapped margin classes, minus classes superseded (transitively) by another present class, summed segment coefficients, times the store's channel/format/segment coefficient. The result is dimensionless and labelled "not a sales forecast".
- `save_memory` accepts flat objects only (scalars, at most 20 fields, 8 KB). An invalid value comes back with field-level errors and one repair attempt; otherwise nothing is saved. Author, room and date come from the server.
- Text in memories or tool results that claims authority ("admin mode") is data, not instruction. It cannot change the tenant because the tenant is not the model's to choose.

## How the brief changed

- **No monetary figure.** The brief promised a money scenario when the user supplies a monetary baseline (scenario value = baseline × score difference). The build returns only the dimensionless coefficient difference: a baseline typed in chat cannot be verified, and the model must not be the one supplying it. `compareScores` still supports the multiplication, but no tool exposes it.
- **A seventh tool.** `compare_assortment_options` was added for the "compare two codings" scenario, so the arithmetic is one server calculation instead of two model-combined ones.
- **No shared contracts package.** The brief described `packages/contracts`. The server's types live in `src/types.ts` and `src/events.ts`, and the web app keeps its own copy of the event shape in `apps/web/src/socket.ts`, so a protocol change has to be made in both places.
- **No Cloud Scheduler recovery job.** The code has the outbox and reservation logic for re-dispatching jobs whose Cloud Tasks call failed, but no scheduler job is deployed. A task that fails to dispatch stays queued in the outbox until it is retried by hand.
- **Testing went further than planned.** Requirement status is derived by `scripts/validate-matrix.ts` from recorded runs, and every run is bound to the source commit and image digests.

## What does not work

- **Sender names are raw Firebase user IDs.** Messages show the author's UID (for example `m8O2in6s…`), not a display name, even though display names exist in `user_memberships`.
- **No auto-scroll.** New messages arrive but the transcript does not scroll to them. The walkthrough's recording script scrolls for the viewer.
- **Only the newest 500 events of a room are rendered.** There is no "load older" control.
- **No monetary uplift**, as described above.
- **Answers are terse.** Because only verified blocks are shown, replies read as data cards rather than conversation. An injection attempt can produce an odd but harmless answer; in the walkthrough, Gemini answered the admin-mode line by searching the catalog for "stores".
- **Gemini is nondeterministic.** Acceptance asserts tool calls and server-computed values, not wording. S01–S18 each needed two passing runs against the deployment; S19, which forces new revisions, needed one.
- **Operational hardening is not done.** Cloud SQL has automated backups disabled, a public IPv4 address, and its SSL mode allows unencrypted connections (`ALLOW_UNENCRYPTED_AND_ENCRYPTED`). No authorized networks are configured, so the public address only accepts IAM-authorized Cloud SQL connector and proxy connections, but these settings should be tightened before real use.
- **A silent provider switch.** If `GEMINI_API_KEY` is set, the worker uses the Gemini Developer API instead of Vertex AI. Production does not set it.
- **No undispatched-job recovery**, as described above.

## Test credentials

Six accounts: three per chain, all members of `#assortment-review` and `#category-strategy`, which hold seeded human history and at least one real AI exchange that fetched data. The QA scenarios ran in `#supply-planning` (Northside) and `#range-planning` (Valley).

| Chain | Accounts |
| --- | --- |
| Northside Outfitters | buyer 1, buyer 2, analyst 3 |
| Valley Home Goods | buyer 1, buyer 2, analyst 3 |

Passwords are sent privately, separately from the submission e-mail; they are not in this repository, its history, the video or the evidence. (The account addresses appear in the test harness, `scripts/acceptance/common.ts`, and are blurred in the video.)

To check isolation yourself: sign in as a Northside user and ask `@AI Show me the assortment for store ST-4013.` (a Valley store; you should get "No matching record is available in this workspace", the same answer as for `ST-4099`, which does not exist). Then sign in as a Valley user in another browser and ask the same question; Valley gets its store. Asking either chain `@AI What is our Q1 assortment target?` returns that chain's own figure only.

## Tests and evidence

- `tests/` — unit and mocked-integration tests: catalog matching, supersession and arithmetic, grounding rejection, tenant context, memory validation, socket and job lifecycle.
- `scripts/integration/live-postgres.test.ts` — row-level security, grants and forbidden writes as the real runtime role.
- `scripts/acceptance` — the employer scenarios S01–S19 against the deployed stack, a browser suite for S01/S15/S16/S17 with negative controls, and an independent oracle that reads the supplied datasets directly.
- `scripts/handoff`, `scripts/video`, `scripts/gates` — reviewer accounts and isolation, the walkthrough and its secret scan, and clean-clone build and test gates.
- `qa_evidence/runs/<run>/` — `results.json` (assertions, inputs, expected and actual values, tool traces), raw artifacts and a `MANIFEST.json` of checksums for each run.
