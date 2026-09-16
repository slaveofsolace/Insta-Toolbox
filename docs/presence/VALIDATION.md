# Presence scaffold validation

Date: September 16, 2026. Scope: the newly added planner, synthetic concept and isolated preview server. This record does not certify a live Instagram integration.

## Repository handling

The branch was created from PR #52's exact `sol/settings-dm-4.0` head `9e9bcb6c3ea62f0b6bd4c42076742987088097dd`. Existing files were inspected through the GitHub connector. New files were added through that connector. Main, the parent branch, the current tools, the generated userscript and release metadata were not edited by this scaffold.

## Local checks completed

| Check | Result | Qualification |
| --- | --- | --- |
| `node --test tests/presence.test.js` | 37 passed, 0 failed | Executed on Node 22.16.0 in a local workspace containing the new files. The actual repository requires Node 24; run the full declared environment before merge. |
| New JavaScript syntax | Passed | Core, tests, preview module and preview server. |
| Preview HTTP responses | Passed | `/` and `/src/core/presence.js` return 200; `/package.json` returns 404; an unrelated Host header returns 421. |
| Desktop fixture | Passed | Chromium 144.0.7559.96, 1440 x 1050. Routine editor, seven decision rows, plan generation, pause/resume and simulated completion. |
| Responsive fixture | Passed | 390 x 844, 320 x 640 and 768 x 500; no horizontal overflow. |
| Appearance | Reviewed | Light/dark screenshots after transition settlement; forced-colors rendering and reduced-motion transition suppression. These are concept screenshots, not accepted production overlay baselines. |
| Ghost dialog | Passed | Dialog opens/closes and returns focus to the initiating control. No Ghost executor exists in the experiment. |
| Storage denial | Passed | Read/save/reset failures are reported without claiming persistence succeeded. Successful persistence is not established by this fixture. |
| Runtime errors/external requests | None observed | Offline fixture only. No Instagram session was opened or changed. |

Focused core coverage includes normalization, malformed/prototype-backed data, version rejection, account provenance, stable identity, duplicate candidates/history, stale/future observations, private/unknown state, topic exclusions, protected/self/mutual accounts, pending requests, no repeat cycles, exact seven-day boundary, partial non-mutual uncertainty, active windows/DST, zero allowance and supplied usage, immutable plans, deterministic sorting, review-before-preview, pause/resume, Stop, account switch, expiry, Ghost separation and unavailable live capabilities.

## Browser test limitation

The browser plugin was not available. Regular Playwright with the installed Chromium was used. Normal loopback browser navigation returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` in this environment; the policy was not bypassed or changed.

A separate offline test harness therefore used `page.set_content`, injected the stylesheet, and flattened the module import/export boundary for fixture execution. The harness removed the CSP element only in its in-memory fixture; committed HTML retains its CSP. This validates the rendered concept and its local interactions, not the real ESM loading path, deployed CSP behavior, browser-origin storage or installed userscript.

The separate HTTP server was checked using a non-browser loopback client. HTTP 200 is not a substitute for normal-browser acceptance. Do not report the fixture as an installed extension, a Tampermonkey execution test, or an authenticated session.

## Full repository checks not claimed locally

A shell clone failed because github.com could not resolve from the working container. The GitHub connector remained usable. The local environment did not contain the current full repository, Node 24, or the locked pnpm dependency tree. Consequently no new claim is made here for the parent/full unit suite, generated parity, release hygiene, extension acceptance, real Chrome pairing, desktop packages or persistent-profile behavior.

The parent PR's reported 503 tests and screenshot results belong to the parent revision, not this scaffold's local run. The stacked PR's exact-commit Actions checks are the appropriate next full-environment evidence. Record their actual result separately; do not infer green CI from successful file creation.

## Required next acceptance

1. Run the full current repository suite with Node 24 and its locked dependencies.
2. Load the concept normally from the allowlisted server; verify ESM, CSP, keyboard paths and successful preference save/reload/reset.
3. Check true 200% zoom, screen-reader behavior, long labels, large candidate sets, interrupted export, storage quota/corruption and cross-tab preference changes.
4. Integrate through the existing overlay/batch interfaces with fresh account/target evidence, not through imported planning authority.
5. Test mode arbitration, persistence and browser lifecycle before enabling Presence/Ghost coexistence.
6. Obtain explicit approval for exact disposable targets before any native action acceptance.
7. Verify generated artifacts, installation/update and release gates only after production integration.

The committed concept and core contain no live account executor. Discovery, autonomous sessions, likes/comments/messages, background work and Ghost mutation handoff remain proposed or blocked integration lanes, not delivered functionality.
