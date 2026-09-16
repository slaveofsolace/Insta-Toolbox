# Inbox cleanup: implementation and acceptance

## Current status

The userscript now connects native conversation discovery, selection, exact confirmation, and a serial same-tab controller to the existing Unsend engine. Pause, Skip, Stop, interruption recovery, and recent-job storage have deterministic coverage. This development path still needs authenticated inbox acceptance; a fixture pass is not proof of current Instagram compatibility. See [Serial inbox cleanup](INBOX_SINGLE_TAB_4.0.md).

The extension tab-pool and metadata runtime remain unregistered in `background.js`; managed tabs are unavailable. The userscript adds no grants and does not open worker tabs or collect sessions. Discovery opens selected native conversation controls and may mark conversations read; its acknowledgment is separate from Unsend approval.

`extension/inbox-worker.js` now connects coordinator admission to the existing
runner through an optional per-message adapter. It verifies the reviewed cutoff
and current identity before dispatch, checks authority at native action
boundaries, and records only verified outcomes. This connection passes unit tests
and a real hidden Chromium fixture. Production context inspection, runtime
registration, native discovery, and managed-tab orchestration are still missing;
the adapter is not an enabled Ghost mode.

## Source audit

| Surface | Existing runtime | Missing integration |
| --- | --- | --- |
| Extension | Manifest V3 service worker, Instagram content scripts, `storage`, `tabs`, and `scripting` permissions. Single-thread reservations live in memory; verified ledger checkpoints survive worker restart without restoring authority. | Inbox discovery/review, exact-tab authenticated message routing, exclusive coordinator ownership, managed-tab lifecycle, runner mutation adapter, and lifecycle acceptance. |
| Tampermonkey | DOM sandbox, `GM_getTab`, `GM_saveTab`, `GM_getValue`, and `GM_setValue`. Single-thread runner in the Instagram tab. | No granted tab-opening or cross-tab change-listener APIs. No accepted authenticated worker protocol or atomic cross-tab coordinator election. |
| Desktop | Sandboxed local `insta-toolbox://app/` workspace; external links open in the system browser. Its content policy restricts connections to itself. | No authenticated Instagram worker runtime. Desktop packaging is not browser automation. A separate session/isolation design is required. |

Reviewed files: `extension/manifest.json`, `extension/background.js`, `extension/action-labels.js`, `extension/content-instagram.js`, `userscripts/src/metadata.txt`, `userscripts/src/toolbox-shell.js`, and `desktop/main.mjs`.

