# Inbox batches

## Implemented coordinator behavior

The browser-neutral coordinator can plan one to five prepared workers. This is a
preparation limit, not permission to perform five deletions simultaneously. The
default remains one mutation at a time. A separate concurrent-admission path can
hold two to five in-flight actions only with an explicit reviewed limit and an
account-bound, expiring capability supplied by the trusted runtime.

Two assignment modes are available in reviewed coordinator plans:

| Mode | Assignment | When the next conversation can start |
| --- | --- | --- |
| `contiguous` | Each worker receives a fixed consecutive part of the selected inventory. This remains the default. | After that worker finishes its current conversation. |
| `batches` | Each wave contains up to the reviewed worker count, in the frozen inventory order. | After every conversation in the current wave settles and its worker lease is released. |

For ten conversations and five prepared workers, `batches` assigns conversations
1–5 first, then 6–10. The same bounded worker slots can be reused. A short final
batch contains only the remaining approved threads; it does not discover or add
new conversations. Selected-user resolution and inbox discovery both supply the
same frozen thread-ID inventory; the coordinator does not infer identities from
usernames or changing inbox row positions.

An explicit `assignmentMode` or `mutationConcurrency` becomes part of the review
key. Existing reviews without either field retain their original canonical keys
and behavior. Changing either setting requires a new review; approval cannot
silently acquire batching behavior.

`INBOX_COORDINATOR_CAPABILITIES` reports a maximum of five prepared workers and
five concurrent mutations, with a default concurrency of one. Reviews can request
`mutationConcurrency` from one through the prepared-worker count. A coordinator
cannot enable a value above one without a trusted capability containing version,
exact account ID, maximum supported concurrency, and a future expiry. Page
messages, settings, and stored checkpoints must never supply this capability.
No native runtime currently supplies it; public controls must remain disabled.

## Concurrent admission

The opt-in path overlaps adapter execution and removal verification across
different conversations; it does not duplicate the Unsend engine. Each
conversation has at most one in-flight action. All admissions and checkpoint
writes still use one serial state queue and one account-wide pacing deadline.
Starting five workers does not create five independent pacing allowances.

For example, if the account pacing interval is one second and verification takes
several seconds, another conversation can begin after that interval while the
previous one finishes verification. This is overlapping work, not an
instantaneous burst of five clicks. A call made before the shared deadline gets
`account-pacing`; the runtime must schedule its next attempt without multiplying
or bypassing that interval.

Every concurrent action has a durable prepared/dispatched marker before its
adapter executes. The additive `pendingMutations` array records each exact
thread/kind/phase independently. Existing serial jobs retain their original
single `pendingMutation` checkpoint contract. Completion of one action cannot
erase another action's pending marker.

## Interruption and recovery

- A finished worker cannot claim a thread from the next batch while any current
  batch thread remains active.
- Stop revokes authority immediately. Already dispatched work settles as a
  verified removal or uncertainty; queued work cannot dispatch afterward.
- An uncertain outcome or restriction prevents batch advancement and further
  dispatch. Already dispatched actions still settle independently, preserving
  verified removals and each unknown outcome. A missing heartbeat does not retire
  or replace a worker.
- A checkpoint restores metadata, never action authority. Pending mutation
  markers require reconciliation; every interrupted concurrent marker becomes
  uncertain. Stored batch assignments must match the original reviewed order.
  The concurrency capability is never persisted or restored as authority.
- Failed or skipped conversations remain visible in the final partial outcome.
  Completing the selected inventory does not prove full inbox discovery.

## Runtime boundary

This batching scheduler is implemented and tested. It does not open browser tabs,
discover native conversation identities, or call Instagram controls by itself.
The existing managed-tab adapter still supports at most two fixture-tested tabs;
the native runner, per-action worker fencing, and higher tab counts require
integration and acceptance before a usable inbox-cleanup feature can be enabled.
No settings or userscript grants are widened by this coordinator change.

The concurrent admission core is implemented, but native simultaneous cleanup is
not connected or accepted. The trusted runtime must integrate its exact-target
callbacks with the existing runner, prove document/worker fencing at each action,
and demonstrate those properties in the browser before enabling the capability.
There is no claim of exactly-once behavior across a browser crash and an external
Instagram mutation.

## Verification and remaining work

`tests/inbox-coordinator.test.js` covers ten threads in two batches of five,
short final batches, immutable approval, unchanged legacy review keys, shared
pacing across five workers, actual two/five-action overlap, out-of-order
acknowledgments, same-thread collisions, Stop, one failed action while others are
in flight, capability expiry, restriction reports, persistence failure, checkpoint
assignment tampering, and restart without authority. These are deterministic
account-free tests, not authenticated Instagram or background-browser acceptance.

| Owner | Next step | Acceptance criterion |
| --- | --- | --- |
| Browser integration | Resolve the selected or discovered native conversations to stable IDs, then connect reviewed batch claims to the existing runner and owned tab pool. | Exact frozen inventory, no scope widening, only job-created tabs closed, and no stale worker able to dispatch after retirement. |
| Browser integration and QA | Extend the tab adapter beyond two only after source-matched browser tests. | One, two, and five inactive workers, partial final wave, pause/Stop, freeze/discard, closure, restart, and lost acknowledgments preserve ownership and uncertainty. |
| Runner and QA | Integrate the tested concurrent admission core separately from preparation; issue a runtime capability only after acceptance. | Fresh disposable-target approval, measured benefit, account-wide pacing, exact outcomes for every in-flight action, and no restriction bypass. Until then native concurrency remains one. |

No live Instagram action is authorized or performed by these fixtures.
