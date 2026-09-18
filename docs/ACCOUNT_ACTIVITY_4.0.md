# Shared account activity

Status: the generic arbiter is implemented and fixture-tested. The userscript
production path uses its compatible account-scoped Web Lock name so Presence
and Ghost cannot overlap in the same origin and browser profile. A private
cross-tab broker is not implemented.

## Userscript integration

`extension/presence-session.js` and `extension/inbox-single-tab.js` both hold
`insta-toolbox:account-activity:<account-key>` for the full reviewed session.
The account key is derived from the verified signed-in username. A second mode
receives no lock and performs no action. The current mode releases the lane
only after its active operation settles.

This integration does not restore authority after reload, coordinate separate
browser profiles, or claim exactly-once behavior across a crash. Presence and
Ghost keep separate confirmations, targets, and expiry. Managed worker tabs
remain unavailable.

## Contract

`extension/account-activity.js` supplies a browser-neutral account arbiter. A
trusted runtime injects one private Web Locks-compatible manager, asynchronous
and synchronous context inspectors, optional settlement persistence, and an
optional read-only reconciliation adapter. It does not approve action targets,
discover accounts, schedule routines, or click Instagram controls.

Each acquisition binds one account, `presence` or `ghost`, job, numeric tab ID,
document ID, and finite expiry. The returned lease is an opaque, frozen object.
Only its originating arbiter recognizes it. JSON, snapshots, imports, matching
strings, and another instance cannot recreate the lease.

The account lock is exclusive and requested with `ifAvailable: true`. Requests
do not queue, steal a lock, or replace an owner based on a missed heartbeat.
Instances sharing the same private manager also share an in-memory ownership
record. It stays reserved when a native lock is lost while earlier work is
unsettled.

### Runtime API

| Operation | Behavior |
| --- | --- |
| `acquire(binding)` | Claims the account after a synchronous context check; fails if busy. |
| `run(lease, { actionId, execute })` | Allows one action at a time, rechecks context, and consumes the action identity before invoking the executor. |
| `pause(lease)` / `stop(lease)` | Revokes future dispatch immediately; holds ownership until dispatched work and persistence actually settle. |
| `snapshot(lease)` | Returns metadata, never authority. Includes verified count, unresolved outcome, and logical/native lock state. |
| `reconcile(lease)` | Uses the injected trusted adapter to resolve a settled but uncertain action or failed checkpoint. It never dispatches another mutation. |

The executor receives an abort signal and a synchronous `assertCurrent` guard.
It must call that guard immediately before each native control and retain the
existing exact-target, ownership, scope, pacing, and postcondition checks. A
Promise returned by the synchronous context inspector is rejected. The arbiter
cannot make arbitrary injected JavaScript safe if it ignores this contract.

Entering the executor is conservatively treated as possible dispatch. A thrown
error or result without `verified: true` leaves the account reserved for
reconciliation. There is no automatic retry. If a confirmed removal's checkpoint
fails, its verified count stays intact and is not incremented again during
reconciliation. Persistence must be idempotent by job and action identity.

Pause, Stop, expiry, account/document change, and lock loss invalidate every
captured grant. An already dispatched operation may still prove its result. Its
late acknowledgment never restores authority. Acquiring another mode requires a
new, separately reviewed scope after the old operation settles and any
uncertainty is reconciled. There is no resume method that revives an old lease.

Expiry is checked against wall-clock time before dispatch, not just by a timer.
A frozen tab cannot regain permission merely because its expiry callback did
not run. A never-settling executor or persistence callback retains ownership;
the runtime must show needs-attention rather than replace it speculatively.

## Trust and lifecycle limits

- Web Locks are scoped to an origin and storage partition. An extension service
  worker, page-origin userscript, separate browser profile, and desktop workspace
  do not automatically share one lock manager.
- Same-origin page code can occupy a lock or request `steal: true`. Opaque leases
  prevent forged authority, but raw page-origin locks are not a production
  broker resistant to malicious page interference. Lock loss revokes grants;
  it cannot undo an external action already dispatched. Production integration
  requires a private trusted broker shared by both modes.
- The in-memory owner record protects participating instances using that exact
  manager object. It is not a cross-world, cross-process, or cross-device lock.
- Browser termination can release native locks while an external mutation has
  an unknown result. Restart must load metadata only, inspect unresolved work,
  and require new review. This module does not promise exactly-once execution
  across a crash or provide a restart broker.
- Snapshots and settlement records contain account/job/document identifiers.
  Keep them in trusted local storage; sanitize public diagnostics. No credentials
  or message bodies are required by this contract.

## Verification

Run `node --test tests/account-activity.test.js`.

Focused fixtures cover competing Presence/Ghost starts, separate instances and
manager wrappers, independent accounts, forged/imported leases, exact context,
per-action replay, one in-flight operation, pause during inspection, Stop during
dispatch, frozen expiry, late execution and persistence acknowledgment, uncertain
outcomes, failed storage, reconciliation, native lock loss, and stale grants.
These are deterministic adapter tests, not authenticated browser acceptance.

## Codex-Handoff

| Item | Current behavior and missing capability | Next step / owner | Release criterion |
| --- | --- | --- | --- |
| Trusted broker | Userscript Presence and Ghost share one origin-scoped Web Lock; same-profile overlap is rejected. Ghost worker tabs coordinate through private userscript storage and value-change listeners; page messages cannot mint authority. Cross-profile coordination is not supported. | Browser integration: retain stale-worker, lost-manager, and account-switch rejection as Instagram changes. | Two isolated runtime instances collide safely. One to five reviewed Ghost worker tabs are fixture-tested; authenticated cross-tab lifecycle acceptance remains required. |
| Exact action wiring | Presence and Ghost hold the shared lane while their existing exact-target adapters execute. Each adapter rechecks account, target, expiry, Stop, and postcondition. | QA: keep the lane and per-action guards covered together as native layouts change. | Account switch, expiry, Stop, and an occupied lane block the next mutation. Implemented for the userscript. |
| Restart reconciliation | In-memory leases deliberately do not survive restart. No crash-recovery authority is implemented. | Browser integration: persist minimal idempotent outcomes through trusted storage and implement read-only reconciliation. | Lost acknowledgments, interrupted writes, browser crash, and service-worker restart restore metadata only; no blind retry. Proposed. |
| Native acceptance | No Instagram action is performed by the account-lane tests. | QA: test source-matched fixtures first, then separately approved disposable targets in supported runtimes. | Verify native outcomes and interruptions; preserve unresolved outcomes. No current live support claim yet. |

Related contracts: [Presence coordination](presence/CODEX_HANDOFF.md#9-presence-and-ghost-coordination),
[Inbox cleanup](INBOX_CLEANUP_4.0.md), `extension/inbox-coordinator.js`, and
`extension/inbox-runtime.js`.
