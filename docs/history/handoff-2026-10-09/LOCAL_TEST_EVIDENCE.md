# Offline evidence and intentionally failing release gates

Snapshot: TeamChat final IDE handoff, based on v12, 2026-10-09.

- **115/115** `npm test` passed; 0 skipped, 0 failed.
- `npm run check`: **PASS** only after temporarily symlinking an **uncommitted** local `@types/node` from `/usr/local/slides_js/node_modules/@types/node`. The *pristine checkout* cannot typecheck until genuine npm dependencies are installed. Do not commit the symlink or call this a clean-install CI pass.
- `npm run verify:fixtures`: PASS. All five employer fixtures match original SHA256 and expected counts.
- `npm run seed:sql`: PASS; 2,753 fixture data INSERT statements generated.
- Browser TypeScript/TSX syntactic transpilation: PASS 6 source files; not a Vite bundle or semantic React typecheck.
- Client source scan: no obvious forbidden listener or polling found; network tab/actual browser inspection pending.
- `npm run verify:packaging`: **FAIL** due to missing genuine root/package-lock.json; web lock missing too.
- `npm run test:postgres:required`: **FAIL** because DATABASE_URL/authorized test UIDs/embedding model absent. 0 skipped, not a pass.
- `npm view ws version` network attempt: FAIL `EAI_AGAIN` DNS for registry.npmjs.org.
- Not performed: npm ci, web build, Docker build, live RLS, Firebase, actual Gemini, Cloud Tasks, two-instance real-time and complete demo.

All console evidence files are included under the ZIP's `qa_evidence/` directory. An IDE agent must rerun all tests after installing authentic dependencies and preserve timestamped production evidence.
