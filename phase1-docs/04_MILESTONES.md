# Implementation milestones and first gate

These are proposed sequencing targets, not commitments approved by the employer. Reassess against actual access and progress. Deadline is 16 October 2026; submission hour is unknown. Aim to have a stable deployment and submission material on 15 October rather than depend on an unspecified last-hour cutoff.

## M0: process and access inventory

- Brief submission VERIFIED (8 October 2026); confirm application code first-commit chronology before calling G01 fully evidenced. No employer approval is needed afterward.
- Source ZIP, sent PDF and all five fixture hashes VERIFIED in the Phase 1 completion pack.
- Inspect actual repository and git identity. Do not create duplicate repositories.
- Read-only GCP/Firebase/GitHub access and billing checks first. Resolve absent access with one precise blocker report.

Evidence: Gmail sent item `1a11cb0c10ca3fc6`; package fixture manifest. **Current state: brief/fixtures VERIFIED; cloud/GitHub access NOT VERIFIED.**

## M1: cloud readiness, repository, seed, authentication and isolation

Suggested target: 8–10 October, dependent on M0. Do not equate document creation with this milestone.

### Cloud readiness checklist

- [ ] Record actual gcloud/Firebase identity and selected project ID; avoid exposing tokens.
- [ ] Verify permission to use the project and to deploy intended services.
- [ ] Verify billing is active on the selected project; read-only verification does not authorize linking a new billing account.
- [ ] Inspect required APIs: Cloud Run, Artifact Registry, Cloud Build if used, Cloud SQL Admin, Vertex AI, Cloud Tasks, Cloud Scheduler, Secret Manager, Firebase Authentication/Hosting setup.
- [ ] Verify region availability, Gemini and embedding model access, quota and actual runtime authentication.
- [ ] Prepare IAM plan: API, worker and dispatcher service accounts; least privilege; migration role separate.
- [ ] Inspect Cloud SQL/pgvector availability and DB connection limits; plan storage backups and pool caps.
- [ ] Explain expected billable resources and concrete provisioning plan before any new unapproved spend. Never assert that all services are free.
- [ ] Verify the chosen browser/API origins and Firebase authorized domains.

Useful read-only commands, if the actual CLIs are installed:

```bash
gcloud auth list
gcloud config get-value project
gcloud projects describe PROJECT_ID
gcloud billing projects describe PROJECT_ID
gcloud services list --enabled --project PROJECT_ID
firebase projects:list
```

PROJECT_ID is an intentional parameter, not a known value. Verify current syntax with CLI help/official docs. Billing command success does not prove every deploy permission or quota. Missing permission to view billing means billing status is unknown, not disabled.

### Repository checklist

- [ ] Confirm brief submission and intended GitHub repository before app scaffolding.
- [ ] Establish TypeScript modules/contracts, frontend/API/worker entry points and documented module ownership.
- [ ] Pin dependencies/lockfile; use current official SDK documentation.
- [ ] Ignore secrets, private credential exports, local env files and generated temporary artifacts.
- [ ] Use .env.example with names and dummy values only.
- [ ] Add meaningful test configuration and evidence folder conventions.
- [ ] Keep employer fixtures byte-identical; loading transforms belong in the seed script.

### Seed checklist

- [ ] Schema/migrations include tenant composite keys, RLS, distinct runtime/migration roles.
- [ ] Both tenant namespaces exist.
- [ ] Each has catalog/coefficient copies; verify source counts, nulls and relationships.
- [ ] 12 stores and four memories per tenant, correct source provenance and embeddings.
- [ ] Three or more real Firebase Auth test users per tenant; room membership maps verified UIDs.
- [ ] Users cannot self-select a tenant through browser input or model arguments.
- [ ] Clean seed succeeds; safe rerun does not duplicate users/data or overwrite authored changes unexpectedly.
- [ ] Keep demo credentials private; record safe account labels only in public docs.

### Authentication and isolation checklist

- [ ] Valid token maps to server-owned membership.
- [ ] Invalid/expired token, unknown UID and forged tenant fail safely.
- [ ] Foreign and nonexistent store IDs expose identical outward no-match behavior.
- [ ] Room/history/memory/job access is scoped, not just store routes.
- [ ] Runtime SQL role enforces RLS; alternating pooled tenant contexts cannot leak.
- [ ] Tenant-shared keys return tenant-specific values.
- [ ] End-to-end authenticated read works locally; live auth/runtime smoke check recorded separately.

**M1 exit:** repeatable seed + genuine identity mapping + real restricted-role isolation tests, with cloud readiness evidence or precise remaining blockers. An emulator/local pass alone is not a live-cloud pass. Genuine tool-backed seeded conversation history is completed at M3, not fabricated at M1.

## M2: real-time and recovery

Suggested target: 10–12 October. Build durable room ordering, deduplication, one socket, cross-instance wake-ups, replay, snapshot races, presence and typing. Exit only after two browsers/two instances pass the relevant E/H checks.

## M3: Gemini, retail and shared memory

Suggested target: 12–14 October. Native tool selection, source ledger, validated incremental answer blocks, formula version/tests, semantic memory, task retries and genuine seeded tool history. Cross-tenant prompt attacks must pass without changing access. Keep unit mocks separate from live evidence.

## M4: deployment verification and deliverables

Suggested target: 14–15 October. Verify live identity/transport/model/DB/tasks, idle capture, cold start, resource cleanup, clean setup and seed. Complete README, demo, credentials delivery preparation and evidence matrix. Do not finish all coding first and leave cloud integration until the final day.

## M5: submission by 16 October

Prepare repo/live URL, credentials, tests, limitations and <=5-minute demo. Sending/submitting remains a separately authorized action. Confirm time zone/hour if needed; do not delay safe earlier delivery while waiting for that clarification.

## Cut order if behind

1. Remove decorative UI work and extra convenience features.
2. Keep core lookup, native tools, isolation, grounding, arithmetic and recovery.
3. Disclose any scenario not implemented; never fake success.
4. If a hard gate fails, repair it before adding breadth. A documented partial build is preferable to fabricated compliance, consistent with the assessment.
