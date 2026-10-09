# Requirements and assessment boundaries

## Employer scoring

| Area | Weight |
|---|---:|
| Technical brief: derived requirements, choices, cuts | 20% |
| Agent layer, grounding and business data | 25% |
| Multi-tenancy and isolation under attack | 25% |
| Real-time behavior | 20% |
| Code quality and tests | 10% |

Tenant isolation and grounding are explicitly pass/fail. Fake tool selection, forbidden listeners and cross-chain disclosure cannot be compensated for by UI quality.

## Mandatory stack

React/TypeScript client on Firebase Hosting; Firebase Auth identity; Node.js or Python server on Cloud Run; Vertex AI Gemini. The brief selects Node.js/TypeScript and PostgreSQL. Persistence and server fan-out are engineering choices, not prescribed Firebase database usage.

## Functional requirements

- Multiple authenticated users in rooms; consistent committed message order.
- Presence, typing and expiry after connection loss, including multiple tabs.
- Explicit `@AI` invocation; Gemini selects and executes one or more tools server-side.
- Both browsers see incremental validated output and persisted tool names, arguments, results and failures.
- Catalog natural-language/reverse lookup, separator normalization, abbreviations and multi-product questions.
- Empty lookup results remain empty; no plausible invented code.
- Store assortment/gaps, evidence, segment/channel/format coefficients, transitive class relationships and traceable arithmetic.
- Tenant-shared memory retrieval by meaning across users/rooms, with original author/date/source.
- New memory validates against a flat shape; invalid nesting produces actionable errors and a repair path.
- Concurrent AI turns remain separate or visibly queued.
- Duplicate sends create one message; refresh/disconnect resumes whole persisted turns and tool history.
- No client polling, listeners or repeating idle data fetches.
- State and memory survive backend restart/cold start.

## Actual fixture findings

| Input | Count | Interpretation |
|---|---:|---|
| product_codes.csv | 1,000 | 289 rows lack margin_class; do not fill those silently |
| promo_coefficients.csv | 44 | Segment-specific values; semicolon-separated supersedes edges |
| segment_coefficients.csv | 12 | channel + store_format + segment determine the coefficient |
| stores.json | 24 | 12 per chain; carried codes and suspected gap evidence |
| team_memory_seed.json | 8 | Four per chain; values are flat scalar objects |

Both tenants share some memory keys (not values), including q1_assortment_target. Store references checked in this review resolve to supplied catalog codes. Revalidate input bytes during seeding.

## Important ambiguities and assumptions

- Deadline updated to 16 October 2026; exact hour/timezone remains unconfirmed.
- Original GitHub evaluator handles are placeholders. The recorded email exchange says Ashraf will share a public repository. No secrets or passwords may be public.
- No financial baseline or aggregation formula is supplied. The brief's class score is an explicit assumption, not a vendor formula.
- seasonality only gives seasonal/year_round; do not infer calendar seasons.
- ST-4003 carries APP-100.11 (class 318) and APP-100.99 (unmapped), while gap evidence describes an unspecified-line assortment. Preserve and show this conflict.
- Progressive validated answer blocks, rather than unchecked raw tokens, are a declared design trade-off. Verify incremental updates happen before completion; do not claim the employer has approved this interpretation.

## Deliberately deferred

Uploads, rich text, direct messages, mobile app, administration console, SSO, billing product features, complete role hierarchy, live external catalog sources, autonomous purchasing and multi-region failover. Users/rooms are seeded. Clear source cards and pending/error states are required; decorative animation is optional.

## Gonzalo's recorded priorities

Scalable and modular architecture, clear separation of concerns, proper resource management, documentation and boundaries allowing several engineers to work independently. These are design/testing priorities; do not claim unlimited scale or absence of all memory leaks.
