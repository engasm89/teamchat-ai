# WebSocket fault-injection experiments (2026-10-11)

Run against the live Hosting app and Cloud Run API with Playwright 1.64.0 /
Chromium 1248. Raw output sits beside this file; the scripts are in
`scripts/experiments/`.

## Questions and results

| Question | Result |
| --- | --- |
| Does `context.setOffline(true)` close an open WebSocket? | **No.** Socket stayed open for 20 s, status stayed `online`, no reconnect (`websocket-faults.json` → `setOffline`). |
| Does CDP `Network.emulateNetworkConditions {offline:true}` (what DevTools "Offline" uses) close it? | **No.** Same as above (`cdpOffline`). |
| Do those mechanisms flip `navigator.onLine` and fire `offline`/`online` events? | **Yes**, both (`online-events.json`). |
| Can `page.routeWebSocket` proxy the live socket and inject faults? | **Yes.** Duplicated frame rendered once; dropped frame was recovered by the client's gap replay; a forced close (code 4000) produced `reconnecting` → `online` and later messages arrived (`websocket-faults.json` → `routeWebSocket`). |

## Consequences

1. The earlier S16 evidence (`scripts/browser-e2e-evidence.ts`, cited in
   `docs/FINAL_GO_NO_GO_REPORT.md`) used `setOffline` and therefore never
   disconnected the socket. That evidence is void.
2. A reviewer toggling DevTools "Offline" sees the same thing: messages keep
   arriving and nothing is lost, because nothing was disconnected. The app
   ignores `offline`/`online` events, so it cannot honour the simulation.
3. The browser client has no liveness check of its own. The server sends
   protocol pings every 25 s, but browsers answer pings invisibly, so a
   silently dead link is only noticed when TCP gives up.
4. Fault injection for S16 and the negative controls uses `routeWebSocket`:
   close the proxied socket and refuse reconnects for the outage window, drop
   or duplicate frames, and suppress replay requests where a control needs
   the client's recovery to be defeated.
