# Presence

Presence runs a small, reviewed Instagram session from the userscript.

## Development status

The 4.1.2 candidate exposes five choices:

- View stories
- React to stories
- Like posts
- Follow people
- Accept incoming requests

Choose the allowed activities and either run one session of 1 to 50 actions or
select **Live like me** for a reviewed 30-minute to 12-hour window. Live runs
remain finite, stop after at most 500 verified actions, and insert the selected
rest period after each bounded burst. One confirmation names the signed-in
account and exact choices. Pause, Resume, and Stop remain available while the
session runs.

This is a userscript-first development build. Deterministic browser fixtures
pass, but current authenticated Instagram compatibility still requires
disposable-target acceptance before release.

## Runtime behavior

Presence processes one exact target at a time. Before each click it checks:

- the signed-in account;
- the current restriction state;
- the unexpired session review;
- the selected activity;
- the exact visible Instagram target and control.

After each click it requires a matching Instagram state change. An uncertain
result stops the session and is not retried. Private-profile follows may finish
as **Requested** instead of **Following**. Story reactions automatically include
story viewing. A new story starts by opening one exact visible profile and then
its visible story control; Presence does not jump to a discovered story URL.

The current adapters use rendered Instagram controls. They do not call private
endpoints, collect credentials, bypass restrictions, spoof the browser, or run
after the tab has been closed. A target that cannot be resolved exactly is
skipped or stops the session; it is never guessed.

## Local data and authority

The selected activities, mode, and finite run choices are stored under
`instaToolboxPresenceSessionV1`. The confirmation and action authority are kept
only in the current runtime, are bound to the verified account and exact choice
set, and expire within 15 minutes. Reloading does not restore action authority.

Saved comparisons, imported files, old Presence preferences, screenshots, and
page messages cannot authorize a session. Verified results are copied into a
bounded per-account local activity log. The latest five appear in Presence;
**Open log window** opens a read-only resizable view with Download and Clear.
The log stores no message bodies, cookies, session data, or reusable authority.

## Implementation

| File | Responsibility |
| --- | --- |
| `extension/presence-session.js` | Finite session, runtime review, pacing, Pause/Resume/Stop, and verified results. |
| `extension/presence-native-actions.js` | Exact visible-DOM candidates and postconditions for the five activities. |
| `extension/presence-session-panel.js` | Compact choices, confirmation, progress, and controls. |
| `extension/presence-activity-log.js` | Bounded sanitized activity history and the separate read-only log window. |
| `userscripts/src/toolbox-shell.js` | Userscript integration and overlap prevention with other tools. |
| `tests/presence-session.test.js` | Controller, authority, interruption, and restriction coverage. |
| `scripts/lib/userscript-presence-acceptance.mjs` | Generated-userscript interaction and responsive browser acceptance. |

The earlier planner, synthetic preview, and their tests remain in the repository
as design research. They are not bundled into the userscript and do not appear
in the Presence tab. Their exports are data only and cannot authorize actions.

## Verification

```sh
node --test tests/presence-session.test.js
set INSTA_TOOLBOX_QA_USERSCRIPT_PRESENCE_ONLY=1&& node scripts\run-extension-acceptance.mjs
node scripts\run-extension-acceptance.mjs
pnpm test
```

Focused checks cover runtime-only authority, finite scope, Live like me bounds and rest periods, account binding,
expiry, replay rejection, Pause/Resume/Stop, restrictions, trusted confirmation
before the first click, all five activity paths, native navigation, local-log
sanitization and recovery, separate-window rendering, cancellation, narrow and
short layouts, light and dark themes, and true 200% zoom.

See [Production integration](PRODUCTION_INTEGRATION.md) for the exact acceptance
boundary and [Continuation brief](CODEX_HANDOFF.md) for the remaining work.

## Release boundary

Fixture success is not authenticated Instagram acceptance. Before release,
verify each activity against specifically approved disposable targets, connect
the existing account-level owner shared with Ghost, and prove that account
changes, restrictions, stale documents, background throttling, and uncertain
outcomes cannot start another action.

Presence does not promise follower growth, stealth, restriction avoidance, or
operation after the browser closes or the computer sleeps.
