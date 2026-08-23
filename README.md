# Insta Toolbox

Mutual checks, account actions, and DM cleanup, directly on Instagram and stored on your own machine:

- **Mutual Checker** — see who doesn't follow you back, who you don't follow back, and who's mutual.
- **Follow / Unfollow** — work through a list of accounts one at a time, or let the batch runner pace it for you.
- **DM Unsend** — find the messages *you* sent in a conversation and remove them, one or many.

There is no Insta Toolbox account or hosted data service. Imported exports and saved
results stay in local browser storage until you export them. The in-page follower
checker makes read-only, same-origin requests to Instagram using the session
already open in that tab; it never reads, stores, or exports the session value.

## Which version should I install?

| | What you get | Best for |
|---|---|---|
| **Userscript** (Tampermonkey) | All three tools, including live Follow, Unfollow, and Unsend with paced batch runs. | Fastest start — one click, no build step. |
| **Browser extension** | The same tools, plus pairing with the app for signed, recorded jobs. | Anyone who also uses the app workspace. |
| **Desktop app** | The full workspace in an installed Windows or macOS app. | A ready-made local app for exported data. |
| **Web / PWA** | The same workspace as a static web package with offline support. | Browser use or self-hosting over HTTPS/localhost. |

The userscript is generated from the extension's Instagram code, so fixes to
scanning and page controls apply to both.

## Download or install

The 2.0.2 files below appear together when the release is published. If GitHub
still shows an older release, use the commit-named CI artifacts only for review;
do not mix files from different builds.

- **Instagram overlay:** [install the Tampermonkey userscript](https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js),
  reload Instagram, then press **Alt + Shift + I**.
