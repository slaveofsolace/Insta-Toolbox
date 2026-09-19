# Source audit

This document records the external source versions reviewed for the current migrations and adapter boundaries. Source review does not imply wholesale code inclusion.

## Instagram Helper

- Repository: <https://github.com/pishangujeniya/instagram-helper>
- Reviewed revision: `5853d856a18a395aab7c8b8c7e3633175e23ddaf`
- License: MIT
- Relevant data: local message data containing `allMessagesItemsArray`

Adopted:

- Recognition of the archived message-data shape
- Preservation of conversation, sender, timestamp, type, and content fields
- Explicit migration dispositions for malformed or duplicate records

Rejected:

- Coupling the current PWA to archived server routes or templates
- Reusing obsolete authenticated request behavior
- Treating legacy DOM assumptions as current Instagram selectors

## SimpleInstaBot

- Repository: <https://github.com/mifi/SimpleInstaBot>
- Reviewed revision: `5eed7e4ac7ac7db6922eb9e5ed6db36ad9f18fca`
- License: MIT
- Relevant data: per-owner followed, unfollowed, and liked-photo history files

Adopted:

- Migration of followed/unfollowed history into non-actionable queue history
- Preservation of timestamps, owner context, and outcome metadata
- Explicit unsupported-record reporting for liked-photo history

Rejected:

- Credential entry or persistence
- Reusing browser-session files
- Fingerprint rotation
- Unreviewed page automation
- Conversion of historical records into fresh actions

## Follower/following checker Gist

- Reference: <https://gist.github.com/abir-taheer/0d3f1313def5eec6b78399c0fb69e4b1>
- Reviewed revision: `3876d9a67bc8255a79990a1616c20cae296d7194`
- License: no explicit license identified
- Relevant data: `PeopleIDontFollowBack` and `PeopleNotFollowingMeBack`

Because no license was identified, source code was not copied. The project independently implements normalized set comparison.

Saved checker results migrate as partial, read-only reports. They do not contain a complete snapshot and cannot create queue actions.

### 2026 pagination review

The 3.1.3 review compared the independent reader with current public examples
and maintained client implementations:

- The original Gist pages with `count=50`, `max_id`, the Instagram web app ID,
  and 800–1500 ms pacing.
