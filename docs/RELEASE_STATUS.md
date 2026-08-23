# Release status

Current version: **2.0.2 release candidate**

## Available tools

### Mutual Checker

- Imports Instagram relationship exports and supported legacy formats.
- Resolves a user-entered or locally detected username and loads Followers and
  Following through bounded, authenticated Instagram pagination.
- Gives each page request and JSON decode a 20-second watchdog, retries a
  stalled page twice with visible bounded backoff, and preserves the prior
  comparison if the new read cannot finish.
- Keeps the exact-dialog scanner as an Advanced fallback without mixing its
  rows with authenticated results from another username.
- Reports mutuals, accounts that do not follow back, and accounts the user does
  not follow back.
- Filters any comparison group by captured username or display name, locally.
- Downloads a readable UTF-8 comparison report; the schema-1 JSON export remains
  available under Advanced for machine use.
- Does not need live-action permission.

### Follow / Unfollow

- Builds a fixed review list before a run can start.
- Supports true dry runs that do not activate Instagram controls.
- Shows only sources compatible with the selected Follow or Unfollow action,
  then names exact targets, duplicates, already-correct relationships, and
  protected/skipped reasons before one finite confirmation.
- Mints a non-persistent capability bound to the confirmed target list; it is
  revoked on completion, Stop, expiry, challenge, block, rate limit, or an
  unexpected profile state.
- Extension live jobs are limited to one reviewed account, with signed intent,
  exact profile matching, independent reservations, and post-action checks.
- No account action starts without its exact run confirmation.

### DM Unsend

- Identifies messages sent by the current user in an exact conversation.
- Supports read-only inspection and no-click dry runs.
- The signed extension path is limited to one reviewed message with stable
  thread and message identity.
- The userscript and extension always show **Unsend DMs**. It confirms the open
  conversation once, then uses one streaming pass; it does not repeat a full
  history scan before opening the first exact message menu.
- All messages is the default. Newest/oldest finite scopes remain under Advanced.
- Each thread plan remains bound to the exact thread, scope, reviewed digest,
  expiry, and pacing. Optional checks report a detected minimum because
  Instagram virtualizes rendered message rows.
- No Unsend starts without its exact thread/scope confirmation.

## Delivery formats

- **Tampermonkey userscript:** one-file Instagram overlay with all three tools.
- **Chrome extension:** Manifest V3 overlay plus optional signed pairing with
  the PWA.
- **PWA:** local imports, comparisons, message search, reviewed jobs, and
  activity history.
- **Desktop:** Electron packaging for Windows and macOS.

All imported data and local run state remain on the user's machine. The project
does not require an application account or hosted data service.

Fresh extension installs show a compact three-tool walkthrough the first time
the launcher is opened. Migrated profiles keep their prior view and are not
shown the walkthrough again.

## Automated verification

The repository includes checks for:

- deterministic PWA assembly;
- extension and userscript build reproducibility;
- import, migration, archive, and data-contract behavior;
- no-click action and DM paths;
- target matching, replay rejection, expiry, duplicate prevention, and safe
  stops;
- extension permissions and signed pairing;
- production content-script acceptance against synthetic Instagram fixtures;
- exact fixed-route Followers/Following pagination, username resolution,
  request allowlisting, bounded stops, rate-limit handling, and atomic replacement;
- exact Followers/Following dialog fallback binding, including quarantine and
  clean replacement of captures made by older fallback logic;
- exact profile-total reconciliation, so a stable scroll boundary cannot be
  called complete when Instagram reports a different row count;
- one-pass DM traversal across virtualized rows without treating a mounted
  window as the conversation total;
- capture-confidence migration to schema 5, which preserves older local rows,
  records authenticated-web versus list-dialog provenance, and requires a new
  reconciled scan before stale rows can drive comparisons or reviewed runs;
- PWA and overlay screenshot baselines;
- desktop package smoke tests in CI.

The final local Windows matrix count and artifact hashes are refreshed for each
release candidate after the generated userscript and extension have been rebuilt.
Windows installers remain intentionally unsigned.

### 2.0.2 candidate status

- Restores the source-audited single-pass DM traversal and 1–2 second default
  pacing while retaining exact-thread, sent-by-me, menu, confirmation, Stop,
  and postcondition checks.
- Removes the virtualized mounted-row equality gate that could stop with zero
  removals after confirmation.
- Compacts the in-page header and replaces the old status footer with the
  unobtrusive creator credit.