- **Windows 64-bit:** open the [latest release](https://github.com/slaveofsolace/Insta-AIO-Tool/releases/latest),
  download `Insta Toolbox Setup 2.0.2.exe`, and follow the short installer.
- **macOS Apple Silicon:** open the [latest release](https://github.com/slaveofsolace/Insta-AIO-Tool/releases/latest),
  download `Insta Toolbox-2.0.2-arm64.dmg`, then drag the app to Applications.
- **Web/PWA package:** download `insta-toolbox-web-2.0.2.zip` from the latest
  release. It is ready for static hosting over HTTPS or localhost; it is not a
  double-click app.
- **Chrome extension:** download `insta-aio-companion-2.0.2.zip`, extract it,
  then choose **Extensions → Developer mode → Load unpacked** and select the
  extracted folder.

The desktop packages are not publicly code-signed. Windows SmartScreen or
macOS Gatekeeper may warn. Verify the matching SHA-256 value in
`SHA256SUMS.txt` before opening a download. The macOS build is currently for
Apple Silicon; an Intel build and Apple notarization are not included.

See [Installation](./docs/INSTALLATION.md) for full steps, troubleshooting,
upgrades, and source builds.

<details>
<summary>Full feature list</summary>

- An installable progressive web app with offline support
- Direct, local Instagram ZIP import with a reviewed manifest
- Relationship snapshots, comparisons, protections, and queue history
- Message search, sent-message classification, and reviewed unsend jobs
- Migrations for Instagram Helper, SimpleInstaBot, and saved follower-checker results
- A visible Instagram panel for capture, queue work, and message evidence
- A signed, origin-paired Manifest V3 extension bridge
- A self-contained Tampermonkey userscript that injects all three tools on Instagram
- Windows and macOS desktop packaging

</details>

## Safety model

Scans and dry runs never open an Instagram action control. Follow, Unfollow, and
DM Unsend each require one confirmation for the exact account or conversation.
The resulting capability stays in memory, expires, and is revoked by Stop or any
Instagram warning.

DM Unsend works through one conversation in a single pass. **All** is the
default; **newest N** and **oldest N** are available under Advanced. Instagram
recycles rendered message rows, so the optional read-only check reports only
what it detected—not a made-up total. Every message is rechecked as sent by the
current account before its newly opened Unsend menu and confirmation are used.

The signed PWA path adds stricter one-item controls. A live Follow or Unfollow
requires a fresh signed batch of exactly one item, action permission, one exact
profile/action confirmation, a transient one-use capability, PWA and
extension-side durable reservations, a relationship control inside a verified
profile header, a newly created target-named Unfollow dialog when needed, and
post-action relationship verification. A live Unsend additionally requires a
fresh exact thread/message confirmation for one sent message,
thread/message/timestamp/content-digest/ownership binding, independent PWA and
extension reservations, a one-use rendered-message token, structurally bound
interactive menu/dialog controls, and exact-message removal proof while stable
identity coverage remains available. DOM resolution tokens are issued only by
Web Crypto; if neither `randomUUID` nor `getRandomValues` produces entropy,
inspection returns `secure-random-unavailable` and no capability is stored.

The project does not implement proxy rotation, fingerprint spoofing, challenge bypass, CAPTCHA solving, arbitrary endpoint discovery, mutation-capable endpoint clients, or unreviewed destructive actions.

Insta Toolbox is an independent project and is not affiliated with or endorsed
by Instagram or Meta. Operators are responsible for protecting imported data
and complying with the rules that apply to their accounts and environment.

## Requirements

- Node.js 22.12.0 or newer
- Corepack with pnpm 11.9.0, as pinned in `package.json`
- A modern Chromium-based browser for the PWA
- Windows for producing the NSIS installer
- macOS for producing and validating DMG/ZIP releases

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run assemble
pnpm test
pnpm run serve
```

`pnpm run serve` prints the local address to open in your browser. It listens on
your own machine only and is not reachable from your network.

`pnpm run assemble` rebuilds the audit copy at `src/app.js` from the committed UI
fragments. The browser runtime loads those fragments through `src/app-loader.js`,
so the generated audit copy is not required to open the PWA.

## Import workflow

1. Request a JSON export from Instagram Accounts Center.
2. In **Import / Export**, select the original ZIP.
3. Review the detected paths, file types, expanded sizes, and archive warnings.
4. Confirm the local import.
5. Choose the active relationship snapshot and review comparisons.

Extracted JSON files and folders remain supported as a fallback. Recognized data includes:

- `followers_*.json` and `following*.json`
- Meta `message_*.json` conversation exports
- Instagram Helper `allMessagesItemsArray` data
- SimpleInstaBot followed/unfollowed history
- Saved follower-checker result objects
- Insta Toolbox workspace and snapshot exports

Encrypted archives, unsafe paths, unsupported ZIP variants, integrity errors, and configured size-limit violations are rejected before data is committed.

## Relationship review

The Relationships view identifies mutuals, non-mutual relationships, new followers, detected unfollowers, following changes, and ID-backed username changes.

The queue protects:

- Whitelisted usernames
- Accounts followed before the tool was adopted
- Mutual followers when mutual protection is enabled
- Migration-only history records
- Duplicate or already-completed actions

Follow items enter a configurable waiting period before an unfollow review can become ready.

## Reviewed action jobs

Queue records must be selected explicitly. A preview lists the exact username,
action, duplicates, protected/skipped reasons, and remaining targets for every
finite run. Starting requires one ordinary exact action/target/count confirmation.

Dry runs inspect the current profile without clicking. The adapter safe-stops on
the wrong profile, an unverified profile header, ambiguous controls, any
pre-existing dialog, an unbound Unfollow dialog, session expiry, challenges,
rate limits, action blocks, changed protection state, stale confirmation, or a
missing/expired finite capability. The PWA ledger and the extension's bounded
mirror reserve before the isolated driver call and prevent duplicate or
out-of-plan execution.

The signed PWA workflow remains limited to one reviewed item. It requires one
ordinary confirmation naming the exact account action or sent message, then
uses a short-lived in-memory capability and durable reservation. The capability
is consumed before page control, and the result is recorded as succeeded or
uncertain. Authenticated selector acceptance is still required before issues #3
and #4 can close.

## Reviewed DM jobs

Only messages classified as sent by the configured owner can enter a reviewed
Unsend job. Each item keeps its conversation ID, message ID, timestamp, sender
ownership, and content digest.

The signed one-message path requires a reviewed digest, one ordinary
confirmation naming the thread and message, exact re-resolution, a durable
reservation, and verified removal. Its no-click check succeeds only when the
open thread and one rendered sent row expose every reviewed identity field.
Missing or duplicate candidates, changed content, unknown ownership, a wrong
thread, pre-existing controls, or an uncertain postcondition stop the run.
Authenticated Instagram action acceptance remains pending, so issue #4 is not
closed.

## Companion extension

Build the extension:

```bash
pnpm run build:extension
```

Load `dist/extension` as an unpacked extension. If you downloaded the generated
ZIP, extract it first, then select the extracted folder with **Load unpacked**;
the ZIP is not a Chrome Web Store package.

Open Instagram after loading the extension. A compact **Toolbox** launcher appears
on the right by default; the full overlay opens only when the operator requests
it. On desktop, drag its header to move it, drag the lower-right handle to resize it, and
use **Settings → Surface transparency** to choose 55–100% opacity. Reset restores
the bounded default. On narrow screens it becomes a fitted bottom sheet. It
provides:

- Current-page session, profile, relationship, and queue-match inspection
- One-step authenticated Followers + Following pagination with username autofill/input and a local comparison; list-dialog scanning remains an Advanced fallback
- A review-first account queue that freezes the exact targets before Start becomes available
- Sanitized history for signed account/DM dry runs and controlled one-item results received from the PWA
- Instagram-side transient one-use capabilities for a freshly confirmed signed one-item Follow, Unfollow, or exact sent-message Unsend intent
- Read-only visible-message evidence plus conditional exact-identity DM dry runs that never open a menu
- A direct link back to the exact paired PWA origin

Press **Alt + Shift + I** to toggle the sidecar.

### Tools on Instagram

The sidecar carries the three tools in one place, each on its own tab.

**Mutual Checker.** Confirm the username and choose **Check Followers +
Following**. The shared extension/userscript engine resolves that exact account,
loads both paginated lists through Instagram's authenticated web interface, and
replaces the prior comparison only after both reads finish. It sends no request
outside `www.instagram.com`, never reads or exports cookies, and activates no
page control. The result browser switches among mutuals and both non-mutual
groups and filters locally. If Instagram changes or rejects the read interface,
the Advanced section retains the older exact-dialog scanner as a fallback.

**Follow / Unfollow.** In the Follow / Unfollow tab, choose **Follow people**
or **Unfollow people**, then pick one of the compatible current-profile, checker,
scanned-list, or queue sources. Choose the explicit **Review N Follow targets**
or **Review N Unfollow targets** action to freeze and inspect the exact targets,
duplicates, already-correct relationships, protected/skipped reasons, and
omissions. **Start** appears only while that review still matches the controls.
Each target is opened, re-verified, and acted on one at a time. **Complete** and
**Skip** remain available under the secondary options disclosure.

**DM Unsend.** Open a conversation and choose the always-visible **Unsend DMs**
button. One confirmation names the exact open thread and selected scope, then a
single streaming traversal begins immediately. The default scope is all
messages you sent; `newest N` and `oldest N` are under Advanced. The transient
plan is checked before every page control, only rows proven sent by the current
account are eligible, and each verified removal is recorded as it happens.
**Check conversation** is an optional read-only diagnostic and its mounted-row
estimate is never treated as the conversation total. Cancel changes nothing.
Unsending is permanent.

### Batch pacing and safety

Batch runs reuse the audited one-item path: each item still runs a complete
inspect, exact-resolution, reserve, act, and record cycle. One finite capability
is bound to the confirmed target list, consumed by that run, and cannot be
replayed or widened.

- Configurable random delays under **Settings → Batch pacing**, with a
  1.5-second minimum and a longer rest every 20 items
- The whole run stops on the first rate limit, checkpoint, block, session
  expiry, or unexpected screen
- A target whose relationship no longer matches is skipped, not forced
- **Stop** aborts before the next item

Automated following and bulk activity can trigger Instagram restrictions.

See
[Instagram sidecar](./docs/INSTAGRAM_SIDECAR.md)
for the runtime and data boundaries and
[Overlay UI implementation](./docs/OVERLAY_UI_IMPLEMENTATION.md) for the
module and migration status. The dedicated screenshot/state matrix, baseline
workflow, and manual acceptance limits are documented in
[Overlay QA](./docs/OVERLAY_QA.md).

Pairing is origin-specific:

1. In the PWA Settings view, create a one-time pairing code.
2. Open the extension popup on the exact PWA origin.
3. Choose read-only access or reviewed dry-run transfer.
4. Paste the code and pair the origin.
5. Return to the PWA and complete the handshake.

The handshake rotates the one-time code into a derived session secret. Messages are signed, time-limited, origin-bound, permission-checked, and protected against nonce replay. Payloads containing session or authorization material are rejected.

## Tampermonkey companion

Install `userscripts/insta-aio-companion.user.js` in Tampermonkey.

The generated script injects a movable, lower-right-resizable, translucent
three-tab toolbox directly on `instagram.com`. It includes the authenticated,
paginated Mutual Checker plus a list-dialog fallback and local comparison, queue and checker target sources for paced Follow
or Unfollow runs, and the source-audited thread-wide DM Unsend runner. It uses the
same exact-target Instagram engine as the extension and remains self-contained:
no remote `@require`, third-party network connector, credential access, or cloud
storage. The checker sends only fixed read-only requests to `www.instagram.com`
with browser-managed credentials; it cannot read or export those credentials.
It explicitly requests the userscript manager's isolated DOM sandbox.
Resumable account runs use `GM_getTab`/`GM_saveTab`, so another Instagram tab
cannot inherit a running batch. Tampermonkey is the supported manager; on a
manager without those tab APIs, follower scanning, comparison, and no-click
checks remain available but account batch execution stays disabled.

Each reviewed account run asks once
for its exact action, target list, and count, then mints a finite capability for
that run only. There is no global switch, arm control, or authorization phrase.
The capability expires during a run and is checked before every later item;
account navigation retains only the already-confirmed run and its expiry in the
same manager tab. Thread-wide Unsend separately binds its finite plan to the
current thread and rejects navigation, expired authority, pre-existing menu
decoys, and ambiguous newly opened controls. The
Mutual Checker, exported comparisons, visible-message scan, and exact no-click
checks need no action confirmation. The userscript does not include the
extension's signed PWA bridge or its durable workspace ledgers.

## Build packages from source

Create an unpacked desktop build:

```bash
pnpm run pack:desktop
```

Create a Windows NSIS installer:

```bash
pnpm run dist:win
```

Create macOS DMG and ZIP artifacts on macOS:

```bash
pnpm run dist:mac
```

Create the static web folder and deployment ZIP:

```bash
pnpm run build:web
pnpm run verify:web-package
```

The ready-made files are on the [latest release](https://github.com/slaveofsolace/Insta-AIO-Tool/releases/latest); these commands are for developers building locally.

The Electron renderer runs with context isolation, sandboxing, Node integration disabled, denied permission requests, a confined custom protocol, and a restrictive content policy. Local Chromium data is retained across approved upgrades, and up to five startup backups are kept in an app-specific data directory.

See [Installation](./docs/INSTALLATION.md) and [Rollback](./docs/ROLLBACK.md).

## Verification

```bash
pnpm run assemble
pnpm test
pnpm run qa:extension
pnpm run qa:chrome
pnpm run qa:browser:check
pnpm run qa:overlay:check
pnpm run benchmark:zip
```

The automated suite covers imports, migrations, archive limits, reviewed action
and DM jobs, no-click execution, bridge signing and replay protection, extension
permissions, desktop hardening, state migration, service-worker assets, and
large-list rendering. `qa:extension` runs the production content script through
local synthetic Follow, Unfollow, exact-message Unsend, and virtualized
thread-Unsend fixtures. It also
checks keyboard access, the Chromium accessibility tree, PWA installability,
and read-only pairing defaults. `qa:chrome` loads and pairs the unpacked package
in a disposable Chrome-for-Testing profile. Browser QA exercises every PWA view
at desktop, tablet, and mobile sizes without confirming a destructive action.

Use `pnpm run qa:browser:update` only when intentionally accepting a reviewed
visual change. Baselines are platform-specific and actual run output stays under
ignored `test-results`.

The overlay-specific commands rebuild the production extension before loading
its manifest-ordered content scripts in the deterministic Instagram fixture.
Use `pnpm run qa:overlay:update` only for an intentional, manually reviewed
baseline replacement. The 45-state Windows baseline covers fresh install,
filtered Mutual Checker results, a centered 62%-opacity panel, desktop, tablet,
mobile, zoom, forced colors, collision, exact confirmation, and
review-before-start states. It has been reproduced by
`qa:overlay:check`; CI runs the non-updating check on Windows.

The compact userscript layout is also tracked in six reviewed Windows captures
covering light and dark themes, mobile, short-laptop, narrow custom-panel, and
true 200% zoom states. See [Userscript UI evidence](./docs/evidence/userscript-ui-2.0.2/README.md).

Human screen-reader review, persistent-profile installation, and authenticated
Instagram selector acceptance remain separate operator/release gates.

Windows packaging produces an unpacked application and NSIS installer; CI runs
the confined unpacked-app smoke test and verifies the installer artifacts. CI
also builds and smoke-tests macOS DMG and ZIP packages with QA-only ad-hoc
signing. NSIS install/uninstall, Apple Developer ID signing and notarization,
human screen-reader review, persistent-profile installation, and any
user-selected live Instagram action remain manual release checks.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Instagram sidecar](./docs/INSTAGRAM_SIDECAR.md)
- [Overlay QA](./docs/OVERLAY_QA.md)
- [Product specification](./docs/PROJECT_SPEC.md)
- [Source audit](./docs/SOURCE_AUDIT.md)
- [Component integration audit](./docs/COMPONENT_INTEGRATION_AUDIT.md)
- [Migration report](./docs/COMPONENT_MIGRATION_REPORT.md)
- [Release status](./docs/RELEASE_STATUS.md)
- [Operator acceptance runbook](./docs/OPERATOR_ACCEPTANCE.md)
- [Maintainer guide](./docs/MAINTAINER_GUIDE.md)
- [Performance](./docs/PERFORMANCE.md)
- [Security policy](./SECURITY.md)
- [Third-party notices](./THIRD_PARTY_NOTICES.md)

## License

Created by [@slaveofsolace](https://github.com/slaveofsolace). Insta Toolbox is
available under the [MIT License](./LICENSE); redistributed original or modified
copies must retain its copyright and permission notice. Reviewed third-party
sources remain credited in [Third-party notices](./THIRD_PARTY_NOTICES.md).
