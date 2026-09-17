# Settings 4.0

## Baseline and scope

Inventory taken from 3.1.12 (`7ffbcf8`) before the 4.0 settings migration.
This document separates existing behavior, proposed replacements, and acceptance
requirements. A proposed control is not an implemented capability.

The extension stores appearance in `chrome.storage.local`. The userscript stores
it through Tampermonkey's `GM_getValue` / `GM_setValue`. The PWA and desktop store
workspace state in IndexedDB (`insta-toolbox`, `kv`, key `state`). These are
separate stores; 4.0 must not silently synchronize them or copy action authority.

## Appearance inventory

Key abbreviations:

- **E**: `instaToolboxOverlayPreferencesV3` (schema 3; older V1/V2 are read by migration).
- **U**: `instaToolboxUserscriptPreferencesV1` (schema 3 despite the key suffix).

| Current control / field | Storage key | Actual effect | Decision and replacement | Additive migration |
| --- | --- | --- | --- | --- |
| Theme | E `.theme` | `auto`, `light`, or `dark`; auto follows Instagram. No userscript equivalent. | Retain in Appearance; add userscript parity. | Preserve E; default new U field to `auto`. |
| Spacing | E `.density` | Comfortable/compact vertical rhythm. No userscript equivalent. | Retain as Density in Appearance; add userscript parity without reducing targets. | Preserve E; default U to `comfortable`. |
| Surface transparency | E/U `.opacity` | Surface alpha 0.55–1. A higher percentage is **more opaque**, contrary to the current label. | Retain as Opacity; keep live preview. | Preserve the value; retain existing U schema-1 0.94-to-0.88 migration. |
| Background blur | E/U `.blur` | `none`, `soft`, `strong` map to 0/10/18px. E DM styling previously overrode all three with 14px. | Retain as Blur. Shell owns the filter; views must not override it. | Preserve the value. Foundation fix removes only the DM override. |
| Collapsed button | E/U `.launcherSize` | E standard/large = 44/52px; U = 46/54px. | Retain as Launcher size; standardize future rendering at >=44px. | Preserve selected size, not historical pixel dimensions. |
| Accent | E/U `.accent` | Rose/violet/blue. E auto-theme DM style can override the shell signal with Instagram blue. | Move to Appearance → More appearance options; consolidate styling before claiming consistent effect. | Preserve selection; do not silently replace it. |
| Dock side | E `.dock` | Left/right dock; selecting it clears floating panel position. No U equivalent. | Move to More appearance options. U support requires real layout handling. | Preserve E; default added U field to right. |
| Panel width select | E `.width` | Compact/standard/wide = 380/460/560px; selecting clears custom width but preserves height. | Merge with Size presets; show Custom after manual resize. | Preserve preset and any explicit pixel size; never snap saved custom layouts. |
| Size preset buttons | E `.width`, `.panelWidth`, `.panelHeight`; U `.width`, `.height` | E Compact 380×520, Tall 460×viewport-bounded820, Wide 560×680. U Compact 360×520, Tall 430×viewport-bounded820, Wide 560×680. | Merge into one clear preset control with common future geometry. | Saved pixels win until a new preset is explicitly selected. |
| Manual resizing | E `.panelWidth`, `.panelHeight`; U `.width`, `.height` | Two lower resize handles and arrow-key sizing. Bounds and small-window breakpoints differ. | Retain; synchronize preset display and clamp rendered geometry. | Preserve explicit dimensions; normalize invalid values only. |
| Panel position | E/U `.position` | Floating coordinates; viewport clamping; docking on narrow layouts. | Retain as interaction state, not another form field. | Preserve coordinates; re-clamp on render. |
| Launcher position | E/U `.launcherPosition` | Drag/keyboard position of collapsed IT button. | Retain as interaction state. | Preserve coordinates; re-clamp on render. |
| Reset panel and collapsed button | E/U geometry **and opacity** | Both currently reset opacity; U spreads defaults while retaining accent, blur, launcher size and current view. | Replace with geometry-only **Reset layout**. Add separate **Reset appearance**. | No migration or deletion; explicit action changes only its documented fields. |
| Open/selected view | E `.open`, `.section`; U `.open`, `.view` | Reopens/restores chosen tool; default differs by runtime. | Retain as internal UI state. | Preserve current values and runtime defaults. |
| Onboarding completion | E `.firstRunComplete`; U state `.introDone` | Controls one-time introduction. | Retain internally. | Preserve; do not restart onboarding on a normal update. |