Chrome service workers can terminate, so durable state must not depend on globals. [Service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
Chrome exposes distinct frozen and discarded tab states; a frozen tab cannot execute handlers or timers. [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).
Tampermonkey documents tab-opening and storage-listener APIs, but their existence does not establish permission, isolation, atomicity, or compatibility in this build. [Tampermonkey API](https://www.tampermonkey.net/documentation.php).

## Implemented coordinator contract

- A review freezes the account ID, deduplicated ordered thread IDs, message scope/limit, speed, own-reaction choice, worker count, reviewed time, expiry, discovery sections, and discovery completeness. Unknown settings are not copied into state. Prototype-backed records are rejected.
- One to five workers receive stable thread assignments. Contiguous groups remain the default; optional fixed batches wait for the current wave to settle. The native tab-pool adapter still supports only one or two tabs. Additional workers are not enabled in the product.
- Claims are serialized within one coordinator instance. A worker holds one thread lease. Lease identity and generation are memory-only; copied or stale leases fail.
- Mutation admission shares one serial queue and account-level next-action deadline. Execution remains serial by default. Optional overlapping execution requires a separately reviewed concurrency setting and a trusted, expiring runtime capability; no production runtime provides that capability yet. See [Batching](INBOX_BATCHING_4.0.md).
- The adapter must prove the current account, exact thread, exact target, ownership, and reviewed message boundary before dispatch. Received-message ownership cannot be inferred from a reaction. Reactions require their own proof and approved scope.
- A pending marker is durably saved before dispatch. Storage failure stops execution. Only verified outcomes increment separate message/reaction counters.
- Stop/Pause revoke authority immediately, including while the queue is awaiting inspection. An already dispatched operation settles as verified or uncertain; Stop never invents a zero-removal outcome.
- An unknown outcome pauses the job and prevents another mutation. No blind retry, success claim, or exactly-once claim follows a lost acknowledgment.
- Inspection and dispatch acknowledgments have bounded deadlines. An inspection timeout cannot dispatch an action; a dispatch timeout remains uncertain, even if its callback eventually returns. Timers and abort listeners are released on settlement.
- Restart restores metadata only, pauses the job, and treats an interrupted mutation as uncertain. Approval and lease objects are never restored. Expiry uses elapsed wall-clock time rather than timer callback counts.
- Missing heartbeats never trigger reassignment. Retirement requires the trusted runtime to prove the old worker terminated and reconcile any in-flight uncertainty. The core skips the retired thread rather than silently restarting its contents. Remaining pending threads need fresh approval.
- Completing every selected thread does not change the discovery-completeness flag. A partial inbox inventory must remain visibly partial.

The save adapter must atomically replace one job checkpoint in private local storage. The browser-neutral module provides serialization **inside one instance only**. A runtime must prevent two live coordinator instances. It must not call this API directly from page-writable messages or treat persisted JSON as action authority.

`retireWorker` receives trusted adapter evidence; a page-supplied `terminated: true` or `reconciled: true` is not evidence. Likewise, the mutation adapter is responsible for exact control resolution immediately before the native click and for postcondition proof afterward.

## Read-only discovery collector

`extension/inbox-discovery.js` reads already-rendered anchors from a supplied inbox container. It accepts only the exact `https://www.instagram.com/direct/t/<digits>` origin/path, excludes hidden/detached rows, accumulates stable IDs across recycled row windows, and records section provenance without names or message previews. Cancellation, account switching, and sample/thread bounds preserve the collected inventory with an incomplete status.

This collector neither clicks nor scrolls. It does not claim that the mounted rows represent the full inbox. Completion requires a trusted native-terminal adapter with account/section-specific stable evidence and no pending load. **No native-terminal adapter ships yet**, so default results remain partial. Repeated last rows or a quiet viewport are not accepted as completion. The current fallback is to keep using the open conversation while discovery/navigation integration is developed.

A read-only Chrome inspection on September 16, 2026 found a native container
labelled `Thread list`, Primary/General/Request tabs, and button-based rows. In
that loaded container there were no `/direct/t/` anchors; eight sampled
buttons exposed no `data-*` attributes or descendant thread links. This is direct
evidence that the current anchor collector cannot discover that inbox. It is not
evidence that the inbox is empty or that no alternate native identity exists.
No conversation was opened and no private identifiers, previews, or screenshots
were retained. Opening unknown rows merely to learn their URL may mark them read,
so it is not an accepted substitute for the requested non-changing discovery.

## Message-arrival boundary

The frozen review uses `skip-after-review-or-pause`. The adapter must skip messages demonstrably newer than review. If it cannot establish that a target belongs to the reviewed history, it pauses rather than adding that message to scope. The current single-chat streaming runner does not yet provide this guarantee for all message types without stable IDs/timestamps. Inbox cleanup therefore remains disabled until this adapter and limitation disclosure are accepted.

No raw message bodies are stored by the coordinator. Durable fields are reviewed account/thread identities, settings, statuses, counters, interruption reasons, and the in-flight thread/kind marker. These records are private local data and must not enter public diagnostics, screenshots, or Git.

## Managed extension tabs and fencing proposal

`extension/managed-inbox-tabs.js` wraps injected Chrome tab methods without registering any runtime listeners. It creates at most two inactive tabs, reuses them for their frozen assignment groups, never sets `active: true`, and removes only tab IDs returned by this adapter instance's own creation calls. A timed-out create request that returns late retains ownership and closes only that returned tab. Closure failure remains visible.

Readiness requires an exact owned tab, reviewed numeric thread URL, extension ID, top frame, browser-provided document ID, and a one-use memory challenge. A trusted isolated-world inspection must independently confirm account, thread, document, usable evidence, and absence of restriction signals. A page payload containing an account name or `ready: true` is not proof. Copied handles, stale generations, and repeated challenges fail. Frozen, discarded, closed, wrong-thread, expired, or unusable workers pause; merely inactive workers are allowed by the model. Browser calls and inspection have bounded deadlines.

This is fixture-tested **tab readiness**, not deletion authority. Before connecting it to a runner, the runtime protocol must:

1. Accept only `chrome.runtime` messages whose browser-provided sender matches the registered extension, owned tab, top frame, current document, and reviewed account inspection. Never accept commands from an untrusted page bridge.
2. Keep one coordinator per account and bind every worker to an in-memory epoch. Navigation or worker replacement invalidates the old document and epoch.
3. Request a one-use mutation grant at each exact native action, not once per conversation. Bind it to job, thread, document, account, action identity, epoch, and a short expiry.
4. Let the existing single-conversation runner perform target resolution and verified postconditions; do not add a parallel deletion implementation. Check the current grant immediately before the click and report its exact outcome afterward.
5. Treat coordinator restart as authority loss. Old grants must not become valid simply because checkpoint JSON or a worker heartbeat survives. No grant renewal can happen without a fresh reviewed authorization.
6. Never replace a silent worker by time alone. A previously issued native action may already be in flight. Terminate the exact old document/tab, confirm retirement, and reconcile its last action before another worker can receive the thread. Otherwise keep it uncertain and stopped.

The browser cannot guarantee an atomic transaction spanning its own crash and Instagram's external mutation. The implementation must preserve uncertain outcomes rather than claim exactly-once execution. The full per-click fencing protocol and actual one/two-tab browser acceptance are not implemented by the current pool adapter.

## Metadata runtime service

`registerInboxRuntime` in `extension/inbox-runtime.js` installs one handler for the `insta-toolbox-inbox-` namespace. It is separate from the PWA/page bridge; that bridge must never forward this namespace. The helper rejects duplicate registration in one runtime and releases registration only after queued work has settled on disposal.

Supported operations are `capabilities`, `read`, `review`, `pause`, `stop`, and `checkpoint`. No Start, Resume, approval, mutation, or worker-opening operation exists. Capabilities always reports execution and managed tabs unavailable. Without an accepted native context adapter, account-specific operations return `inbox-context-adapter-unavailable`.

Every operation requires browser-provided extension ID, Instagram sender origin, an exact tab ID, top frame, and document ID. Account-specific operations additionally recheck the actual tab before/after a trusted isolated context inspection. The inspection must prove the current account, document, restriction-free usable page, discovered thread IDs, and section coverage. Request payloads cannot supply account identity, discovery completeness, authority, or checkpoint counters.

Reviews use only a subset of the trusted discovered inventory and are persisted under `instaToolboxInboxReviewV1`. This is one local review checkpoint, not an account-history archive. Reading or replacing a different account's checkpoint is rejected. An interrupted review restores paused metadata without authority; it must be explicitly stopped before replacement. Storage write failure disables further writes in that service instance. Persistence does not open workers or call an executor.

Current blocker: `content-instagram.js` exposes session restrictions but does not yet expose verified stable account identity plus native inbox discovery through a dedicated read-only message. That context adapter must be implemented and accepted before account-specific UI integration. The metadata service tests use an injected fixture inspector; they do not establish that native proof.

## Background behavior

An inactive but loaded Instagram tab is different from a frozen, discarded, closed, or expired-session tab. The planned runtime must allow ordinary tab switching without focus stealing, while loss of usable page evidence produces a paused or needs-attention state. Browser restart and computer sleep do not preserve action authority. No visibility spoofing, fake audio, forced focus, global browser-policy changes, or offscreen-document substitution is used.

`pnpm run qa:background` exercises the actual runner in a hidden Chromium page
with background throttling enabled. Its seven cases cover restored pacing, Stop,
expiry, native page freeze, verified and uncertain actions settling after freeze,
and the coordinator/worker/runner connection. They preserve received messages,
never steal focus, and never restore consumed authority after resume. Account
identity and tab admission are controlled fixture inputs, not authenticated
Instagram evidence. Chrome/Firefox/Tampermonkey acceptance remains separate.

## Tests

`tests/inbox-coordinator.test.js` covers immutable review, invalid/prototype-backed input, exact settings approval, wrong account, duplicate claims, contiguous two-worker assignments, serialized account mutation, shared pacing, target/ownership/cutoff rejection, finite scopes, separate reaction counters, uncertain acknowledgment, Stop during inspection and dispatch, bounded worker response deadlines, elapsed expiry, restart without authority, persistence failure before/after dispatch, stale-worker fencing, and incomplete-discovery reporting.

`tests/inbox-discovery.test.js` covers exact URL identity, recycled rows, deduplication, section provenance, partial/loading states, native-proof validation, abort, account switching, bounds, hidden/detached containers, and defensive snapshots.

`tests/managed-inbox-tabs.test.js` uses injected fake Chrome methods to cover one/two-tab bounds, inactive creation, reuse without focus changes, exact assignment, handshake sender/document/challenge checks, account proof, inactive/frozen/discarded/closed states, restrictions, expiry, own-tab-only closure, closure failure, hung inspection, and cleanup of late tab creation. These are not tests against an installed extension or a real browser process.

`tests/inbox-runtime.test.js` covers exclusive registration, namespace isolation, trusted sender checks, context/discovery binding, metadata read/review/pause/stop/checkpoint, unsupported mutation commands, paused restoration, account switching, storage failures, hung inspection, and rejected injected authority/counters.

These are account-free state-machine fixtures. They do not open two real browser tabs, inspect a real inbox, remove a message/reaction, or prove browser-process crash behavior.

## Remaining engineering

| Item / owner | Missing capability and fallback | Next implementation and release criterion | Status |
| --- | --- | --- | --- |
| Inbox discovery / browser integration | Read-only rendered-link collector exists; native section selection, traversal, and terminal proof do not. Continue using the open conversation. | Connect the collector to actual native inbox containers and bounded traversal; prove section coverage without changing unread state unexpectedly. Keep incomplete status whenever full discovery cannot be proven. | Collector implemented and fixture-tested; native integration absent and disabled. |
| Reviewed serial runner / browser integration + runner | No trusted runtime adapter connects the core to the existing runner or enforces the historical boundary. | Bind one reviewed plan to exact account/thread/scope; use existing deletion engine; prove arrivals, thread switches, cancellation, uncertain outcomes, and no scope widening in fixtures and disposable acceptance. | Core implemented; integration absent and disabled. |
| Metadata runtime / browser integration | Service exists but no accepted native account/discovery context provider or background installation. | Register only the metadata namespace after review; implement isolated read-only context inspection and prove forged page inputs, account switching, stale documents, restart, and interrupted storage cannot produce authority. | Service fixture-tested; not registered; mutations unavailable. |
| Extension worker pool / browser integration | Tab readiness/ownership adapter exists; no runtime registration, accepted isolated inspector, complete per-click fencing, or verified retirement. | Integrate one coordinator and exact sender/tab/document protocol; test one then two real workers, restart, duplicate assignment, closure, freeze, discard, lost acknowledgment, and storage failure. Close only job-created tabs. | Pool adapter fixture-tested; runtime integration absent and disabled. |
| Tampermonkey workers / browser integration | Existing grants cannot open/manage the required tab pool; cross-tab atomicity/isolation is not established. | Review least-privilege API additions and private messaging/election design; prove unauthorized page messages cannot mint authority and suspended workers cannot resume after reassignment. | Proposed; disabled; no new grants. |
| Own reactions / runner + QA | No accepted native removal interaction for current-user ownership on surviving messages. Message ownership is insufficient. | Inspect disposable content with fresh specific approval; implement a separate exact-reaction adapter; verify message and others' reactions survive, including grouped emoji, Unicode variants, localization, recycling, idempotence, and Stop. | Not integrated; disabled. |
| Background lifecycle / browser integration + QA | Core timer simulation does not prove live inactive-tab readiness or browser suspension behavior. | Run source-matched Chrome and Firefox/Tampermonkey fixtures, then approved disposable checks across inactive, throttled, frozen, discarded, closed, expired, sleep, and restart states. No focus stealing. | Unverified; no expanded support claim. |
| Desktop workers / browser integration | No authenticated Instagram renderer/session exists. Keep the local workspace and browser handoff. | Separate isolation/session threat model and permission design before any browser-controller implementation. | Proposed; unavailable. |

No live Instagram mutation is authorized by the development brief. Disposable-message/reaction acceptance requires specific targets and scope before execution.
