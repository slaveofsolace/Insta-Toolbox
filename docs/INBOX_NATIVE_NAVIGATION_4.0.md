# Native inbox discovery

`extension/inbox-native-navigation.js` adds bounded discovery for inbox rows that are buttons rather than thread links. It opens an observed conversation, takes its exact thread ID from the resulting Instagram route, and returns using an observed inbox link. It does not invoke Unsend or any worker runner.

Opening a conversation can mark it read. The caller must disclose this before setting `navigationAcknowledged: true`. This is non-deleting navigation, not a promise that the account remains unchanged.

## Integration

Create one `createNativeInboxDiscovery` instance for an explicit discovery request, then call `run()`. `stop()` cancels pending waits and prevents additional navigation. `snapshot()` returns detached inventory and section coverage records.

Required inputs:

- `accountId`: the exact signed-in account identity.
- `resolveAccount()`: a synchronous, trusted account resolver returning `{ accountId, verified: true, restriction: null }`. Unverified, changed, restricted or asynchronous results stop discovery. Do not use page-writable settings as identity authority.
- `navigationAcknowledged: true`: acknowledgment of opening conversations and possible read receipts.
- `expiresAt`: an elapsed-time deadline. Expired discovery cannot resume itself.

The browser defaults use the supplied `document` and `window`; no injected click implementation is required. They locate one visible `[aria-label="Thread list"]`, top-level conversation buttons with avatar images or exact thread links, the list's sole scroll owner, and visible exact `/direct/inbox/` return links. Nested controls and disabled buttons are excluded. Each return reacquires the list and scroller before restoring its position.

Buttons inside nested semantic lists (including the observed Notes list) or semantic carousels are skipped even if they contain avatar images. An unverified conversation layout inside one of those containers is skipped rather than guessed. Scroll owners must have actual vertical overflow and computed `overflow-y: auto`, `scroll` or `overlay`; ordinary overflowing layout boxes are not sufficient. Multiple qualifying owners remain ambiguous, and an overflowing root without verified scrolling reports `inbox-scroller-unavailable`. No private DOM attributes or test-only selectors are used.

Section tabs are resolved by exact English Primary, General and Requests labels and `aria-selected`. The observed Request(s) count suffix, such as `Requests (1)`, is accepted. Where Instagram does not expose that structure, integration can supply a trusted synchronous `resolveSection()` based on reviewed native section evidence. An absent section proof stops with `section-control-unavailable`; it is not silently recorded as Primary.

The default bounds are 1,000 conversations, 100 viewport samples, 2,000 row visits and 8 seconds per route transition. They are finite discovery limits, not message-removal quotas. Snapshots contain only account/thread identities, section names, counters and fixed reason codes—no message bodies, previews or display names.

## Coverage

Route IDs deduplicate recycled rows. A repeated viewport, a quiet list, a scroll boundary or reaching a bound never proves inbox completeness. Those outcomes remain partial. Unvisited sections stay `not-scanned`.

An optional `proveTerminal` adapter can report the existing exact native-terminal-marker contract only when a real terminal marker has been established for that account and section. No such Instagram terminal proof ships here. Default results therefore remain incomplete, even when useful conversation IDs were discovered.

If interrupted inside a conversation, `needsInboxReturn` stays true. Stop, expiry, account changes and restrictions do not trigger an extra cleanup click. The interface should offer a normal return to inbox rather than silently navigating after cancellation.

## Verification and remaining work

Deterministic tests cover route resolution, repeated virtualized windows, identity deduplication, replaced roots/scrollers, nested controls, account switching, unexpected routes, route timeout, cancellation, expiry, missing return navigation, bounds, section coverage and terminal-proof binding.

This module is implemented and fixture-tested. The same-tab adapter below connects it to the existing viewer resolver and coordinator review contract. The generated userscript includes its review panel and serial runner integration, but the path is not accepted against an authenticated inbox. Native button/avatar structure, section evidence, list scroll ownership and return-link availability still require current-browser verification. Localized sections require a reviewed resolver. Delayed windows that exceed the bounded settle period remain partial rather than being presented as fully discovered.

The panel shows the navigation acknowledgment, renders the exact-ID inventory, and hands the confirmed selection and captured navigator to the same-tab controller. Discovery and navigation are not cleanup approval. Worker-tab creation remains separate work.

## Same-tab discovery and review

`extension/inbox-userscript-discovery.js` exports `createUserscriptInboxDiscovery`.
It uses the existing visible account-picker and global-navigation proof from
`instagram-viewer.js`, not page messages, cookies, storage, or the checked Mutual
Checker profile. The viewer keeps its existing username-valued `accountId` for
single-chat reaction compatibility and adds `accountKey` plus
`identityKind: 'verified-viewer-username'`.

