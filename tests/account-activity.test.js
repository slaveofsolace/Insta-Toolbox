import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountActivity } from '../extension/account-activity.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

class LockManager {
  held = new Map();
  request(name, options, callback) {
    assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
    if (this.held.has(name)) return Promise.resolve().then(() => callback(null));
    const completion = deferred();
    const record = { completion };
    this.held.set(name, record);
    Promise.resolve().then(() => callback(Object.freeze({ name, mode: 'exclusive' }))).then(
      (value) => { if (this.held.get(name) === record) this.held.delete(name); completion.resolve(value); },
      (error) => { if (this.held.get(name) === record) this.held.delete(name); completion.reject(error); },
    );
    return completion.promise;
  }
  lose() {
    for (const record of this.held.values()) record.completion.reject(new Error('lock-stolen'));
    this.held.clear();
  }
}

function environment(overrides = {}) {
  const locks = overrides.locks || new LockManager();
  let clock = 1_700_000_000_000;
  let context = { accountId: 'fixture_account', accountVerified: true, tabId: 7,
    documentId: 'fixture_document', usable: true };
  let timerId = 0;
  const pendingTimers = new Map();
  const timers = {
    setTimeout(callback, delay) { const id = ++timerId; pendingTimers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout(id) { pendingTimers.delete(id); },
  };
  const records = [];
  const adapters = { locks, now: () => clock, timers,
    inspectContext: async () => ({ ...context }), inspectCurrent: () => ({ ...context }),
    onSettled: async (record) => { records.push(record); }, ...overrides };
  const activity = createAccountActivity(adapters);
  return { activity, locks, records, pendingTimers, adapters,
    binding: (patch = {}) => ({ accountId: 'fixture_account', mode: 'presence', jobId: 'fixture_job',
      tabId: 7, documentId: 'fixture_document', expiresAt: clock + 60_000, ...patch }),
    setContext(patch) { context = { ...context, ...patch }; },
    advance(ms, fire = true) {
      clock += ms;
      if (fire) for (const [id, timer] of [...pendingTimers]) {
        if (timer.at <= clock) { pendingTimers.delete(id); timer.callback(); }
      }
    },
  };
}

test('Presence and Ghost simultaneous starts share one account owner across instances', async () => {
  const env = environment();
  const ghost = createAccountActivity(env.adapters);
  const results = await Promise.allSettled([
    env.activity.acquire(env.binding()), ghost.acquire(env.binding({ mode: 'ghost', jobId: 'ghost_job' })),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /account-activity-busy/);
  env.activity.stop(results[0].value);
  await flush();
  const lease = await ghost.acquire(env.binding({ mode: 'ghost', jobId: 'ghost_job' }));
  assert.equal(ghost.snapshot(lease).mode, 'ghost');
  ghost.stop(lease);
});

test('separate manager wrappers still collide through the shared Web Locks manager', async () => {
  const env = environment();
  const other = createAccountActivity({ ...env.adapters, locks: { request: env.locks.request.bind(env.locks) } });
  const lease = await env.activity.acquire(env.binding());
  await assert.rejects(other.acquire(env.binding({ mode: 'ghost' })), /account-activity-busy/);
  env.activity.stop(lease);
});

test('other accounts do not share the same lock name', async () => {
  const locks = new LockManager();
  const first = environment({ locks });
  const second = environment({ locks });
  second.setContext({ accountId: 'second_account' });
  const one = await first.activity.acquire(first.binding());
  const two = await second.activity.acquire(second.binding({ accountId: 'second_account' }));
  assert.equal(locks.held.size, 2);
  first.activity.stop(one); second.activity.stop(two);
});

test('leases and execution grants cannot be reconstructed from JSON or another instance', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  const other = createAccountActivity(env.adapters);
  for (const copied of [JSON.parse(JSON.stringify(lease)), { ...lease }, env.activity.snapshot(lease)]) {
    await assert.rejects(env.activity.run(copied, { actionId: 'one', execute: async () => ({ verified: true }) }), /lease-invalid/);
  }
  await assert.rejects(other.run(lease, { actionId: 'one', execute: async () => ({ verified: true }) }), /lease-invalid/);
  assert.equal(Object.isFrozen(lease), true);
  assert.deepEqual(Object.keys(lease), []);
  env.activity.stop(lease);
});

test('account, mode, job, tab, document, and expiry are copied rather than retained from input', async () => {
  const env = environment();
  const input = env.binding();
  const lease = await env.activity.acquire(input);
  input.mode = 'ghost'; input.jobId = 'replacement'; input.documentId = 'different'; input.expiresAt += 600_000;
  const snapshot = env.activity.snapshot(lease);
  assert.equal(snapshot.mode, 'presence');
  assert.equal(snapshot.jobId, 'fixture_job');
  assert.equal(snapshot.documentId, 'fixture_document');
  assert.notEqual(snapshot.expiresAt, input.expiresAt);
  assert.equal(Object.isFrozen(snapshot), true);
  env.activity.stop(lease);
});

test('unreviewed binding shapes and expired acquisitions fail without claiming a lock', async () => {
  const env = environment();
  for (const patch of [{ mode: 'other' }, { jobId: '' }, { documentId: '' }, { tabId: -1 },
    { accountId: '' }, { expiresAt: Number.POSITIVE_INFINITY }, { expiresAt: 1 }]) {
    await assert.rejects(env.activity.acquire(env.binding(patch)), /binding-invalid/);
  }
  assert.equal(env.locks.held.size, 0);
});

test('exact tab/document/account context is required before dispatch', async () => {
  for (const patch of [{ accountId: 'different' }, { documentId: 'other_document' }, { tabId: 8 },
    { frozen: true }, { discarded: true }, { rateLimited: true }, { sessionExpired: true }]) {
    const env = environment();
    const lease = await env.activity.acquire(env.binding());
    env.setContext(patch);
    let dispatched = 0;
    await assert.rejects(env.activity.run(lease, { actionId: 'one', execute() { dispatched += 1; } }), /context-changed/);
    assert.equal(dispatched, 0);
    assert.equal(env.activity.snapshot(lease).lockHeld, false);
  }
});

test('asynchronous current-context inspectors do not pass a synchronous dispatch guard', async () => {
  const env = environment({ inspectCurrent: async () => ({ accountVerified: true }) });
  await assert.rejects(env.activity.acquire(env.binding()), /context-changed/);
  await flush();
  assert.equal(env.locks.held.size, 0);
});

test('one action in flight and consumed action identity cannot be replayed', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  const completion = deferred();
  const started = deferred();
  const run = env.activity.run(lease, { actionId: 'one', execute({ assertCurrent }) {
    assert.equal(assertCurrent(), true); started.resolve(); return completion.promise;
  } });
  await started.promise;
  await assert.rejects(env.activity.run(lease, { actionId: 'two', execute() {} }), /in-flight/);
  completion.resolve({ verified: true });
  assert.equal((await run).verified, true);
  await assert.rejects(env.activity.run(lease, { actionId: 'one', execute() {} }), /already-used/);
  assert.equal(env.activity.snapshot(lease).verified, 1);
  env.activity.stop(lease);
});

