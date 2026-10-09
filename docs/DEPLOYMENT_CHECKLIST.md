# TeamChat AI — Deployment checklist (requires authorized GCP project)

> Nothing in this file asserts that deployment, live PG tests, or model tests have passed.

## Credentials and resources

- Cloud SQL PostgreSQL instance, private connection preferred; create dedicated database and different migration/runtime users. `teamchat_api` is **nonowner / no BYPASSRLS / no superuser**.
- Apply 001–006 migration SQL as schema owner and grants after role creation; verify DB roles. Run generated seed as owner with transaction-local tenant contexts.
- Firebase Auth email/password enabled. Provision 3 users per company with server-controlled mapping via `scripts/provision-demo-users.ts`; credentials via secret manager, do not store in Git history.
- Vertex AI authorized service account and tested specific model availability. No fallback to an unrelated provider.
- Cloud Tasks queue and OIDC invoker service account, Cloud Scheduler job calling worker `/internal/dispatch` with identical OIDC audience; worker service must require Cloud Run IAM invocation.
- API Cloud Run service allows browser HTTPS/WebSocket only on configured origin; worker private service has different IAM access. Cloud SQL connector/network configured to avoid public DB access.
- Deploy API and worker using `deploy/Dockerfile.api` and `deploy/Dockerfile.worker` respectively. Build context is repository root; these Dockerfiles require internet during build to obtain dependencies.
- Configure API 60-minute Cloud Run request timeout (or shorter with reconnect). Set database pool limits according to max instances and Cloud SQL connection budget; keep instances <= verified connection capacity.
- Build web: `cd apps/web && npm install && npm run build`; deploy from `apps/web` with Firebase Hosting configuration.

## Mandatory tests before claiming pass

1. `npm test` (offline, mocked); `npm run check`; `npm run test:postgres` (must have NO SKIP).
2. Role / RLS audit: missing tenant context returns zero, foreign store returns zero, cross-tenant writes denied, pooled connections do not leak tenant identity.
3. Firebase token/role tests: invalid, expired, revoked, and foreign room tokens denied, and forged tenant overrides ignored.
4. Two browser sockets on different API instances: same ordered events, duplicate send idempotence and persisted replay after 30s disconnection; notifications and listener loss recovered.
5. Native Gemini function-call traces tested against actual Vertex model. Verify no hallucinated SKU/class/store data and that a fake competitor request is indistinguishable from nonexistent record.
6. Retry/failure injection: Cloud Tasks retries, idempotent shared memory, worker restarts mid tool turn, partial-answer revision, reconnect mid answer, presence/typing.
7. Snapshot financial calculation caveat and missing coefficient handling; ensure no ungrounded revenue number.
8. Last: public URL, repo and demo video; protect assessment passwords in private submission only.

## Known unsupported features and risks

- `presence` + `typing` code has NOTIFY/lease transport and UI indicators, but live cloud-instance recovery/expiry semantics remain unverified and need testing.
- No semantic embeddings/pgvector memory retrieval yet; lexical retrieval is not full requirement compliance.
- Need end-to-end tests with live Cloud Tasks, Cloud SQL, Cloud Run and Vertex AI; no connectivity/credentials in supplied workspace.
- Worker retries and lease expiry need deeper fault injection. Current demo code may require extra production hardening after a real run.
- npm lock files must be generated/committed during deployment preparation (package registry unavailable here).
