# Skills and documentation for the implementation agent

This is a capability map, not a request to install plugins or create new skills. Verify what is available in the agent's current environment. An installed skill is useful guidance; it does not replace the assessment or prove competence.

## Required engineering competencies

| Competency | Work it must support | Proof |
|---|---|---|
| React + TypeScript | Typed reducer, socket lifecycle, source UI and loading/error states | Two-browser flow; cleanup/reconnect tests |
| Node.js + runtime validation | Auth context, commands, tools, bounded async work | Valid/invalid contract tests; no uncaught side effects |
| Firebase Auth | Token verification, seeded UIDs, authorization mapping | Real auth flow plus negative tests |
| PostgreSQL + SQL security | Composite keys, transactions, RLS, pools, repeatable seed | Restricted-role integration tests |
| WebSockets + distributed events | Ordering, replay, presence, listener recovery, backpressure | Different-instance tests and network capture |
| Vertex AI Gemini | Native function calling, real streaming, schema limitations | Actual Vertex traces and rendered source ledger |
| Retrieval and embeddings | Tenant-filtered semantic memory with provenance | Paraphrase/no-match/cross-tenant tests |
| Retail graph and decimal arithmetic | Transitive supersession, deduplication, explicit assumptions | Independent expected-value tests |
| Durable jobs | Cloud Tasks/OIDC, outbox, leases/fencing and idempotency | Crash/redelivery tests |
| GCP operations | IAM, Cloud Run, Cloud SQL, Firebase Hosting, quotas/secrets | Live deployment and clean smoke checks |
| Security testing | Prompt injection, object references, XSS, secret protection | Adversarial tests at every entry point |
| Engineering explanation | README, decision changes and concise demo | Reviewer can trace one actual turn |

## Available skills to apply where relevant

Names reflect this session's catalog. A future agent must discover/read the actual skill before applying it; do not assume these packages exist everywhere.

| Skill | When it helps |
|---|---|
| superpowers:writing-plans | Turning the approved brief into bounded implementation tasks; preserve the existing decisions |
| superpowers:test-driven-development | Meaningful security, arithmetic and recovery behavior before implementation |
| superpowers:systematic-debugging | Unexpected behavior/test failures; diagnose rather than weakening guards |
| superpowers:verification-before-completion | Before claiming a milestone is complete or publishing test results |
| superpowers:requesting-code-review | Review hard boundaries and major features before delivery |
| superpowers:using-git-worktrees | Isolate feature work when an actual existing repository needs it |
| superpowers:executing-plans | Implement agreed milestones with actual evidence |
| superpowers:brainstorming | Only where a genuinely unresolved design question needs it; do not redo the submitted brief |
| PDF / documents | Brief or submission-document edits, only if requested/needed |
| Library | Save requested user-facing artifacts in this Work environment |
| write-like-me | Draft Ashraf's communications; does not authorize sending |

A skill may require specialist reviewers/subagents; follow applicable skill instructions and current user authorization. Do not invent parallel delegation permissions. Do not use a Vercel/Sites deployment workflow as a substitute for the required GCP platform. OpenAI tool calling is not a substitute for native Vertex AI Gemini calls.

## Primary documentation

Read current documentation at implementation time. Pin the chosen Node runtime, SDKs, model IDs and embedding dimension; do not copy stale API snippets from this plan.

- Firebase token verification: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Firebase Hosting: https://firebase.google.com/docs/hosting
- Cloud Run WebSockets: https://docs.cloud.google.com/run/docs/triggering/websockets
- Vertex AI function calling: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
- Cloud SQL PostgreSQL extensions: https://docs.cloud.google.com/sql/docs/postgres/extensions
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL LISTEN: https://www.postgresql.org/docs/current/sql-listen.html
- PostgreSQL NOTIFY: https://www.postgresql.org/docs/current/sql-notify.html
- Cloud Tasks HTTP targets: https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
- Cloud Run asynchronous tasks: https://docs.cloud.google.com/run/docs/triggering/using-tasks
- Cloud Run billing: https://docs.cloud.google.com/run/docs/configuring/billing-settings

## What a skill cannot solve automatically

It cannot provide missing GCP/GitHub access, employer confirmation, a financial baseline, a correct architecture without testing, or guaranteed hiring. Label those as missing evidence. Avoid installing unrelated tools or broadening scope to compensate for a blocker.