- Updates MIT attribution, embeds the full MIT notice in the userscript, and
  includes `LICENSE` plus `THIRD_PARTY_NOTICES.md` in the extension, desktop,
  release archives, and offline PWA cache.
- Removes the Mutual Checker's former 500-account reconciliation cutoff. One
  bounded restart now also recovers a prematurely cursorless large-account
  response; a 2,104-follower regression and exhausted-retry case cover the
  reported failure without adding an unbounded loop.
- Full local suite: **287/287** passing after the confirmation and finite-oldest
  repairs, including dependency verification, repository hygiene, generated
  parity, migrations, virtualized DM traversal, bounded capabilities, and safe
  stops.
- Extension/userscript acceptance: production Follow, Unfollow, and
  one-message Unsend fixture chains; exact newest/oldest ordering; delayed
  oldest-history growth after normal and reversed scroller replacement; Stop
  after one verified removal; a six-message thread-wide run; keyboard and
  accessibility-tree checks; and six responsive layouts all passed in isolated
  Chromium. Synthetic confirmation clicks produced zero reservations, runner
  starts, Instagram fixture clicks, or removals; trusted browser input was
  required for the affirmative path.
- Visual and browser gates: **45/45** reviewed Windows overlay states, **11/11**
  reviewed Windows PWA baselines, and real Chrome PWA installability plus
  extension pairing passed. Confirmation-open coverage includes narrow panels,
  mobile, and true 200-percent Chromium zoom with Cancel focused first.
- Repository hygiene, dependency audit, generated-source checks, and
  `git diff --check` passed. The final source-level security audit found a
  synthetic-click authorization path and a post-replacement finite-ordering
  defect. Both were repaired and regression-tested before this matrix; no
  reportable finding remains in the corrected local patch.
