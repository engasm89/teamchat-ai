# React UI scaffold — integration pending

Install React, Firebase and Vite dependencies once internet access is available: `cd apps/web && npm install`.

Populate `.env` from `.env.example` with the *web Firebase config* and deployed websocket URL. Never put service-account credentials in VITE_ variables.

`npm run dev` starts the web UI. It uses Firebase **Authentication only**, a single native WebSocket, initial-frame ID token, cursor-based replay commands, message client IDs and no database listeners or polling. The server component matching this protocol has not been deployed; do not claim full E2E coverage.

Future work: tenant-aware source cards, persisted unsent queue across refresh, AI streaming blocks, message pagination, presence/typing, actual browser integration tests, and disconnect/cold start recovery tests.
