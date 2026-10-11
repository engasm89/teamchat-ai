# Firebase Hosting reachability from the test machine (2026-10-11)

## Why this was investigated

Two full browser runs (`20261011T165137Z-browser-a4dff6`, `20261011T170110Z-browser-b3f6ef`)
each lost `NEG-S16-DUP` before the test body ran: `page.goto` on
`https://focus-clean-4b9f4.web.app/` timed out (30 s), and in the second run an
immediate retry failed with `net::ERR_TIMED_OUT`. Both runs are kept as published
evidence with those failures.

## Observations

| Probe | Result |
| --- | --- |
| 8 Chromium navigations right after run 1 | first 4 hung 30 s on the HTML document itself, next 4 loaded in 0.8–2.7 s |
| 16 Chromium navigations a few minutes later, with and without `--disable-quic` | all loaded over HTTP/2 in 0.9–2.4 s (QUIC ruled out) |
| `curl -4` / `curl -6`, 6 rounds | all 200; occasional 1 s connect spikes |
| `hosting-reachability-monitor.mjs` (output: `hosting-reachability-monitor.txt`), 17:07–17:15 UTC, curl every ~2 s plus Chromium every ~3rd tick | Hosting: 9 of 132 samples could not even open TCP (curl exit 28, `time_connect` 0), one continuous outage 17:07:25–17:08:42 and isolated failures at 17:09:54 and 17:11:54. Cloud Run API: 132 of 132 healthy |

During 17:07–17:15 the only test traffic was a scratch run of the two S16
controls (which could not load the page) and two scratch gate runs (no traffic
to Hosting). The outage therefore is not caused by the browser tests' own load
on Hosting.

## Conclusion

From this network, TCP connections to the Firebase Hosting anycast address
(199.36.158.100) are intermittently blackholed for up to about three minutes,
while the Cloud Run API on other Google addresses stays reachable. The cause
(local network, ISP or edge) was not determined. It affects only page loads in
the test harness; the WebSocket and API paths under test are unaffected.

## Harness consequence

`scripts/acceptance/browser/run-browser.ts` retries a page load up to three
times (15 s, 45 s, 90 s apart) and writes every attempt to `navigation.json` in
each run directory. Assertions are unchanged.
