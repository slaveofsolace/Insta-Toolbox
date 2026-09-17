# Own-reaction cleanup

## Status

**Enabled in the 4.0.1 userscript candidate; disabled on the extension,
desktop, and PWA.** The userscript contains a separate reaction adapter,
bounded message traversal, and follow-up hook after a completed Unsend run.
Ordinary Unsend does not depend on reaction discovery or account resolution.

Native inspection found a reaction-details dialog with an explicit **Select to
remove** instruction on the signed-in account's reaction row. This was observed
on a received message; no reaction was removed. The adapter uses that native
ownership instruction, the exact emoji, and the retained message. Right
alignment, the message author, and the presence of an emoji do not establish
reaction ownership.

The instruction must appear in the observed secondary hint beneath a separate
participant-name span. A display name containing the same words is not
ownership evidence. Loading dialogs cannot prove removal. Other visible
reactors must remain unchanged, and an uncertain attempt cannot be retried by
recreating the adapter or remounting the badge within the same runtime.

| Surface | Current behavior | Fallback |
| --- | --- | --- |
| Tampermonkey | Optional **Remove my reactions afterward** choice; default off | Leave the choice off and remove reactions through Instagram |
| Extension | Setting disabled; effective preference is false | Remove the reaction through Instagram |
| Desktop / PWA | No authenticated Instagram worker runtime | Open the conversation in Instagram |

## Source and evidence

- `extension/cleanup-settings.js`: validates the saved preference; the userscript capability preserves an explicit choice while other surfaces keep it off.
- `extension/overlay/shell.js` and `userscripts/src/toolbox-shell.js`: the userscript exposes the optional choice; unsupported surfaces remain disabled.
- `extension/action-labels.js`: shared message runner and read-only message walker. The walker visits surviving sent and received messages without reusing message ownership as reaction proof.
- `extension/content-instagram.js`: exact-message inspection and message actions share the runner's ownership and settled-removal helpers; no own-reaction resolver.
- `extension/inbox-coordinator.js`: separate message/reaction counters and review binding. This state contract does not provide a native reaction implementation.
- `extension/own-reactions.js`: bounded native reaction-details adapter, exact
  context checks, settled-removal verification, and nonpersistent plan helpers.
- `extension/reaction-cleanup.js`: follow-up pass, cancellation, expiry, separate
  counts, and stop-on-uncertainty settlement.
- `extension/instagram-viewer.js`: corroborates the visible inbox account picker
  with the profile link in Instagram's navigation. This is username-based
  context evidence, not the numeric account proof required by Presence.
- `userscripts/src/toolbox-shell.js`: action-specific reaction choice and
  confirmation binding, completed-message handoff, shared Stop control, and
  separate reaction ledger field. The choice is visible only on a supported surface.
- `tests/own-reactions.test.js`: synthetic native reaction-dialog regressions.
- `tests/dm-message-walker.test.js`, `tests/reaction-cleanup.test.js`, and
  `tests/userscript-reaction-flow.test.js`: traversal and follow-up behavior.
- `tests/dm-foundation-v4.test.js`: received-message protection, recycled-row evidence, settlement, and Stop behavior in fixtures. These are not reaction acceptance tests.

The details interaction and generated-browser removal flow are verified, but a
live authenticated follow-up remains unverified. The adapter does not click a generic emoji toggle to
guess whether it adds or removes a reaction. The current account resolver and
native removal instruction are English-layout adapters; other layouts remain
unavailable until independently verified.

## Adapter contract

The adapter exposes read-only discovery, exact resolution, one removal attempt,
and result verification. Its context is bound to the approved account, exact
thread, retained message, selected reaction, explicit ownership instruction,
expiry, and cancellation signal. Plans exist only in the isolated runtime;
reloading or importing data cannot restore them.

Before a click, resolve all five independently: conversation, message, reaction, current-account ownership, and native removal action. If any are ambiguous, skip with a reason. A message sent by somebody else may be eligible for reaction cleanup, but is never eligible for Unsend.

After a click, verify that the selected own reaction is absent, the message remains, and other participants' reactions remain. Count only verified removals. A lost acknowledgment or uncertain outcome must stop for reconciliation, never trigger a blind retry.

Run a bounded second traversal only after the approved message pass settles. Keep reaction counts separate. Repeated passes must be idempotent. A reaction without its own trustworthy timestamp cannot be selected by date using the message's timestamp.

Only a completed message run can start the follow-up. Stop, uncertainty, failure,
thread/account drift, and expiry do not start another pass. The original review
expires normally; the follow-up does not renew it. An interrupted walker keeps
its operation lock until a dispatched reaction has settled and the controller
closes the walker.

If removal succeeds but Instagram's reaction dialog cannot close, the verified
reaction stays counted and the pass stops for attention. That UI cleanup failure
is not reported as an uncertain removal and does not permit another click.
When an ambiguous or other-person reaction is skipped, the native details dialog
must also close before traversal continues. An ineffective Close stops for
attention with zero reaction removals; it cannot leave a dialog over the next target.

Stable exhaustion means the bounded traversal reached the end of the exposed
conversation. It does not prove Instagram supplied every server-side historical
message. The walker never labels interrupted traversal as complete.

## Next step and release criterion

**Responsible owner: runner/reactions.** Run specifically approved disposable
reaction acceptance against the rebuilt userscript. The userscript capability
and complete confirmation-to-result UI are enabled in the branch candidate;
extension wiring is separate and remains disabled. Approval for message Unsend
does not implicitly cover reaction removal.

Use disposable examples covering an own reaction on a received message and a shared emoji with another participant. Record sanitized control names and ownership evidence; do not retain private bodies or account identifiers. If live removal cannot be distinguished from adding or changing a reaction, disable the candidate capability before release and record the unsupported state.

Before enabling the feature, require tests for:

- Shared emoji, grouped reactions, Unicode variation selectors, and skin-tone variants.
- Own reactions on received and sent messages; another person's reactions always retained.
- Localized controls, ambiguous ownership, recycled rows, and already-removed reactions.
- Cancellation before each asynchronous boundary and accurate settlement after dispatch.
- Idempotent repeated passes, wrong-thread/account changes, expiry, challenges, and rate limits.
- Message preservation, separate verified counters, and no message-timestamp substitution.

Claim authenticated compatibility only after fixture tests and specifically
authorized disposable-content acceptance pass on each claimed browser surface.
The current userscript candidate is fixture-tested; the live claim remains open.
