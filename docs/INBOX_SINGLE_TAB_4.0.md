# Serial inbox cleanup

`extension/inbox-single-tab.js` connects reviewed conversations to the existing
Unsend runner. It navigates one Instagram tab and processes one conversation at
a time. It does not implement another deletion engine or open worker tabs.

## Review and execution

Create a review with `createSingleTabInboxReview(input, now)`. Required content:

- Exact signed-in account key and ordered thread IDs.
- `messageWindow: 'during-run'`.
- Message choice: `all`, `newest`, or `oldest`; a finite limit for the latter two.
- Standard pacing and expiry.
- One worker and one simultaneous mutation.

The review is version 2 and records
`arrivalPolicy: 'include-sent-while-running'`. The confirmation must explain:
**Messages sent while cleanup is running may also be removed.** It must not
describe this choice as a historical cutoff. Old historical reviews, unknown
message windows, Fast pacing and reaction cleanup are rejected by this adapter.

`createSingleTabInboxController(options)` takes these trusted runtime adapters:

| Adapter | Contract |
| --- | --- |
| `runner` | Existing `InstaToolboxDmThreadUnsender` with `createPlan` and `start`. |
| `inspectCurrent()` | Synchronous verified account ID, private document ID, current thread ID, usable state and restrictions. Promise results are rejected. |
| `navigate({accountId, threadId, expiresAt, signal, assertCurrent})` | Native same-tab navigation to the exact reviewed thread. Check the signal, elapsed deadline and supplied guard before each navigation control; resolve only when the thread is ready. |
| `locks` | Native Web Locks manager. No lock-free fallback. |
| `save(checkpoint)` | Durable local metadata storage. Store no message bodies, tokens or session data. |
| `now()` | Optional clock; defaults to `Date.now`. |

The native navigator can be wrapped around
`createNavigator({expiresAt}).navigate(threadId, {signal})`; its own guard must
enforce the same current account and lifecycle checks.

The controller exposes:

- `reviewKey()` and `approve(exactKey)`, which returns a runtime-only token after
  the confirmation. The caller must keep this token in the isolated runtime.
- `start(token)`, once. A copied token or serialized review cannot authorize it.
- `pause()`, `stop()`, and `skip()` for the current conversation.
- `snapshot()` and `subscribe(listener)` for progress.

Pause revokes the current approval. **Review remaining to resume** presents a
fresh confirmation for pending or partially completed conversations in the
currently discovered inventory. Completed, skipped, failed and uncertain
conversations are not silently retried. After reload, Find conversations must
establish navigation evidence again. `restored` checkpoints
are available for inspection only; they cannot approve or start a run.

## Single-flight and outcome handling

The controller acquires the shared exclusive Web Lock
`insta-toolbox:account-activity:<accountId>`. A busy lock rejects the run instead
of queuing a delayed destructive job. The lock grants no action authority.

Each message goes through the coordinator and the runner's private worker
adapter. Account, document, conversation, restrictions, expiry and current
approval are rechecked before native controls. The runner remains responsible
for ownership, exact menu selection and removal proof.

ID-less messages are allowed only under the explicit during-run review and the
original controller token. They never acquire an invented timestamp or a
historical identity. The adapter is not exposed as a page-message operation.

Stop and Skip prevent another action while allowing a dispatched action to
settle. A verified removal stays counted even if its checkpoint fails. An
uncertain removal stops the queue and remains uncertain for reconciliation.
An adapter timeout does not release the account lock while a native promise is
still pending. No second controller may replace that operation in the meantime.

Stopped or paused tasks become durably partial only after their native work has
settled and no uncertain mutation remains. Discovery completeness is preserved
from the review; finishing the reviewed inventory does not establish that the
entire Instagram inbox was discovered.

## Acceptance and remaining integration

Implemented: same-tab serial controller, explicit message-window review,
runtime token, shared lock, progress, interruption handling, durable coordinator
checkpoints and runner worker-adapter integration. The userscript panel connects
native discovery, selection, exact confirmation, navigation and the existing
runner. It exposes Pause, reviewed Resume, Skip and Stop all, with current results
separate from storage success. A failed save prevents another run in that runtime.
Reload never resumes execution or restores approval.

Deterministic tests cover multiple threads, ID-less candidates, account-lock
collisions, Stop, Pause, Skip, context drift, expiry, replay, storage failure and
late uncertain settlement. These tests do not establish current authenticated
Instagram compatibility.

Remaining acceptance:

1. Verify the complete generated userscript flow and rendered controls.
2. Verify same-tab navigation and read-only context checks in the current
   Instagram layout.
3. With fresh disposable-target authorization, verify one removal in each of
   two reviewed threads, then Stop and Skip without touching other threads.
4. Verify a suspended/background tab settles or reports interruption without
   stealing focus. Browser closure and computer sleep are not supported run
   environments.

Managed tabs, parallel mutations, inbox reaction cleanup, and automatic resume
are unavailable in this controller. All account-action surfaces must use the
same trusted account key and activity lock before cross-surface exclusivity can
be claimed. Do not equate different username and numeric-ID lock keys.