## Cleanup and execution inventory

| Current control / field | Storage key | Actual effect | Decision and replacement | Additive migration |
| --- | --- | --- | --- | --- |
| Minimum/maximum delay | E `instaToolboxBatchLimits.minDelayMs/maxDelayMs`; U `instaToolboxUserscriptStateV2.limits.*` | Follow/Unfollow batch pacing. E defaults 4–11s (minimum accepted 1.5s); U defaults 1–2s. The streaming DM reservation independently supplies 1–2s. | Move existing fields to Follow/Unfollow → Advanced and name their scope. DM **Speed** must use the shared DM contract, not these unrelated fields. | Preserve existing values and behavior until an explicitly tested pacing migration. |
| Historical daily limit fields | E `instaToolboxBatchLimits.dailyActionLimit/dailyDmLimit`; PWA state `.settings.dailyFollowLimit/dailyUnfollowLimit` | Retained compatibility fields; not current overlay controls. | Do not expose new quotas or treat these fields as 4.0 DM usage limits. | Preserve existing data; do not reintroduce removed quota enforcement. |
| DM message scope / count | E `[data-insta-toolbox-role="unsend-scope/unsend-count"]`; U `[data-role="unsend-scope/unsend-count"]` | Per-run All/Newest N/Oldest N; not saved as a cleanup default. | Retain per-run controls. Add default scope in Cleanup defaults, applied only to a new draft. | Default `all`; never change an existing reviewed plan. |
| Speed | Cleanup preferences `.speed` added during 4.0 development | Single-thread pacing is internal again. | Remove the Fast and Standard controls; use the restored pre-Fast runner. | Normalize saved `fast` to `standard`; preserve the key and all other preferences. Reject stale Fast action plans. |
| Own-reaction cleanup | None | Not implemented. | Disabled, default-off choice with a specific reason until verified own-reaction adapter exists. | Add false; saved true cannot enable an unsupported adapter. |
| Run-summary preferences | None | Existing run feedback is always rendered. | Add only presentation preferences; verified/uncertain outcomes remain recorded and visible. | Defaults preserve current summary visibility. |
| Execution mode | None | The current page hosts the DM runner; there is no durable inbox coordinator. | Foreground / Background when supported, separate from cleanup scope. Explain suspension and sleep limits. | Default Foreground. A saved preference never restores authority. |
| Worker count | None | No managed-tab pool. | Default one; two only after collision and stale-worker acceptance. Keep unsupported values disabled. | Default one; do not open tabs during migration. |
| Scheduling policy | None | Existing single-thread run is serial. | Serial account-level mutations; multiple preloaded tabs must not imply simultaneous mutations. | Default serial; no automatic run scheduling. |
| Completion notifications | None | No notification adapter exposed. | Optional, disabled with reason where permission/capability is absent. | Default off; migration cannot request permission. |

## Workspace and data inventory

These workspace settings are not substitutes for Instagram-page ownership proof.

