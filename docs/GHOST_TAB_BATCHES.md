# Ghost Mode tab batches

**Start Ghost Mode** discovers available conversations and asks for one
confirmation. It opens the first ten conversation tabs, runs the existing Unsend
engine in each, and closes the group after every conversation settles. The next
ten then open automatically. The final group may contain fewer than ten.

Selected cleanups use **Selected cleanup batch size**, from one to ten. Existing
saved sizes remain unchanged. Message options apply to each approved conversation;
the default removes all eligible sent messages. No extra confirmation is needed
between groups.

Tabs load and prepare together. Actual Unsend clicks share one account-wide lock
and pacing clock. The inbox tab must stay open. Only tabs created by the cleanup
are closed; existing Instagram tabs are not closed or reassigned.

## Batch boundaries

- Finished tabs wait for their group instead of immediately being replaced.
- A dispatched removal must settle before its tab closes or the next group opens.
- An unready tab receives bounded opening retries with a fresh launch identity.
- A failed, partial or uncertain conversation retains its result. It is not
  silently replayed or relabeled as successfully cleaned.
- A native tab-close failure saves a paused state before another group can open.
- Stop prevents further launches and closes owned tabs after dispatched work settles.

Inbox discovery may be incomplete. The result describes the conversations found,
not a guarantee that Instagram exposed the entire inbox. Unsend does not erase
screenshots, previously saved copies or content outside Instagram.

## Verification

Focused tests cover 25 conversations in groups of ten, ten and five, strict
close-before-open ordering, retry exhaustion, Stop, pending removal settlement,
native close failure, Stop during group closure, and primary-button confirmation.
The full suite includes focused batch regressions. All 45 reviewed Windows overlay baselines pass without changed
thresholds or baseline replacement.

The generated-userscript browser fixture removes one synthetic sent message in
each of twelve conversations, preserves received messages, and closes the first
ten windows before opening the final two. It uses actual renderer windows and
Web Locks, with a synthetic Instagram page and userscript-manager transport.
These fixtures do not establish authenticated ten-tab compatibility. See
[4.3.0 acceptance](acceptance/4.3.0.md) for current evidence and nonclaims.

## Implementation

- `extension/inbox-userscript-panel.js`: primary ten-tab flow and batch progress.
- `extension/inbox-userscript-workers.js`: reviewed scheduling, owned tabs and
  group settlement.
- `extension/cleanup-settings.js`: additive size validation; no new storage key.
- `userscripts/src/toolbox-shell.js`: selected cleanup controls.
- `scripts/lib/userscript-ghost-workers-acceptance.mjs`: generated-bundle integration.

Rebuild the userscript with `pnpm run build:userscript`; do not edit the generated
bundle directly. Extension/PWA/desktop managed-tab execution is unchanged.
