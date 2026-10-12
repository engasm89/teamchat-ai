# Agent instructions: TeamChat AI

## Objective

Build the application described by the employer assessment and the submitted brief, with a deployed, reproducible result by 16 October 2026. Preserve tenant isolation and source-backed AI behavior ahead of feature breadth or visual polish.

## Before application coding

- Read every file in this pack and the five supplied fixtures.
- Technical brief submission is VERIFIED: Gmail sent item `1a11cb0c10ca3fc6` on 8 October 2026 with six-page PDF. Inspect existing repository to establish application code commit chronology before treating G01 as a proven pass.
- Inventory actual tools, repository, GCP identity, project, billing, APIs and credentials. Never claim availability from an assumption.
- Use the agreed architecture; do not restart open-ended brainstorming. Surface a material contradiction and record the resolution.

## Non-negotiable rules

1. Use React + TypeScript, Firebase Auth, Vertex AI Gemini, Cloud Run and Firebase Hosting.
2. Build a custom server real-time transport. No client DB listeners, managed live-sync transport, polling, or Socket.IO polling fallback.
3. Gemini chooses business tools through native function calling. No regex/keyword intent router, mock model disguised as live, or prewritten AI histories presented as real executions.
4. Every protected access has server-derived tenant context. Tool arguments and saved notes cannot change authority. Foreign and nonexistent resources expose the same no-match response.
5. User-visible business facts resolve to records retrieved for that turn. Never broadcast unchecked model facts.
6. Persist committed state before acknowledgement/broadcast. Network delivery is at least once; deduplicate at the recipient.
7. Do not invent formula semantics, revenue, season calendars, missing classes, authors or dates. Distinguish assumptions, user inputs and source data.
8. No secrets, access tokens, test passwords or service-account key files in public commits or logs. Use runtime credentials and Secret Manager where appropriate.
9. Never send recruiting emails, submit the assessment, grant collaborators access or publish credentials without explicit authorization for that action. Do not assume this documentation request authorizes paid provisioning or account changes. Prepare concrete plans and report any access/cost blocker.
10. Do not mark PASS without saved evidence. Mocked tests may support unit correctness but cannot prove live Gemini, real cloud deployment or multi-instance behavior.

## Working method

- Inspect existing work first; continue instead of rebuilding.
- Make small coherent commits once the actual repository is configured. Keep the dependency lockfile.
- Define command/event schemas before implementing consumers. Own migrations by module; review integration order.
- Add meaningful tests for authorization, grounding, arithmetic and recovery. Test with the actual restricted database role, not only a privileged test connection.
- Keep model calls outside long-running database transactions. Short transactions persist plans/results and publish wake-ups.
- Separate unit tests, integration tests, emulator tests and live-cloud checks in reports.
- Debug root causes before changing constraints. Do not weaken isolation or grounding to pass a demo.
- Update status with changed files, actual commands, results, blockers and one next action.
- On a blocker, complete independent authorized local work and report precisely what is missing. Do not silently replace GCP with another platform.
- Use subagents only when explicitly authorized or required by an applicable skill; otherwise work sequentially.

## Definition of done

All employer hard gates are demonstrated; original evaluation scenarios are exercised; required deliverables exist; known limitations are disclosed; a reviewer can trace one AI turn from authentication through persisted source records to rendered answer. See `03_ACCEPTANCE.md`. No agent can guarantee an offer or the employer's final score.

## Copyable continuation prompt

> Continue TeamChat AI for Ashraf. Read 00_START_HERE.md, AGENTS.md, ORIGINAL_ASSESSMENT.md, BRIEF_REFERENCE.md and all numbered files. Inspect actual repository and status before editing. Confirm brief submission before application coding. Work through the earliest incomplete milestone. Use the exact mandatory GCP stack, native Gemini tool selection, tenant-scoped storage and custom WebSockets. Keep facts source-backed, publish only validated output, and preserve ordering/recovery across two instances. Verify with meaningful tests and save evidence against the acceptance IDs. Do not send emails, invent access, spend on unapproved resources, or label unrun checks as passed. Update 06_STATUS_AND_HANDOFF.md with the real state and the next concrete action. Complete independent authorized work until finished or genuinely blocked.