| Current control / field | Storage key | Actual effect | Decision and replacement | Additive migration |
| --- | --- | --- | --- | --- |
| Unfollow review delay | PWA state `.settings.waitingDays` | Ages imported queue entries into review readiness. | Retain in workspace account review settings. | Preserve value. |
| Sent-message names | PWA state `.settings.ownerNames` | Identifies ownership while importing message exports. | Retain in import settings; never use as sufficient native reaction ownership. | Preserve list. |
| Whitelist | PWA state `.settings.whitelist` | Excludes accounts from queue review. | Retain as Protected accounts; merge presentation with related protection options, not underlying semantics. | Preserve list. |
| Always-protected accounts | PWA state `.settings.preexistingFollowing` | Protects baseline following; populated on first import and by explicit action. | Retain. | Preserve list; no recapture during migration. |
| Protect mutuals | PWA state `.settings.protectMutuals` | Excludes known mutuals from unfollow review. | Retain. Partial checker results remain reviewable with uncertainty; no restored blanket block. | Preserve boolean. |
| Plan without actions | PWA state `.settings.dryRun` | Workspace planning preference. | Retain its existing contract; do not add a global unlock to in-page DM use. | Preserve boolean. |
| Legacy live flags / batch sizes | PWA state `.settings.liveActionEnabled/liveDmUnsendEnabled/liveActionBatchLimit/liveDmBatchLimit` | Compatibility fields used by reviewed workspace adapters; absent from current settings form. | Keep internal compatibility, not new user-facing unlock switches. | Preserve data; never promote old values into new run authority. |
| Pairing / action permission | PWA state `.bridgePairing`; E `instaToolboxBridgePairings` | Exact-origin companion pairing; permission chosen when pairing is created. | Move behind Data and troubleshooting → Companion connection. Single-chat DM needs none. | Preserve existing pairing contract. |
| Export backup | PWA whole state | Exports a local workspace backup. Other surfaces have tool-specific exports. | Retain; add clearly scoped per-surface backups only with matching import validation. | No format rewrite without versioned compatibility. |
| Clear local workspace | PWA state reset | Explicit destructive local data reset. | Rename **Delete local data** with exact scope; separate from appearance reset. | Never run during update or migration. |
| Clear checker | E capture workspace; U state `.capture` | Clears follower capture data for that surface. | Retain tool-specific action. | No automatic clear. |
| History / diagnostics / storage usage / version | Existing ledgers, U `.history`, package version | History and version exist in several views; no unified storage-usage or sanitized diagnostics control. | Add Data and troubleshooting entries backed by real adapters. Never include cookies, message bodies, or action capability tokens in diagnostics. | Preserve ledgers; explicit clear-history affects only named history. |

## Visual direction

The committed baseline `docs/evidence/overlay-ui-3.1.12-2026-09-12/after/win32/settings-customization.png`
shows a quiet native-control dialog, but dock and width lead the form and every
setting has equal weight. The appearance stack fills a short viewport before
any execution settings could be reached.

Keep the modal backdrop, system type, 44px targets, and visible focus. Use one
**Settings** heading, four separated sections, and no cards inside cards:

1. **Appearance**: Theme, Density, Opacity, Blur, Launcher size, Reset layout.
   **More appearance options** contains Accent, docking, size presets, and Reset appearance.
2. **Cleanup defaults**: default messages, own-reaction cleanup, summaries.
3. **Execution**: supported background behavior, workers, serial scheduling, notifications.
4. **Data and troubleshooting**: storage usage, backup/export, history, diagnostics,
   version, and a visually separate Delete local data action.

Use 4/8/12/16/24px spacing; a single scroll owner; 120–180ms transitions only
for state changes. Progress updates must not replace settings controls, move
focus, or reset selection/scroll. Disabled features need readable reasons beside
their controls, not an enabled-looking placeholder.

## Implementation and acceptance ledger