test('pause during inspection prevents dispatch and releases only after inspection settles', async () => {
  const inspected = deferred();
  const env = environment({ inspectContext: () => inspected.promise });
  const lease = await env.activity.acquire(env.binding());
  let dispatches = 0;
  const run = env.activity.run(lease, { actionId: 'one', execute() { dispatches += 1; } });
  env.activity.pause(lease);
  const rejected = assert.rejects(run, /grant-revoked/);
  await assert.rejects(createAccountActivity(env.adapters).acquire(env.binding({ mode: 'ghost' })), /busy/);
  inspected.resolve(env.adapters.inspectCurrent());
  await rejected;
  assert.equal(dispatches, 0);
  assert.equal(env.activity.snapshot(lease).lockHeld, false);
});

test('pause and stop revoke future clicks while allowing a dispatched success to settle', async () => {
  for (const method of ['pause', 'stop']) {
    const env = environment();
    const lease = await env.activity.acquire(env.binding());
    const completion = deferred();
    let grant;
    const run = env.activity.run(lease, { actionId: 'one', execute(value) { grant = value; return completion.promise; } });
    await flush();
    env.activity[method](lease);
    assert.equal(grant.signal.aborted, true);
    assert.throws(grant.assertCurrent, /grant-revoked/);
    assert.equal(env.activity.snapshot(lease).lockHeld, true);
    await assert.rejects(createAccountActivity(env.adapters).acquire(env.binding({ mode: 'ghost' })), /busy/);
    completion.resolve({ verified: true });
    assert.equal((await run).verified, true);
    assert.equal(env.activity.snapshot(lease).verified, 1);
    assert.equal(env.activity.snapshot(lease).lockHeld, false);
    assert.equal(env.pendingTimers.size, 0);
  }
});

