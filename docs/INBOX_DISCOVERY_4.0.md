# Inbox discovery and export fallback

## Current evidence

The current Instagram inbox inspected on September 16, 2026 renders conversation
rows as buttons without thread links or stable thread attributes. Notes and
conversation rows share button roles, so collecting every button would mix
unrelated controls into the inventory. The existing link collector cannot
identify these rows.

An ordinary inbox reload also produced native thread-detail responses under
`data.get_slide_thread_nullable.as_ig_direct_thread`. The observed structure
contains string `thread_id` and `viewer_id`, boolean `is_group`, and a `users`
array with participant usernames. No conversation was opened to inspect that
structure. This proves that the native application receives thread identities;
it does not prove complete historical coverage or a supported extension or
Tampermonkey transport for those responses.

No message bodies, account identifiers, response payloads, or session data are
included in this record. No requests were replayed, credentials copied, or
private query identifiers embedded in the application.

## Metadata adapter

`extension/inbox-inventory.js` extracts only the expected account ID, thread ID,
participant usernames, group status, and unresolved-participant count. It
rejects account mismatches and unrecognized structures, deduplicates by exact
thread ID, bounds the inventory, and flags changed participant identity instead
of silently replacing a target. Snapshots do not retain messages or tokens.
The discovery inventory lives in memory and has an explicit clear operation.
Runtime integration must clear it when the account changes or discovery is
discarded. Durable job checkpoints remain separate from this temporary cache.

Selected `@usernames` resolve only to unique direct-conversation candidates.
Group chats, multiple matches, incomplete participants, and identity conflicts
do not become an automatic target. Every candidate still requires a live
identity check and a reviewed run; imported or page-provided metadata never
creates action authority.

The adapter is implemented and fixture-tested, but is **not connected to a
native response transport or enabled inbox UI**. Repeated responses and a quiet
viewport do not prove that discovery is complete. Its snapshots always report
coverage as unverified until a separate accepted traversal/completion adapter
can establish section coverage.

## Optional data-download fallback

Meta provides account downloads through Accounts Center. Existing workspace
imports already parse message exports. The new metadata-only inventory parser
can consolidate split conversation files by archive path and retain participant
labels without retaining the message contents.

An export folder such as `inbox/example_123456`, its numeric suffix, a title, or
a display name is **not proof of a live thread ID**. These entries stay unresolved
until matched to a current conversation. The export is a dated snapshot, not a
guarantee that every conversation remains available or that newly arrived
messages are included. Previously unsent messages are excluded by Instagram.

Keep this import optional. Ordinary single-conversation cleanup must not require
an export, pairing, or an account-wide scan. The fallback file-picker/review UI
and live matching are not wired yet.

Sources: [Meta account-download overview](https://about.fb.com/news/2023/10/manage-your-information-across-apps/)
and [Instagram Unsend help](https://www.facebook.com/help/instagram/491370017690934).

## Remaining integration

Browser integration owns the least-privilege native transport and section
traversal. It must distinguish real authenticated application responses from
untrusted page messages, avoid retaining credentials or message bodies, honor
restrictions, and never claim a partial inventory is complete. QA must prove
recycled rows, pagination, interruptions, account changes, group ambiguity,
selected-handle matching, and stale exports. Until then, the current fallback is
single-conversation cleanup; the metadata parser is not a working Ghost mode.
