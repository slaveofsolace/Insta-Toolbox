# Presence userscript integration

## Available in the development build

Follow / Unfollow retains its existing manual workflow. **Presence** adds a follow-back plan using fresh Mutual Checker observations, not the concept's example accounts.

Open the inbox, run Mutual Checker for the signed-in account, then build the plan. The current viewer adapter needs the native inbox account picker and matching navigation profile link. A profile-only check can still produce the ordinary comparison, but cannot supply Presence account proof.

The composer supports an editable account allowance, protected handles resolved to observed IDs, local plan hours, a private-account preference, explained suggestions, and paged held-account reasons. Form edits invalidate the old plan without replacing its controls. Partial followers can supply positive membership; incomplete Following does not establish negative membership. The old manual partial-comparison workflow is unchanged.

Choices compact after an explicit Build, with results and available actions
together underneath. **Edit plan choices** reopens the same controls. Background
refreshes do not move focus, scroll the panel or replace an in-progress edit.
The manual Follow / Unfollow route remains accessible.

This interface is explicitly a **plan preview**. It has no Start action, simulated progress, automatic schedule, or imported permission. Numeric account/target bindings must reach the native executor before a live routine can be enabled.

## Data boundary

- The shell wraps the existing checker once; Presence makes no additional account requests.
- Only the original result of that private call can create an input receipt.
- New checks, Clear checker, navigation, pagehide, freeze, and shell retirement invalidate the receipt.
- A fresh tab starts without that receipt. Saved comparisons and imported JSON cannot recreate it.
- Plans, selected targets and approval stay in memory. Ordinary form choices use the private `instaToolboxPresencePreferencesV1` key: plan allowance, protected handles, local start/end times and the private-account preference. No account IDs, checked lists, receipts, run history or permission is stored there.
- Preference edits merge against the latest saved values. A browser Web Lock serializes these writes across tabs when supported; otherwise ordering is limited to the current store instance. Late reads do not replace edited controls. Failed writes stay visible, and unknown future schemas are not overwritten.
- The generated userscript bundles source modules; it loads no remote code.

## Remaining handoff

| Area | Implemented | Missing / next engineering step | Release criterion |
| --- | --- | --- | --- |
| Native inputs · integration | Private checker receipt and numeric observed IDs | Verify the current account-picker layout and account switching against the installed candidate | Native own-account capture supplies correct inputs without extra requests; other accounts and restored data do not |
| Routine interface · UI | Stay connected planning, saved choices, reasons, manual fallback | Other routine sources remain separate work | Rendered narrow/short/zoom, keyboard, preference round-trip and current native-data acceptance |
| Profile dispatch · runner | Runtime-only per-control authorization/context hooks and Stop settlement | Independently resolve current viewer and target numeric IDs, bind them to one-use native resolutions | Exact identity, rename, account switch, revocation and uncertain-outcome coverage plus a specifically approved disposable action |
| Shared activity owner · integration | Ghost uses one username-derived account key and exclusive Web Lock | Associate Presence numeric identity with that same trusted key; preserve ownership across native navigation | Presence/Ghost collision, old document, expiry, restart and lost acknowledgment cannot create another action |
| Ongoing routines · integration | Active hours constrain plans | Accepted durable preferences/history and bounded scheduling protocol | No restored or expired authority; verified history only; no background or growth claims from fixtures |

Live Presence, managed tabs, ongoing scheduling, Find my people discovery and Make room managed-history execution remain unavailable. The existing manual Follow / Unfollow engine has not been replaced.