test('elapsed expiry rejects a frozen worker wake even when its timer never ran', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  env.advance(60_001, false);
  let dispatches = 0;
  await assert.rejects(env.activity.run(lease, { actionId: 'one', execute() { dispatches += 1; } }), /expired/);
  assert.equal(dispatches, 0);
  assert.equal(env.pendingTimers.size, 0);
});

test('expiry during dispatch holds ownership until a late acknowledgment actually settles', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  const completion = deferred();
  let grant;
  const run = env.activity.run(lease, { actionId: 'one', execute(value) { grant = value; return completion.promise; } });
  await flush();
  env.advance(60_001);
  assert.throws(grant.assertCurrent, /grant-revoked/);
  assert.equal(env.activity.snapshot(lease).lockHeld, true);
  await assert.rejects(createAccountActivity(env.adapters).acquire(env.binding({ mode: 'ghost' })), /busy/);
  completion.resolve({ verified: true });
  const result = await run;
  assert.equal(result.verified, true);
  assert.equal(result.needsAttention, true);
  assert.equal(env.activity.snapshot(lease).lockHeld, false);
});

test('uncertain dispatch keeps the account quarantined until trusted reconciliation', async () => {
  const reconciled = deferred();
  const env = environment({ reconcileOutcome: () => reconciled.promise });
  const lease = await env.activity.acquire(env.binding());
  const result = await env.activity.run(lease, { actionId: 'one', execute: async () => ({ verified: false }) });
  assert.equal(result.uncertain, true);
  assert.equal(env.activity.snapshot(lease).lockHeld, true);
  env.activity.stop(lease);
  await assert.rejects(createAccountActivity(env.adapters).acquire(env.binding({ mode: 'ghost' })), /busy/);
  const pending = env.activity.reconcile(lease);
  await assert.rejects(env.activity.reconcile(lease), /unavailable/);
  reconciled.resolve({ outcome: 'verified' });
  await pending;
  assert.equal(env.activity.snapshot(lease).verified, 1);
  assert.equal(env.activity.snapshot(lease).lockHeld, false);
  await flush();
  const ghost = createAccountActivity(env.adapters);
  const fresh = await ghost.acquire(env.binding({ mode: 'ghost', jobId: 'fresh_ghost_review' }));
  await assert.rejects(env.activity.run(lease, { actionId: 'two', execute() {} }), /reconciled/);
  ghost.stop(fresh);
});

test('execute exceptions are uncertain and a missing reconciliation adapter cannot unlock them', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  const result = await env.activity.run(lease, { actionId: 'one', execute() { throw new Error('acknowledgment-lost'); } });
  assert.equal(result.uncertain, true);
  await assert.rejects(env.activity.reconcile(lease), /unavailable/);
  await assert.rejects(env.activity.run(lease, { actionId: 'one', execute() {} }), /uncertain/);
});

test('storage failure after verified work retains its count and prevents blind retry', async () => {
  let writes = 0;
  const env = environment({ onSettled: async () => { if (++writes === 1) throw new Error('storage-failed'); },
    reconcileOutcome: async () => ({ outcome: 'verified' }) });
  const lease = await env.activity.acquire(env.binding());
  const result = await env.activity.run(lease, { actionId: 'one', execute: async () => ({ verified: true }) });
  assert.equal(result.verified, true);
  assert.equal(result.reason, 'activity-checkpoint-failed');
  assert.equal(env.activity.snapshot(lease).verified, 1);
  assert.equal(env.activity.snapshot(lease).lockHeld, true);
  assert.equal(env.activity.snapshot(lease).uncertain, false);
  assert.equal(env.activity.snapshot(lease).needsReconciliation, true);
  await env.activity.reconcile(lease);
  assert.equal(env.activity.snapshot(lease).verified, 1);
  assert.equal(env.activity.snapshot(lease).lockHeld, false);
});

