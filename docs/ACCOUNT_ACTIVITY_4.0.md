# Shared account activity

Status: implemented and fixture-tested; not connected to production execution.
Presence and Ghost live capability flags remain unchanged.

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
| Trusted broker | Module implemented; no production registration or shared cross-surface manager. Existing inbox runtime remains metadata-only. | Browser integration: choose one private broker and authenticated sender/document adapters; connect both modes through it. | Two real isolated runtime instances collide safely; page messages cannot mint leases. Disabled until accepted. |
| Exact action wiring | Executor guard exists, but no Presence or Ghost native handler calls it yet. | Integration: wrap existing engines, invoke the guard before each native control, and preserve target-specific review. | Account/document switch, expiry, Stop, and mode handoff block the next mutation while settling dispatched work. Unwired. |
| Restart reconciliation | In-memory leases deliberately do not survive restart. No crash-recovery authority is implemented. | Browser integration: persist minimal idempotent outcomes through trusted storage and implement read-only reconciliation. | Lost acknowledgments, interrupted writes, browser crash, and service-worker restart restore metadata only; no blind retry. Proposed. |
| Native acceptance | No Instagram action is performed by these tests. | QA: test source-matched fixtures first, then separately approved disposable targets in supported runtimes. | Verify native outcomes, interruptions, and handoff; preserve unresolved outcomes. No live support claim yet. |

Related contracts: [Presence coordination](presence/CODEX_HANDOFF.md#9-presence-and-ghost-coordination),
[Inbox cleanup](INBOX_CLEANUP_4.0.md), `extension/inbox-coordinator.js`, and
`extension/inbox-runtime.js`.
