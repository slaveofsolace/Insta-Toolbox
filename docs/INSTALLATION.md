# Installation

Pick one:

- [Userscript](#option-1--userscript-one-click) — fastest, no build step, full tools.
- [Browser extension](#option-2--browser-extension) — same tools, plus pairing with the app.
- [Web / desktop app](#option-3--web-or-desktop-app) — the full workspace for imported Instagram exports.

The userscript is **built from the extension's own Instagram engine**, so both
run identical code for scanning, following, unfollowing, and unsending. The
extension additionally pairs with the app for signed, recorded jobs.

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
4. Open or reload `https://www.instagram.com/`.
5. Use the panel, or press **Alt + Shift + I** to show and hide it.

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
Its first click performs the no-click history check when needed, then asks once
for the exact thread and eligible count. All eligible sent messages is the
default; `newest N` and `oldest N` are under Advanced. The runner processes only
rows proven sent by the current account and uses the source-audited menu and
confirmation sequence. The finite plan receives a one-use capability and uses
the saved delay range. Incomplete or capped checks cannot
create a live plan. Cancel preserves the check and changes nothing. This cannot
be undone.

**Starting a finite action** — review the exact target list or conversation,
then use the ordinary confirmation naming its action, targets or thread, and
finite count. There is no global unlock, enable-live toggle, arm button, or typed
phrase. The resulting non-persistent capability cannot be widened or replayed
and is checked before every later item; expiry stops the run. Scanning,
comparison, evidence reading, and no-click checks require no confirmation.

Pacing lives under the gear icon: per-day caps and the delay range. Runs pause
longer every 20 items, stop on any rate limit or security check, skip targets
that changed, and end immediately on **Stop**. A DM run is discarded on reload.
An already-confirmed account run may continue across the profile navigations it
causes in the same manager tab, but only while its original finite capability
remains valid. Thread-wide Unsend is bound to the open thread and
accepts only the newly surfaced menu and confirmation controls for each item.

Updates are automatic. Tampermonkey re-checks the same address and offers new
versions as they are published.

Confirm the Tampermonkey dashboard shows **2.0.0 or later** after updating. A
panel that asks you to enable live actions, arm a run, or type an authorization
phrase is an older build. The current idle label is **Userscript mode · local
controls**.

### Using the exact CI-tested review bundle

Every pull-request CI run publishes a seven-day artifact named
`insta-aio-browser-companions-<head-commit>` after the real unpacked extension
has loaded and paired read-only in disposable Chrome for Testing. Push-triggered
runs use the pushed commit. Download that artifact from the workflow run when
reviewing an unmerged commit. It contains:

- `insta-aio-companion-<version>.zip` for **Load unpacked** after extraction
- `insta-aio-companion.user.js` for Tampermonkey

Use the artifact whose commit matches the reviewed pull-request head. After
installation, reload Instagram and verify **Userscript mode · local controls**
or the extension's equivalent live-off state before any read-only
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
The extension manager should show **2.0.0 or later**.

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
loads history without opening a message menu. After it proves a complete finite
count, it defaults to all eligible sent messages and asks once for the exact
thread and count. Choose `newest N` or `oldest N` under Advanced when needed.
The 15-minute finite plan is checked before each message, protected against
replay, and paced with the saved delay range. Incomplete or capped checks do not
create a plan.
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

## Option 3 — Web or desktop app

The app is the workspace for data you have already exported from Instagram:
snapshots, comparisons, message search, and queue history.

To run it locally:

1. Run `corepack enable`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run assemble`.
4. Run `pnpm run serve` and open the address it prints.
5. Use your browser's install control if you want it as a standalone app.

The server listens only on your own machine. After the first load the app works
offline.

Prefer a packaged desktop build? See [Windows desktop](#windows-desktop) or
[macOS desktop](#macos-desktop) below.

---

## Windows desktop

Build:

```bash
pnpm run dist:win
```

Run the generated NSIS installer under `dist/desktop`. The assisted installer allows an installation directory choice.

The uninstaller removes program files and shortcuts. Workspace data is retained by default so an approved reinstall or upgrade can recover it. Export a workspace backup before removal if the data must be portable.

## macOS desktop

Build on macOS:

```bash
pnpm run dist:mac
```

This creates DMG and ZIP targets under `dist/desktop`. Production distribution requires an Apple signing identity and notarization appropriate to the release channel.

After building on macOS, run `pnpm run qa:mac-package`. It mounts the DMG,
copies the app to a disposable install root, applies an ad-hoc test signature,
launches `--smoke-test`, removes the copied app, and verifies the ZIP. The QA
signature uses `build/entitlements.mac.qa.plist` because an ad-hoc identity has
no Apple Team ID. The release entitlement files retain hardened runtime without
that library-validation exception. This is acceptance evidence, not a substitute
for Developer ID signing or notarization.

## Upgrade

1. Export a workspace backup from Settings.
2. Close all running application windows.
3. Install the new release over the existing application.
4. Open the application and inspect the active snapshot, queue, messages, and settings.
5. Run a fresh export after the upgrade is accepted.

The desktop shell creates a bounded startup backup before opening the renderer when local browser storage exists.
