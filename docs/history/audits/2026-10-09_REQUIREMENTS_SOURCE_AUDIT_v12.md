# TeamChat AI — v12 pre-live source audit (9 October 2026)

## Scope and honesty of evidence
Compared the employer's `ASSESSMENT.md` and all seven original assessment files against the v11 application and the previously submitted 6-page Technical Brief. All seven assessment source files remain byte-identical. This revision contains **source fixes and local tests, not a live deployment**. There is no proof of Cloud SQL RLS, Firebase or Gemini integration, Google Cloud Tasks delivery, or browser-to-browser propagation in real infrastructure.

## Reproduced source defects and v12 corrections

1. **Gemini model stream required but not consumed.** The v11 provider called `generateContent`, although the original story expects answers to appear progressively and the submitted brief promises reading the model stream. v12 uses the official `@google/genai` `generateContentStream` API, collects complete native function calls, discards unchecked text, checks call identity/arguments, rejects partial and conflicting calls, and persists source-backed blocks only after server-side tool execution. This deliberately does not publish unverified model tokens. Tests: `tests/native-gemini-stream.test.ts`. **Live model behavior still unverified**; validate configured model support, tool-call streaming and time-to-first-verified-block.
2. **Stale room data could reach browser event reducer.** v11 accepted event frames for a room no longer subscribed, including late delivery during room changes. v12 ignores frames for unsubscribed rooms and malformed events. Further defense-in-depth binds frames to the `tenantId` returned by the authenticated `/api/rooms` response, rejecting another tenant even if a room name overlaps. Server RLS remains the primary security boundary. Tests: `tests/browser-account-safety.test.ts`.
3. **Pending messages could remain in session storage after an implicit sign-out or socket owner cleanup.** `TeamSocket.close()` previously preserved durable local outbound storage unless an explicit boolean argument was given; an external Firebase sign-out can reach the hook cleanup path instead of the sign-out button. v12 makes close clear account-specific pending storage by default. Refresh/reconnect without intentional close still retains the bounded pending queue. Test: `tests/browser-account-safety.test.ts`.
4. **Punctuation-adjacent `@AI` wakeup failed.** The original regex only recognized start or preceding whitespace, so `(@AI)` and similar syntax did not create an AI turn. v12 recognizes punctuation boundaries without treating `support@ai.example` or `@AIsomething` as invocations. The wakeup *only starts* the AI job; native Gemini still chooses tools and is not routed by keyword. Test: `tests/ai-wakeup-detection.test.ts`.

## Local checks executed

- `npm run verify:prelive`: PASS, **111/111** Node tests; TypeScript backend, fixture hashes and repeatable SQL seed generation passed. `docs/evidence/v12_prelive_checks.log`.
- Frontend TypeScript/TSX syntax parse: PASS for all current source files. This is **not** a Vite production build; `docs/evidence/v12_frontend_parse.log`.
- Original employer files: **7/7 byte-identical**; `docs/evidence/v12_original_employer_hashes.log`.
- `verify:packaging`: FAIL, genuine npm lockfiles absent. `docs/evidence/v12_packaging_GATE_FAILED.log`.
- Required PostgreSQL test: FAIL, expected database and identity environment missing; `docs/evidence/v12_postgres_GATE_FAILED.log`.
- npm registry ping: network `EAI_AGAIN`, so **do not fabricate lockfiles or say npm ci succeeded**.

## Requirement-specific acceptance state

| Requirement / gate | v12 status |
|---|---|
| Phase 1 brief sent before application code | Confirmed via prior Gmail message, unchanged |
| Five fixture datasets and original assessment | Byte-identical, local validation PASS |
| Server-side per-tenant repositories and RLS definitions | Source implemented, **live PostgreSQL verification required** |
| Gemini native function calling | Source implemented, streaming invocation added; **live Vertex verification required** |
| Server-authoritative grounded codes and calculations | Offline tests PASS; real tool/answer walk-through outstanding |
| Memory saved across rooms with provenance, semantic retrieval | Source implemented; live embedding/backfill and cross-user proof outstanding |
| WebSocket ordered room replay, presence and typing | Source implemented; two-instance and two-browser test outstanding |
| No managed realtime listeners or browser polling | Source audit performed, network tab test outstanding |
| Required lockfiles / frontend production build | BLOCKED by npm registry and absent genuine lockfiles |
| Private Cloud Tasks worker, Firebase Auth, Cloud Run, Firebase Hosting | Source implemented, live proof outstanding |
| Seeded genuine model tool traces, 3 users per tenant, demo video | NOT produced or verified live |
| Public GitHub repository | NOT created or verified |

## Explicit design-note update to submitted Technical Brief

The implemented Gemini provider now consumes its native model stream, but **does not show unchecked text fragments**. The model's completed function calls are accumulated and validated, then the worker emits a succession of committed, source-backed tool records and answer blocks through the custom WebSocket event path. This retains the brief's factual grounding boundary. It may feel less token-by-token than an ordinary chat; confirm the reviewer UX with the real Vertex model.

## Release decision

**FAIL / DO NOT SUBMIT** until genuine dependency installation, the React production build, live Cloud SQL RLS isolation, Firebase revocation/token checks, Gemini/embedding tool execution, Cloud Tasks retry and outbox recovery, two-instance WebSocket reconnection, real AI seed history, public deployment, GitHub URL, reviewer credentials and five-minute demo are complete and observed. Never confuse local unit tests with live end-to-end acceptance.