| Change | Status | Evidence / release requirement |
| --- | --- | --- |
| Remove DM fixed blur override | Implemented; controlled Chromium check passed | Computed 0/10/18px across Toolbox, DM, Mutual Checker, and Follow/Unfollow; shell remains the panel filter owner. |
| Grouped extension settings and shared validation | Implemented; controlled runtime and visual checks passed | Four sections, secondary appearance controls, shared appearance normalizer, and separate cleanup defaults. Geometry passed at 1440×900, 800×500, 320×720, and true 200% zoom. The 45-state overlay matrix includes keyboard and forced-colors checks; human screen-reader acceptance remains separate. |
| Reset layout / Reset appearance separation | Implemented on extension and userscript; controlled-runtime checks passed | Layout reset preserves appearance. Appearance reset preserves geometry, cleanup defaults, captures, and queues. Neither reset deletes storage or grants action authority. |
| Theme/density userscript parity | Implemented; controlled light/dark and density checks passed | Shared validation and tokens; saved geometry and existing preferences survive the additive fields. Source-matched dark, narrow, short, and true 200% captures were reviewed. |
| Reactions / workers / background preferences | Stored and capability-gated; unaccepted adapters remain disabled | Saved preferences cannot enable an unsupported adapter or restore run authority. Actual background behavior and reaction integration remain separate gates. |
| Remove Fast | Implemented across runner, reservation, settings, and both in-page surfaces | Saved Fast preferences normalize to Standard. One pacing contract remains; forged or stale Fast plans dispatch nothing. No speed multiplier is claimed. |
| Optional completed summary | Implemented | Turning summaries off collapses completed extras only; verified removal counts and interrupted/error outcomes remain visible. |
| Local export and sanitized diagnostics | Implemented on extension and userscript | Exports are scoped to local preferences, capture, and queue data. Diagnostics exclude accounts, thread IDs, message bodies, pairings, and action capabilities. They are not a new backup-import contract. |
| Clear history / Delete local data | Not implemented in the new settings surface | The extension controls remain disabled with an explanation. A cross-tab idle check and scoped storage adapter are required before enabling deletion; Reset appearance is not a substitute. |

Required rendered checks: light/dark/auto, each blur value across all tool tabs,
short window, 320px width, 200% zoom, reduced motion, forced colors, keyboard-only
open/close/reset, outside-click close, focus restoration, and readable translucent
text. Fixtures establish controlled-runtime behavior, not authenticated Instagram
compatibility. Review changed screenshots without widening tolerances.

## Presence choices

The userscript keeps ordinary planning choices in a separate private key,
`instaToolboxPresencePreferencesV1`. It does not read or rewrite appearance,
cleanup, comparison or queue keys. Loading a saved record never writes it back.

| Field | Effect | Default / migration |
| --- | --- | --- |
| `followLimit` | Number of accounts considered for this plan, 0–50 | 6; preserve valid zero and saved values. This is not a daily quota. |
| `protectedHandles` | Accounts excluded from suggestions after resolution against fresh checked lists | Empty; normalize valid handles, report malformed entries without silently deleting them during unrelated edits. |
| `window.start/end` | Local planning hours | 09:00–20:00; retain each independently edited value, including overnight windows. |
| `skipPrivate` | Hold private or unknown-visibility accounts | True; only an explicit change includes them. |

Versionless and schema-0 records normalize additively when an edit is saved.
Future schemas stay untouched. Damaged known fields require **Save corrected
choices** after reviewing their replacement values. Storage failures leave the
current form usable in that tab and show that saving failed. A read arriving
late cannot overwrite typed changes; only committed field changes are saved.

No plan, target ID, receipt, run history, selection or approval is persisted.
Reload restores choices only and still needs a fresh native comparison.

## Remaining settings adapters

| Item / responsible area | Current fallback and missing capability | Source and release criterion |
| --- | --- | --- |
| Clear history / Delete local data — UI/settings | Disabled in the new dialog. Existing tool-specific clear controls and workspace deletion retain their established scope. There is no shared cross-tab idle check or scoped deletion adapter. | `extension/instagram-overlay.js`, `userscripts/src/toolbox-shell.js`: implement an explicit scoped confirmation and storage adapter, then prove active runs block deletion, unrelated stores survive, and failed persistence leaves a recoverable state. |
| Completion notifications — browser integration | Disabled; run results remain in the tool. No notification runtime or permission flow is connected. | `extension/cleanup-settings.js` and each shell: verify supported APIs and minimal permissions, notify only after settled completion, and test denied permission, cancelled runs, and duplicate terminal events before enabling. |

These are disabled controls with explanations, not completed integrations.
