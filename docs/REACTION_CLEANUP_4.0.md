# Own-reaction cleanup

## Status

**Disabled on every surface.** The settings preference and separate reaction counter are present, but there is no native reaction-removal adapter. Message Unsend does not remove reactions added to surviving messages.

The missing capability is a verified way to distinguish the signed-in account's reaction from another participant's reaction and resolve Instagram's exact removal control. No authenticated reaction interaction or disposable-message mutation has been performed for this change. Right alignment, the message author, and the presence of an emoji do not establish reaction ownership.

| Surface | Current behavior | Fallback |
| --- | --- | --- |
| Tampermonkey | Setting disabled; effective preference is false | Remove the reaction through Instagram |
| Extension | Setting disabled; effective preference is false | Remove the reaction through Instagram |
| Desktop / PWA | No authenticated Instagram worker runtime | Open the conversation in Instagram |

## Source and evidence

- `extension/cleanup-settings.js`: validates the saved preference; `capabilities()` reports no reaction support and `effective()` keeps it off.
- `extension/overlay/shell.js` and `userscripts/src/toolbox-shell.js`: disabled control with a specific explanation.
- `extension/action-labels.js`: shared message runner and message-only ownership/removal checks. These checks are not reaction-ownership proof.
- `extension/content-instagram.js`: exact-message inspection and message actions share the runner's ownership and settled-removal helpers; no own-reaction resolver.
- `extension/inbox-coordinator.js`: separate message/reaction counters and review binding. This state contract does not provide a native reaction implementation.
- `tests/dm-foundation-v4.test.js`: received-message protection, recycled-row evidence, settlement, and Stop behavior in fixtures. These are not reaction acceptance tests.

The source audit found no existing reaction adapter to reuse. Native interaction remains unverified; no guessed selector or generic emoji toggle has been added.

## Adapter contract

The next adapter must expose read-only discovery, exact resolution, one removal attempt, and result verification. It must carry the approved account, exact thread, stable message identity or equally strong local evidence, selected reaction, explicit ownership evidence, expiry, and cancellation signal. Store identifiers and counters rather than message bodies.

Before a click, resolve all five independently: conversation, message, reaction, current-account ownership, and native removal action. If any are ambiguous, skip with a reason. A message sent by somebody else may be eligible for reaction cleanup, but is never eligible for Unsend.

After a click, verify that the selected own reaction is absent, the message remains, and other participants' reactions remain. Count only verified removals. A lost acknowledgment or uncertain outcome must stop for reconciliation, never trigger a blind retry.

Run a bounded second traversal only after the approved message pass settles. Keep reaction counts separate. Repeated passes must be idempotent. A reaction without its own trustworthy timestamp cannot be selected by date using the message's timestamp.

## Next step and release criterion

**Responsible owner: runner/reactions.** First inspect the current native interaction read-only. Then obtain fresh approval naming a disposable conversation and exact reaction-removal targets. Approval for message Unsend does not implicitly cover this test.

Use disposable examples covering an own reaction on a received message and a shared emoji with another participant. Record sanitized control names and ownership evidence; do not retain private bodies or account identifiers. If removal cannot be distinguished from adding/changing a reaction, retain the disabled setting and record the unsupported state.

Before enabling the feature, require tests for:

- Shared emoji, grouped reactions, Unicode variation selectors, and skin-tone variants.
- Own reactions on received and sent messages; another person's reactions always retained.
- Localized controls, ambiguous ownership, recycled rows, and already-removed reactions.
- Cancellation before each asynchronous boundary and accurate settlement after dispatch.
- Idempotent repeated passes, wrong-thread/account changes, expiry, challenges, and rate limits.
- Message preservation, separate verified counters, and no message-timestamp substitution.

Enable only after fixture tests and specifically authorized disposable-content acceptance pass on each claimed browser surface. Until then, the preference UI and coordinator counter remain implemented plumbing, not an implemented cleanup feature.