The discovery key is `iguser-v1-` followed by fixed two-digit ASCII hex for the
normalized username. It is collision-free for that representation, including
dots and underscores, and accepted by the existing coordinator. It is **not an
Instagram numeric ID or immutable account identity**. A rename or account switch
invalidates the captured inventory and review; numeric native-response parsing
and Presence identity remain separate contracts.

```js
const discovery = createUserscriptInboxDiscovery({ onProgress: renderInventory });
const result = await discovery.discover({
  navigationAcknowledged: true,
  sections: ['primary'],
});
const review = discovery.review({ threadIds: selectedThreadIds, scope: 'all' });
```

Before calling `discover`, show: **Opening conversations may mark them read.**
The API requires that acknowledgment, starts only on the native inbox route,
rechecks viewer identity before every navigation, and resolves only observed
section labels/selection. Unknown or localized sections are unavailable; there
is no assumed Primary section. `stop()` cancels pending navigation. Freeze and
pagehide also interrupt discovery without silently returning to the inbox.

`snapshot()` and progress callbacks expose detached inventory/status metadata.
Coverage remains partial without an accepted native terminal proof. Interrupted
discovery may require a normal manual return to the inbox. Account drift clears
the inventory instead of allowing it to be reviewed under another account.

`review()` accepts only captured exact thread IDs and returns the existing frozen
coordinator review with Standard speed, one worker and reactions off. It does
not approve that review, open tabs, start Unsend, or store action authority.
The execution capability remains false. Current tests use native-shaped DOM and
controlled account evidence; no authenticated deletion is performed or claimed.

## Captured conversation navigation

After discovery, both adapters expose `createNavigator({ expiresAt })`. The
deadline must be explicitly supplied, finite, in the future and no more than
20 minutes away. It is a new navigation deadline, not restored cleanup authority.

```js
const navigator = discovery.createNavigator({ expiresAt: Date.now() + 10 * 60_000 });
try {
  await navigator.navigate(review.threadIds[0], { signal: stopController.signal });
  // A separate controller must revalidate and authorize the reviewed cleanup.
} finally {
  navigator.stop();
}
```

The navigator accepts only thread IDs captured by its discovery instance. An
already-open exact thread needs no click only when its pane retains private proof
from this navigator's prior verified transition. Otherwise it uses the observed native
inbox link, restores the captured section and scroll position, and reacquires
the native row. An exact native thread link is sufficient; a button requires a
unique unchanged captured fingerprint, including across other captured windows.
It clicks once and returns `{ accountId, threadId, verified: true }` only after
the resulting route matches and the previous message panes have detached. It
requires one fresh visible message pane, stable native message controls, no
transplanted controls from the previous pane, and no loading indicators. A URL
change alone cannot authorize cleanup against the old conversation's DOM.
It never manufactures a link, changes browser
history directly, or derives thread IDs from participants.

Row references and matching text stay inside the discovery closure. They are
not returned in snapshots, saved in storage, or emitted in diagnostics. A
changed preview without an exact native link, missing row, duplicate match or
wrong resulting route stops navigation. The wrapper reports `needs-attention`;
it does not silently rediscover or widen the reviewed inventory.

Account drift, restrictions, expiry, cancellation, freeze and pagehide revoke
the navigator. Only one navigation may run at a time. Creating a replacement
navigator revokes the previous one. Call `stop()` when the controller finishes
to release lifecycle listeners and the expiry timer. Browser restart loses
private row evidence; restored metadata cannot recreate it or action authority.

No exact native thread-marker attribute or empty-chat marker has been established.
If Instagram reuses the old pane or exposes an unproven empty pane, navigation
stops before the runner with `conversation-pane-unverified`. Native acceptance
must resolve these layouts before broad inbox coverage can be claimed.

### Navigation acceptance

- Implemented: private capture-to-route mapping, exact native-link or unique-row
  navigation, route verification, bounded waits, lifecycle revocation and the
  userscript wrapper API.
- Fixture-verified: replaced rows/windows, scroll restoration, changed and
  duplicate previews, already-current thread, wrong routes, independent expiry,
  account/restriction changes, cancellation, lifecycle interruption and metadata
  privacy.
- Not yet accepted: current authenticated Instagram navigation and the complete
  review-to-Unsend controller flow. This module neither removes messages nor
  enables Ghost execution by itself.
- Next owner: same-tab controller integration. Require account-bound review,
  exact-thread revalidation before every mutation, Stop handling, then bounded
  disposable-message acceptance. Multi-tab execution remains separate.