test('a late persistence acknowledgment cannot reopen stopped authority', async () => {
  const saved = deferred();
  const env = environment({ onSettled: () => saved.promise });
  const lease = await env.activity.acquire(env.binding());
  const run = env.activity.run(lease, { actionId: 'one', execute: async () => ({ verified: true }) });
  await flush();
  env.activity.stop(lease);
  assert.equal(env.activity.snapshot(lease).lockHeld, true);
  saved.resolve();
  await run;
  assert.equal(env.activity.snapshot(lease).status, 'released');
  await assert.rejects(env.activity.run(lease, { actionId: 'two', execute() {} }), /stopped/);
});

test('native lock loss revokes grants but the trusted broker does not replace unsettled work', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  const completion = deferred();
  let grant;
  const run = env.activity.run(lease, { actionId: 'one', execute(value) { grant = value; return completion.promise; } });
  await flush();
  env.locks.lose();
  await flush();
  assert.throws(grant.assertCurrent, /grant-revoked/);
  assert.equal(env.activity.snapshot(lease).nativeLockHeld, false);
  assert.equal(env.activity.snapshot(lease).lockHeld, true);
  await assert.rejects(createAccountActivity(env.adapters).acquire(env.binding({ mode: 'ghost' })), /busy/);
  completion.resolve({ verified: true });
  await run;
  assert.equal(env.activity.snapshot(lease).lockHeld, false);
});

test('a silent in-flight worker cannot be replaced or reconciled based on missing heartbeats', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  const completion = deferred();
  const run = env.activity.run(lease, { actionId: 'one', execute: () => completion.promise });
  await flush();
  env.advance(24 * 60 * 60 * 1_000);
  assert.equal(env.activity.snapshot(lease).inFlight, true);
  await assert.rejects(env.activity.reconcile(lease), /unavailable/);
  await assert.rejects(createAccountActivity(env.adapters).acquire(env.binding({ mode: 'ghost' })), /busy/);
  completion.resolve({ verified: true }); await run;
});

test('a new owner cannot reuse an old lease or captured per-click grant', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  let grant;
  await env.activity.run(lease, { actionId: 'one', execute(value) { grant = value; return { verified: true }; } });
  assert.throws(grant.assertCurrent, /grant-revoked/);
  env.activity.stop(lease);
  await flush();
  const next = await env.activity.acquire(env.binding({ mode: 'ghost', jobId: 'new_review' }));
  await assert.rejects(env.activity.run(lease, { actionId: 'two', execute() {} }), /stopped/);
  assert.throws(grant.assertCurrent, /grant-revoked/);
  env.activity.stop(next);
});

test('a failed or contradictory reconciliation retains ownership without another action', async () => {
  const env = environment({ reconcileOutcome: async () => ({ outcome: 'unknown' }) });
  const lease = await env.activity.acquire(env.binding());
  await env.activity.run(lease, { actionId: 'one', execute: async () => ({ verified: false }) });
  await assert.rejects(env.activity.reconcile(lease), /unproven/);
  assert.equal(env.activity.snapshot(lease).lockHeld, true);
  await assert.rejects(createAccountActivity(env.adapters).acquire(env.binding({ mode: 'ghost' })), /busy/);
});

test('account changes detected between native controls revoke the remaining grant', async () => {
  const env = environment();
  const lease = await env.activity.acquire(env.binding());
  let clicks = 0;
  const result = await env.activity.run(lease, { actionId: 'one', execute({ assertCurrent }) {
    assertCurrent(); clicks += 1;
    env.setContext({ accountId: 'other_account' });
    assertCurrent(); clicks += 1;
    return { verified: true };
  } });
  assert.equal(clicks, 1);
  assert.equal(result.uncertain, true);
  assert.equal(env.activity.snapshot(lease).verified, 0);
  assert.equal(env.activity.snapshot(lease).lockHeld, true);
});
