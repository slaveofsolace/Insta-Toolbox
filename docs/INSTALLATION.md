# Installation

Pick one:

- [Userscript](#option-1--userscript-one-click) — fastest, no build step, full tools.
- [Browser extension](#option-2--browser-extension) — same tools, plus pairing with the app.
- [Web / desktop app](#option-3--web-or-desktop-app) — the full workspace for imported Instagram exports.

The userscript is **built from the extension's own Instagram engine**, so both
run identical code for scanning, following, unfollowing, and unsending. The
extension additionally pairs with the app for signed, recorded jobs.

## Ready-made downloads

Open the [latest release](https://github.com/slaveofsolace/Insta-AIO-Tool/releases/latest), expand **Assets**, and choose one file:

The 2.0.3 files appear there together after publication. Before then, the
commit-named CI artifacts are review builds, not a public release.

| Platform | Download | What to do |
|---|---|---|
| Windows 64-bit | `Insta-Toolbox-Setup-2.0.3.exe` | Open it and follow the short installer. |
| macOS (Intel + Apple Silicon) | `Insta-Toolbox-2.0.3-universal.dmg` | Open it and drag Insta Toolbox to Applications. |
| Web / PWA hosting | `insta-toolbox-web-2.0.3.zip` | Extract and serve the folder over HTTPS or localhost. |
| Chrome extension | `insta-aio-companion-2.0.3.zip` | Extract it, then load the extracted folder as an unpacked extension. |

No Node.js or command line is required for the Windows or macOS downloads.
The Windows installer is unsigned. The universal macOS app is ad-hoc signed,
not Developer ID signed or notarized. Verify the file against
`SHA256SUMS.txt` on the release before opening it.

---

## Option 1 — Userscript (one click)

This gives you all three tools in a movable, resizable, translucent panel on
Instagram. Live Follow, Unfollow, and Unsend are inactive on every page load.
Read-only tools require no unlock; each destructive run uses one exact finite
confirmation when it starts.

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Open the install link:

   **[Install Insta Toolbox](https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js)**

   Tampermonkey recognises the `.user.js` address and opens its install screen.
3. Select **Install**.
4. Right-click Tampermonkey in the browser toolbar, choose **Manage extension**,
   then enable **Allow User Scripts**.
5. Open or reload `https://www.instagram.com/`.
6. Use the panel, or press **Alt + Shift + I** to show and hide it.

Tampermonkey is the supported manager for paced account runs. The script asks
for an isolated DOM sandbox and `GM_getTab`/`GM_saveTab` so a confirmed
batch remains owned by one Instagram tab. A different userscript manager may
still provide scanning, local comparison, and no-click checks, but the account
batch controls deliberately stay disabled unless those tab APIs are available.

### Using it

**Mutual Checker** — confirm the username and choose **Check Followers +
Following**. The checker reads both paginated lists through the signed-in
Instagram tab and compares them locally. It never opens a page control. If
Instagram rejects that read, use the exact-dialog scanner under **Advanced:
list-dialog fallback and export**.

**Follow / Unfollow** — choose **Follow people** or **Unfollow people**, select a
compatible target source and count, then choose the explicit **Review N …
targets** action. Exact targets, duplicates, already-correct relationships,
protected/skipped reasons, and omissions are frozen for inspection; **Start**
appears only while that review matches the current controls. The script
opens each profile when its turn comes and resolves the exact relationship
control again before acting.

**DM Unsend** — open a conversation and choose the always-visible **Unsend DMs**.
It asks once for the exact open thread and selected scope, then starts one
streaming traversal. All messages you sent is the default; `newest N` and
`oldest N` are under Advanced. The runner processes only rows proven sent by the
current account and uses the source-audited menu and confirmation sequence. The
thread-bound capability is transient, checked before every message, and each
verified removal is recorded immediately. **Check conversation** remains an
optional read-only diagnostic; its estimate is not an authorization count.
Cancel changes nothing. This cannot be undone.

**Starting a finite action** — review the exact target list or conversation,
then use the ordinary confirmation naming its action, targets or thread, and
finite count. There is no global unlock, enable-live toggle, arm button, or typed
phrase. The resulting non-persistent capability cannot be widened or replayed
and is checked before every later item; expiry stops the run. Scanning,
comparison, evidence reading, and no-click checks require no confirmation.

Pacing lives under the gear icon. Account runs pause
longer every 20 items, stop on any rate limit or security check, skip targets
that changed, and end immediately on **Stop**. DM Unsend uses adaptive one-to-two
second action pacing and has no daily usage quota. A DM run is discarded on reload.
An already-confirmed account run may continue across the profile navigations it
causes in the same manager tab, but only while its original finite capability
remains valid. Thread-wide Unsend is bound to the open thread and
accepts only the newly surfaced menu and confirmation controls for each item.

Updates are automatic. Tampermonkey re-checks the same address and offers new
versions as they are published.

Confirm the Tampermonkey dashboard shows **2.0.3 or later** after updating. A
panel that asks you to enable live actions, arm a run, or type an authorization
phrase is an older build. The current panel has a compact **Insta Toolbox**
header and a creator credit at the bottom.

### Using the exact CI-tested review bundle

Every pull-request CI run publishes a seven-day artifact named
`insta-toolbox-browser-companions-<head-commit>` after the real unpacked extension
has loaded and paired read-only in disposable Chrome for Testing. Push-triggered
runs use the pushed commit. Download that artifact from the workflow run when
reviewing an unmerged commit. It contains:

- `insta-aio-companion-<version>.zip` for **Load unpacked** after extraction
- `insta-aio-companion.user.js` for Tampermonkey

The same run publishes `insta-toolbox-web-<head-commit>` with the verified static
web ZIP. These short-lived CI artifacts are for reviewing an unmerged commit;
normal downloads belong on the GitHub release page.

Use the artifact whose commit matches the reviewed pull-request head. After
installation, reload Instagram and verify the compact **Insta Toolbox** header
before any read-only
walkthrough. The artifact proves which bytes passed CI; it does not replace the
persistent-profile, authenticated, or human acceptance checks.

Use the [operator acceptance runbook](./OPERATOR_ACCEPTANCE.md) for the
persistent-profile, screen-reader, PWA-pairing, and separately authorized
one-item live checks. A general installation test is not authorization for an
Instagram mutation.

### Installing from the repository page instead

Tampermonkey can also install straight from GitHub's file view:

1. Enable the GitHub integration on the
   [Tampermonkey scripts page](https://www.tampermonkey.net/scripts.php#gh).
2. Browse to `userscripts/insta-aio-companion.user.js` in the repository.
3. Select **Raw**. Tampermonkey intercepts it and offers to install.

### If nothing happens

- Confirm Tampermonkey is enabled and allowed to run in your browser's
  extension settings.
- Some browsers require developer mode for extensions to handle `.user.js`
  addresses. Enable it, then retry the link.
- If you land on a page of source code instead of an install screen, Tampermonkey
  did not intercept it. Select all of that code, then paste it into a new script
  in the Tampermonkey dashboard and save.

---

## Option 2 — Browser extension (full features)

### Build and load it

1. Run `pnpm run build:extension`.
2. Open your browser's extension manager.
3. Turn on developer mode.
4. Choose **Load unpacked** and select the **`dist/extension`** folder.
5. Open or reload `https://www.instagram.com/`.
6. Press **Alt + Shift + I** to open the panel.

Select `dist/extension`, not the `extension/` source folder. The build copies
shared code into `dist/extension/lib/`, and the extension will not start without it.

After rebuilding, reload the extension in the extension manager **and** reload
any open Instagram tabs, or you will keep running the previous version.
The extension manager should show **2.0.3 or later**.

On a fresh install Instagram shows only a small launcher; opening it reveals the
tools. On desktop, drag the header to move the panel and use the marked
lower-right handle to resize it. Surface opacity ranges from 55% to 100%, with a readable 88% default;
the Instagram page remains visible underneath at lower values. Dock side, width,
theme, density, position, size, and opacity stay on your machine. Narrow screens
use a fitted bottom sheet instead of an off-screen floating panel.

### Using the three tools

No pairing is needed for these. Open the panel on Instagram and use:

**Mutual Checker.** Confirm the username and choose **Check Followers +
Following**. The checker resolves the exact account and reads both paginated
lists from Instagram without opening or clicking any relationship control. A
successful run replaces both prior lists atomically. A stopped or failed run
keeps the prior comparison. The Advanced exact-dialog fallback remains available
if Instagram changes or rejects its authenticated read interface.

**Follow / Unfollow.** Choose the action first, then a compatible current-profile,
checker-result, scanned-list, or queue source and a finite count. Choose the
explicit **Review N … targets** action to inspect and freeze exact targets,
duplicates, already-correct relationships, protected/skipped reasons, and
omissions. **Start**
appears only while the review remains current. Each account is opened, re-checked,
and acted on individually.

**DM Unsend.** Open a conversation and choose **Unsend DMs**. The first click
asks once for the exact thread and selected scope, then starts one traversal
without a preliminary count scan. It defaults to all messages you sent; choose
`newest N` or `oldest N` under Advanced when needed. The 15-minute plan is
checked before each message, protected against replay, and paced at one to two
seconds after successful actions. The optional read-only check reports only a
detected minimum and never gates the run.
**Unsending cannot be undone.**

### Batch runs, pacing, and stopping

Batch runs use one exact finite action/target/count confirmation. Every item
still gets its own full check before anything happens.

- Delays between items are randomised, with a longer pause every 20 items.
- Delays are under **Settings → Batch pacing**, with a 1.5-second minimum gap.
- The run stops on its own at the first rate limit, security checkpoint, block,
  expired session, or screen it does not recognise.
- An account whose relationship changed since the scan is skipped, not forced.
- **Stop** ends the run before the next item.

Bulk activity and automated following go against Instagram's terms and can get an
account restricted. Start with one or two items and increase slowly.

### Pairing with the app (optional)

Pairing is only needed for the signed job workflow described below, where the web
app reviews and records actions:

1. Open the app and create a pairing code in Settings.
2. Open the extension popup on that same app tab and complete pairing.

The extension requests access only to the exact paired PWA origin at pairing time.
Instagram host access is declared for the visible sidecar, no-click inspection,
and separately gated one-item drivers. The sidecar can import a PWA manual
queue, navigate to the profile selected by the user, and update its own local
completion/skip state. It does not auto-scroll Instagram. Dry runs never use an
Instagram page control. Controlled live Follow, Unfollow, and exact
sent-message Unsend are available only through the separate one-item workflows
below and remain inactive until their exact confirmations.

Reviewed DM dry runs can report `resolved-no-click` only while the exact thread
is open and one visible sent row exposes every stable identity field required by
the reviewed job. Current Instagram DOMs that omit any field will stop safely;
this is expected.

After updating an unpacked build, reload the extension in the browser extension
manager and reload existing Instagram tabs so both content scripts are current.

### Controlled account action

This workflow changes the selected Instagram relationship. Use it only for one
account the operator has explicitly reviewed:

1. Pair the extension with **action** permission.
2. Select exactly one queue record, create its reviewed preview, and complete the no-click dry run first.
3. Create a fresh preview if needed and choose controlled live mode.
4. Open the exact target profile and verify the username, action, and relationship in **Insta Toolbox → Queue**.
5. Select **Continue controlled live action** and accept the ordinary confirmation naming that exact profile and action. The signed intent, transient capability, and durable reservation are consumed as one bounded operation.
6. Review the job checkpoint, queue result, activity entry, and action-ledger record before doing anything else.

The transient capability is scoped to one job item, username, action, Instagram
tab, and short expiry. It is consumed before the page-control request, including
on uncertain outcomes. A new review and exact confirmation are required for any
later attempt.

### Controlled one-message Unsend

This workflow removes one exact sent message. Do not use it until the operator
has reviewed that specific message and accepts that Unsend is destructive:

1. Pair the extension with **action** permission.
2. The extension path accepts exactly one message even if exported core jobs use another reviewed limit.
3. Select one sent message, create its reviewed preview, and complete the no-click dry run first.
4. Create a fresh preview if needed and choose controlled live mode.
5. Open the exact conversation and keep the exact sent message rendered. In **Insta Toolbox → Messages**, verify the message identity.
6. Select **Continue controlled live Unsend** and accept the ordinary confirmation naming the exact thread and message. The signed intent, transient capability, and durable reservations are consumed as one bounded operation.
7. Stop immediately if the PWA reports any ambiguity or uncertain outcome. Review the DM job checkpoint plus both ledger records before any later attempt.

The transient capability is scoped to one job, item, conversation, message, and
Instagram tab. The extension reserves and consumes it before the first page control. The PWA
separately reserves its durable ledger, and the row token is one-use. A new
fresh review and exact confirmation are required for any later attempt. Deterministic
fixtures do not replace authenticated selector and action acceptance.
If Instagram does not expose explicit control/surface relationships or another
stable message identity for post-removal proof, the driver stops uncertain. Do
not retry or weaken those checks; record the DOM acceptance blocker instead.

---

## Option 3 — Workspace app

The workspace app handles imported Instagram exports, snapshots, comparisons,
message search, queue history, ledgers, and backups:

### Windows 64-bit

1. Open the [latest release](https://github.com/slaveofsolace/Insta-AIO-Tool/releases/latest).
2. Under **Assets**, download `Insta-Toolbox-Setup-2.0.3.exe`.
3. Open it, choose an install folder, and finish the installer.

The installer is one ready-made file; Node.js and pnpm are not needed. The
uninstaller removes program files and shortcuts but keeps workspace data for an
upgrade or reinstall. Export a workspace backup before uninstalling if you need
to move that data elsewhere.

If SmartScreen appears after the checksum matches the release, choose **More
info → Run anyway** to open this unsigned build.

### macOS (Intel + Apple Silicon)

1. Open the [latest release](https://github.com/slaveofsolace/Insta-AIO-Tool/releases/latest).
2. Under **Assets**, download `Insta-Toolbox-2.0.3-universal.dmg`.
3. Open the DMG and drag Insta Toolbox to Applications.

This build runs on both Intel and Apple Silicon. It has an ad-hoc integrity
signature but is not Developer ID signed or notarized, so macOS may show a
Gatekeeper warning. Verify its SHA-256 value before deciding whether to open it.
The `Insta-Toolbox-2.0.3-universal.zip` asset contains the same app in ZIP form;
it is mainly useful for controlled deployment and troubleshooting.

After the checksum matches, Control-click Insta Toolbox and choose **Open**. If
macOS still blocks it, open **System Settings → Privacy & Security**, choose
**Open Anyway**, and confirm the same app.

### Web / PWA package

The release includes `insta-toolbox-web-2.0.3.zip` for static hosting. It cannot
be opened by double-clicking `index.html`; browser modules and offline support
require HTTPS or `http://localhost`.

1. Download and extract the web ZIP.
2. Publish the extracted `insta-toolbox-web` folder with a static HTTPS host, or serve it from localhost.
3. Open the root address. In Chrome or Edge, use **Install Insta Toolbox** from the address bar or browser menu.

For a quick local preview with Python installed, open a terminal in the folder
that contains `insta-toolbox-web`, run one command, then open
`http://127.0.0.1:4173`:

Windows:

```powershell
cd insta-toolbox-web
py -m http.server 4173 --bind 127.0.0.1
```

macOS:

```bash
cd insta-toolbox-web
python3 -m http.server 4173 --bind 127.0.0.1
```

Keep the terminal open while using the app. Press `Ctrl+C` there to stop it.

Workspace data stays in that browser profile. A public hosted URL is not bundled
with this release. Hosts should reproduce the repository server's framing,
content-type, and `nosniff` response headers; the ZIP itself cannot set headers.

### Build from source

Install Node.js 22.12.0 or newer and pnpm 11.9.0, then run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run assemble
pnpm run serve
```

The local server listens only on your machine. To create distributable files:

```bash
pnpm run build:web
pnpm run verify:web-package
pnpm run dist:win
pnpm run dist:mac
```

`dist:win` must run on Windows. `dist:mac` and `qa:mac-package` must run on macOS.
The shipped macOS app is universal and ad-hoc signed. Package QA inspects both
architectures, the bundle icon, and the signature on the exact packaged app; it
does not modify or re-sign that app. Developer ID signing and notarization
require release credentials and are not part of this build.

## Upgrade

1. Export a workspace backup from Settings.
2. Close all running application windows.
3. Install the new release over the existing application.
4. Open the application and inspect the active snapshot, queue, messages, and settings.
5. Run a fresh export after the upgrade is accepted.

The desktop shell creates a bounded startup backup before opening the renderer when local browser storage exists.
