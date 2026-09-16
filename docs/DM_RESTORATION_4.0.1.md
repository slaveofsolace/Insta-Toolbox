# DM Unsend restoration

The 4.0.1 development branch repairs two regressions found during native
Instagram testing. It is not a published release.

## Newest-message selection

Instagram groups story replies and quoted replies with separate heading, quote,
and message sections. The previous ownership walk stopped at these branches,
skipped newer sent messages, and selected an older plain-text message.

Ownership now follows the unique native **Message actions** group through the
message lane. A received-message alignment contradiction still rejects the row.
The requested message order takes precedence over whichever row is easiest to
see; an inaccessible newest row is not replaced with an older target.

Read-only inspection of the current Instagram layout confirmed that the patch
recognizes sent story and quoted replies, selects the actual newest sent row,
and rejects the mounted received messages. This is selection evidence, not a
successful live Unsend result.

## Verified removal

The earlier proof required every layout child to remain unchanged. Native
Unsend can remove timestamp wrappers, backfill history, and unmount distant
message groups. A successful deletion therefore produced an uncertain result.

For native messages without stable IDs, the repaired proof checks the detached
target and retained nearby message groups: their DOM identity, content, order,
and scroll context must agree. Unrelated layout changes and distant
virtualization no longer invalidate that evidence. Confirmation must settle,
and a temporary disappearance that reverts is not success.

Changed text, fewer mounted rows, a recycled node, or absence alone is never
removal proof. If a final isolated message has neither retained neighbors nor
a recognized unsent placeholder, its outcome remains uncertain. Do not retry
that message automatically.

## Validation

- Focused regression tests cover reply/story ownership, newest ordering,
  received-message protection, backfill, duplicate text, layout changes,
  loading, scroll changes, and optimistic reversions.
- Standard and Fast one-item fixture runs each verify one removal and one
  ledger update.
- Generated-userscript button flows cover both speeds with native-shaped reply
  and story rows, co-removed timestamps, and older-history backfill. Each case
  selects the newest sent row and reports one verified removal.
- The rebuilt development candidate still needs a successful disposable-message
  run before current authenticated compatibility can be claimed.

The failing live test removed an older sent message and reported zero verified
removals with one uncertain outcome. It is recorded as a failed acceptance gate,
not as a successful test. No private conversation data is included here.

Related source: `extension/action-labels.js`,
`tests/dm-foundation-v4.test.js`, `tests/dm-group-reel-regression.test.js`, and
`tests/dm-native-removal-proof.test.js`.