- [OpenCLI issue 1831](https://github.com/jackwener/OpenCLI/issues/1831) and
  [pull request 1835](https://github.com/jackwener/OpenCLI/pull/1835), which
  document current 400 responses for oversized page counts and the use of
  50-row cursor pagination.
- The current
  [instagrapi relationship reader](https://github.com/subzeroid/instagrapi/blob/master/instagrapi/mixins/user.py),
  which uses the follow-list surface parameters and recognizes
  `should_limit_list_of_followers` as a platform-limited response.
- [Meta's public Instagram API collection](https://www.postman.com/meta/instagram/folder/23987686-22b3a5b0-4a51-449a-9299-e3667d69b182),
  which exposes relationship counts but not a supported endpoint for
  enumerating a personal account's complete follower identities.

Adopted independently:

- One bounded cursor traversal per list
- Current same-origin follow-list parameters and web request headers
- Explicit handling for a platform-limited list or a missing next cursor
- Exact profile-count reconciliation before a list is marked complete

Rejected:

- Repeating a complete list scan to combine changing memberships
- Treating a profile total as proof that every identity is available
- Treating partial differences as confirmed non-mutuals. Partial captures can supply explicitly reviewed Follow / Unfollow targets with an uncertainty notice.
- Claiming the private web route is a stable public Instagram API

## instagram-dm-unsender

- Repository: <https://github.com/thoughtsunificator/instagram-dm-unsender>
- Reviewed tag: `v0.7.2`
- Reviewed revision: `a8d7b4d9b76967f54cd9890fc3b1e0bb9c1b8d6a`
- Supplied artifact SHA-256: `2DC5D357B6C3BBFE1F9E10E8D2F9252E7446C490FB3C16DF1B59719CB1D1FE2C`
- License: MIT
- Author: Romain Lebesle

The supplied userscript bundle and embedded source map were reviewed. The map
contained 21 original modules. After normalizing source-map paths and line
endings, all 21 embedded `sourcesContent` entries matched the corresponding
upstream `v0.7.2` source files (21/21).

Adopted as independent adapter behavior:

- Abortable execution
- Localized exact-label matching for Unsend
- Reinspection immediately before a destructive step
- Post-action disappearance verification

Rejected:

- Selecting every right-aligned rendered row
- Treating visual alignment as durable sender identity
- Generic first-button confirmation
- Broad retry loops after blocks or uncertain outcomes
- Mass execution without an exact conversation, reviewed choices, cancellation
  and verified outcomes

The source has no durable job state that can be migrated. `src/migrations/instagram-dm-unsender.js` therefore records a stateless migration report and requires manual creation of reviewed jobs from imported message data.

The original exact-message adapter requires a stable rendered message ID,
timestamp and content digest. The later thread runner also supports native
messages without export-style IDs. It resolves the open thread, checks the
outgoing message layout, opens a newly surfaced Unsend control and verifies
removal. The userscript and same-tab inbox cleanup share that runner.

### 4.0.1 reliability review

Reviewed upstream revision: `08b8874964c6edfec828056bafb84c96d94f0a27`.
The MIT license remains unchanged; its SHA-256 is
`eaceaf5c94a0e02de450666b222e3e6e5589d1704ad6f568169434c5729a851e`.
The review covered `src/ui/default/dom-lookup.js`, `ui-message.js`,
`unsend-strategy.js`, `default-ui.js`, `ui-messages-wrapper.js`,
`src/uipi/uipi-message.js`, and their related tests and documentation.
No upstream source was imported or executed in this review.

The existing hover/retry behavior already covers the upstream pointer and
mouse-event sequence. Replacing the complete engine would reintroduce broader
ownership matching and first-button dialog selection. Upstream also marks a
message as unsent after its dialog closes, before verifying the row disappeared;
that marker can suppress its later retained-row failure check. Dialog closure
alone is not reliable removal evidence.

A local defect was found instead: every native ID-less removal required two
surviving message neighbors. Short conversations could therefore remove a
message but stop with an uncertain result. The repair uses exact remaining
native message identities for a short, non-scrollable list while retaining
the existing anchored proof for virtualized lists. It does not accept edited
text, recycled slots, loading transitions or an optimistic removal that returns
during settlement.

### 4.1.4 retained-row and retry review

The pinned `08b8874964c6edfec828056bafb84c96d94f0a27` source was reviewed again
for its per-message retry and virtual-list traversal behavior. The useful
behavior is a bounded retry of the same mounted row before the traversal moves
on. The project keeps its stricter sent-message ownership, exact native menu and
dialog binding, and verified-removal accounting instead of copying the
upstream right-alignment and dialog-closure assumptions.

The repaired runner now distinguishes three outcomes: verified removal; an
exact unchanged row that may be retried; and a recycled or otherwise
unprovable row. Direct cleanup checks the rest of the conversation after the
third outcome and finishes with attention required. Managed Ghost workers keep
their existing stop-on-uncertainty behavior.

Thread identity comes from the exact conversation route, not its display name.
An absent profile link, a group title or the label “Instagram user” is not a
reason to reject an otherwise proven outgoing message. That label alone does
not establish whether an account blocked someone or was deactivated. Neither
the inspected upstream tests nor the local fixtures prove current authenticated
compatibility for those account states.

### 4.1.2 retained-slot review

The same pinned upstream revision was compared again after Instagram retained
an outer virtual-list slot while removing the confirmed native message group
inside it. The upstream one-at-a-time hover, exact Unsend menu, confirmation,
and adaptive pacing remain useful sequencing references. Its visual ownership
heuristic and fixed-delay disconnection check remain intentionally rejected.

The local adapter now accepts the retained slot only after the exact confirmed
native group detaches, exactly one matching payload disappears, the message
window stays anchored, an adjacent exact message remains when one exists, and
the result stays stable. Duplicate text, payload remounts, missing confirmation
settlement, loading states, and unrelated row recycling remain uncertain.

## License boundary

MIT notices for reviewed MIT projects are retained in `THIRD_PARTY_NOTICES.md`. The implementation uses new local-first modules and does not vendor the reviewed applications. The unlicensed Gist is referenced only for provenance; its source is not included.