- The corrected code candidate passed all five GitHub CI jobs at
  [run 32671168068](https://github.com/slaveofsolace/Insta-AIO-Tool/actions/runs/32671168068),
  for `fb9e4fcb18cf2871e2305d3841bc8314f73f179d`: tests, Chrome pairing,
  reviewed Windows rendering, Windows NSIS lifecycle, macOS DMG/ZIP lifecycle,
  and combined release checksums.
- Corrected CI artifact SHA-256 values:
  - `insta-aio-companion.user.js`:
    `f4972b14db2014df8dcf315d6e0ec9a7d1396b704ea779b733e15f1debe7b864`
  - `insta-aio-companion-2.0.2.zip`:
    `17e330958b166b5f4f6010b6c997fa0af5f5fc02c4ad4f985bf7dbbffeb01535`
  - `Insta Toolbox Setup 2.0.2.exe`:
    `2a0a1dcf43350758f87f5c283b88df01078d1e3675365191544e694bfa0ce310`
  - `Insta Toolbox Setup 2.0.2.exe.blockmap`:
    `8bbfda0446500e13b8618b21a4964b4bd85f9c49a166bbd0e3d8bf2eeebfeb66`
  - `Insta Toolbox-2.0.2-arm64-mac.zip`:
    `6fa7706ff399a0d09f0f002796ab312964b2b9254d1322390a26107222596d67`
  - `Insta Toolbox-2.0.2-arm64.dmg`:
    `d85d5af1880e417841c9fe4ab91aa0b2fa8c5bc1c8cf14e999016298d777fda8`
- The commit-pinned Tampermonkey build was installed in authenticated Chrome.
  The live overlay showed the compact header and credit line with the old mode
  pill and status footer absent.
- Authenticated acceptance exposed a release-blocking native-dialog hazard: a
  browser-control click timed out at `window.confirm`, but the dialog was then
  accepted outside the requested flow and Unsend started. Stop ended the run
  after 72 verified removals. All Instagram automation was stopped afterward.
- The replacement in-overlay confirmation is implemented and passes local
  trusted-input, synthetic-click rejection, accessibility, zoom, and fixture
  action coverage. Release still requires exact-head CI, installation of the
  corrected commit-pinned userscript, and separately authorized
  disposable-message reacceptance. No further authenticated action has been
  performed.
- Final corrected local artifact SHA-256 values:
  - `insta-aio-companion.user.js`:
    `f4972b14db2014df8dcf315d6e0ec9a7d1396b704ea779b733e15f1debe7b864`
  - `insta-aio-companion-2.0.2.zip`:
    `a153991ffa2f82f0689c98de23dcd6e2d9d18fe0cf4bbc6a85c9f7034057088f`
  - `Insta Toolbox Setup 2.0.2.exe`:
    `c7d5dfc53d671e6f1c17fa567cee29c4317fdae9bad36a544f2142c48c1534a8`
  - `Insta Toolbox Setup 2.0.2.exe.blockmap`:
    `f1b7c15dcf0e34c9f9542663ff0d7e8b16b6c64e8829d776c8883d81a340e97d`

### Prior 2.0.1 main-branch userscript hotfix evidence (2026-08-22)

- Full test matrix: **259/259** passing, including dependency verification,
  repository hygiene, extension reproducibility, userscript parity, migrations,
  finite capabilities, no-click paths, retry watchdogs, and safe stops.
- Controlled extension build subset: **26/26** passing before packaging.
- Extension/userscript fixture acceptance: production Follow, Unfollow, and
  one-message Unsend DOM chains; keyboard/accessibility-tree checks; five
  toolbox viewports; a six-message thread-bound Unsend; the userscript's full
  scan, confirmation, reservation, runner-start, and one-message Unsend path;
  PWA installability; and default read-only pairing all accepted in isolated
  Chromium.
- Fixes the 2.0.0 userscript exception that occurred immediately after the
  exact-thread Unsend confirmation and makes asynchronous action failures
  visible in the toolbox status area.
- `userscripts/insta-aio-companion.user.js` SHA-256:
  `f137388d831ac4b068bb6c040d545a0d882e501726b747ffe73101e4f30ba5e6`
- `dist/insta-aio-companion-2.0.1.zip` SHA-256:
  `97b1bda9f8a607155a8acbf20aeb6025600ea0c466215c7a495cf64a300dab6d`

### Prior 2.0.0 release evidence

- Google Chrome pairing acceptance: PWA installability and the real unpacked
  extension paired successfully with action permission off and no global live
  unlock controls.
- Visual regression gates: **9/9** reviewed Windows PWA baselines and **43/43**
  reviewed Windows overlay states, including mobile, short-laptop, forced-color,
  translucent floating, and 200-percent zoom cases.
- Windows NSIS packaging completed for the intentionally unsigned installer.
  Native macOS lifecycle acceptance remains CI-only from this Windows host.
- A prior 2.0.0 candidate passed all four GitHub Actions lanes. The release PR
  must repeat core, Chrome, Windows, and macOS checks on its exact final head.

Prior 2.0.0 release artifact SHA-256 values:

- `userscripts/insta-aio-companion.user.js` —
  `8f28d0a2f639685702c65e8d00b528803c2b4a59630aea236bb9c967a8d03acd`
- `dist/insta-aio-companion-2.0.0.zip` —
  `b3c7b68a3154a57760578f381a54fd7a2283ae629028a68b5a81de5498a06666`
- `dist/desktop/Insta Toolbox Setup 2.0.0.exe` —
  `ee1c75cd25d2d01d772debb56f209afeb239c04fee1c8480118b48c9e904af3a`
- `dist/desktop/Insta Toolbox Setup 2.0.0.exe.blockmap` —
  `121a44740cbbc0da431ee8277e0e667a800d3438269e3b3371697231ad95512a`

Exact commands are documented in [Overlay QA](./OVERLAY_QA.md),
[Browser QA](./BROWSER_QA.md), and the [Maintainer guide](./MAINTAINER_GUIDE.md).

## Manual release checks

These checks require the operator's browser, account, credentials, or judgment
and are not automated:

- install the current userscript or unpacked extension in the intended Chrome
  profile;
- confirm the overlay on current Instagram profile, list, and conversation
  routes, canceling at every exact destructive confirmation;
- complete a human screen-reader walkthrough;
- verify persistent-profile PWA pairing;
- sign and notarize macOS packages for public distribution;
- if desired, authorize and observe a single real Instagram action against an
  explicitly selected target.

Automated fixture results do not establish current authenticated Instagram
selector compatibility. No live Instagram action is part of the default test or
build process.

## Supporting records

- [Source audit](./SOURCE_AUDIT.md)
- [Component integration audit](./COMPONENT_INTEGRATION_AUDIT.md)
- [Component migration report](./COMPONENT_MIGRATION_REPORT.md)
- [Security review](./SECURITY_REVIEW.md)
- [Operator acceptance runbook](./OPERATOR_ACCEPTANCE.md)
