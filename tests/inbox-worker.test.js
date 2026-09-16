import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createInboxCoordinator, createInboxReview, inboxReviewKey } from '../extension/inbox-coordinator.js';
import { createInboxWorker } from '../extension/inbox-worker.js';

async function setup(options = {}) {
  let clock = 1_700_000_000_000;
  const review = createInboxReview({ accountId: 'account_1', threadIds: ['123'],
    scope: options.scope || 'all', limit: options.limit, speed: 'fast' }, clock);
  const saved = [];
  let failSave = false;
  const coordinator = createInboxCoordinator({ review, now: () => clock,
    save: async value => { if (failSave) throw new Error('storage-failed'); saved.push(value); } });
  await coordinator.approve(inboxReviewKey(review), review.accountId);
  const lease = await coordinator.claim(0, review.accountId);
  const handle = { threadId: '123', workerIndex: 0, documentId: 'document-1' };
  let context = { accountId: review.accountId, accountVerified: true, threadId: '123',
    documentId: handle.documentId, usable: true };
  let captured;
  let calls = 0;
  const runner = { createPlan: value => ({ ...value }),
    SPEED_PROFILES: { fast: { minDelayMs: 1_000 } },
    start: async value => { calls += 1; captured = value; return { status: 'fixture-ready' }; } };
  const worker = createInboxWorker({ review, lease, handle, coordinator,
    managedTabs: { check: async () => ({ ready: true }) }, runner,
    inspectContext: async () => context, inspectCurrent: () => context,
    now: () => clock, nonce: () => `action_${saved.length}` });
  await worker.run();
  return { worker, coordinator, review, saved, captured, calls,
    context: value => { context = { ...context, ...value }; },
    advance: value => { clock += value; }, failSave: () => { failSave = true; } };
}
const candidate = (patch = {}) => ({ key: 'data-message-id:1', timestamp: 1_699_999_999_000,
  ownershipVerified: true, ...patch });
async function action(env, item = candidate(), execute = async () => ({ verified: true })) {
  return env.captured.workerAdapter.execute({ candidate: item, threadId: '123',
    signal: new AbortController().signal, execute });
}

test('worker reuses one reviewed thread runner and counts each verified message exactly once', async () => {
  const env = await setup({ scope: 'newest', limit: 2 });
  assert.equal(env.calls, 1);
  assert.equal(env.captured.plan.scope, 'newest');
  assert.equal(env.captured.plan.limit, 2);
  assert.equal(env.captured.plan.speed, 'fast');
  assert.equal(env.captured.plan.expiresAt, env.review.expiresAt);
  let controls = 0;
  const result = await action(env, candidate(), async () => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(env.captured.workerAdapter.assertAction({ threadId: '123', candidate: candidate() }), true);
      controls += 1;
    }
    return { verified: true };
  });
  assert.equal(result.verified, true);
  assert.equal(controls, 3);
  assert.equal(env.coordinator.snapshot().tasks[0].messageRemovals, 1);
  assert.equal(env.saved.filter(value => value.pendingMutation?.phase === 'dispatched').length, 1);
  assert.equal(env.coordinator.snapshot().nextActionAt, env.review.reviewedAt + 1_000);
  await assert.rejects(env.worker.run(), /worker-already-started/);
  await assert.rejects(action(env), /worker-duplicate-target/);
});

test('unknown cutoff, new arrivals, and contradictory ownership never dispatch', async () => {
  for (const patch of [{ key: null }, { timestamp: null }, { timestamp: 1_700_000_000_001 }, { ownershipVerified: false }]) {
    const env = await setup();
    let clicks = 0;
    await assert.rejects(action(env, candidate(patch), async () => { clicks += 1; return { verified: true }; }), /historical-boundary-unproven/);
    assert.equal(clicks, 0);
    assert.equal(env.coordinator.snapshot().pendingMutation, null);
    assert.equal(env.coordinator.snapshot().tasks[0].messageRemovals, 0);
  }
});

test('every native action fence rejects changed account, thread, row, and coordinator stop', async () => {
  for (const change of ['account', 'thread', 'row', 'stop']) {
    const env = await setup();
    let controls = 0;
    const outcome = await action(env, candidate(), async () => {
      env.captured.workerAdapter.assertAction({ threadId: '123', candidate: candidate() });
      controls += 1;
      if (change === 'account') env.context({ accountId: 'other' });
      if (change === 'thread') env.context({ threadId: '456' });
      if (change === 'stop') void env.coordinator.interrupt('stopped', { stop: true });
      env.captured.workerAdapter.assertAction({ threadId: '123', candidate: candidate(change === 'row' ? { key: 'recycled' } : {}) });
      controls += 1;
      return { verified: true };
    });
    assert.equal(outcome.verified, false);
    assert.equal(controls, 1);
    assert.equal(env.coordinator.snapshot().tasks[0].messageRemovals, 0);
    assert.equal(env.coordinator.snapshot().tasks[0].status, 'uncertain');
  }
});

test('a dispatched removal can settle after Stop without authorizing another action', async () => {
  const env = await setup();
  const result = await action(env, candidate(), async () => {
    env.captured.workerAdapter.assertAction({ threadId: '123', candidate: candidate() });
    env.worker.stop();
    return { verified: true };
  });
  assert.equal(result.verified, true);
  assert.equal(env.coordinator.snapshot().tasks[0].messageRemovals, 1);
  await assert.rejects(action(env, candidate({ key: 'another' })), /worker-stopped/);
});

test('checkpoint failure after proven removal preserves the count and stops instead of retrying', async () => {
  const env = await setup();
  const result = await action(env, candidate(), async () => {
    env.failSave();
    return { verified: true };
  });
  assert.deepEqual(result, { verified: true, stopReason: 'worker-checkpoint-failed' });
  assert.equal(env.coordinator.snapshot().tasks[0].messageRemovals, 1);
  assert.equal(env.coordinator.snapshot().status, 'paused');
  await assert.rejects(action(env), /worker-stopped/);
});

test('expiry and external cancellation prevent dispatch', async () => {
  const expired = await setup();
  expired.advance(20 * 60 * 1_000);
  await assert.rejects(action(expired), /worker-approval-expired/);
  const stopped = await setup();
  stopped.worker.stop();
  await assert.rejects(action(stopped), /worker-stopped/);
  assert.equal(stopped.coordinator.snapshot().tasks[0].messageRemovals, 0);
});

test('read-only worker context checks do not require a mutation grant', async () => {
  const env = await setup({ scope: 'oldest', limit: 1 });
  assert.equal(env.captured.workerAdapter.assertContext({ threadId: '123' }), true);
  assert.throws(() => env.captured.workerAdapter.assertAction({ threadId: '123', candidate: candidate() }), /worker-target-changed/);
  env.context({ accountId: 'different' });
  assert.throws(() => env.captured.workerAdapter.assertContext({ threadId: '123' }), /worker-context-changed/);
});

test('worker retries a raced admission clock but never retries a dispatched outcome', async () => {
  let attempts = 0;
  const env = await setup();
  // The coordinator object is immutable; build a fresh worker around a thin
  // admission adapter, retaining the actual coordinator for every accepted call.
  const review = env.review;
  const job = createInboxCoordinator({ review, now: () => review.reviewedAt, save: async () => {} });
  await job.approve(inboxReviewKey(review), review.accountId);
  const lease = await job.claim(0, review.accountId);
  const handle = { threadId: '123', workerIndex: 0, documentId: 'doc' };
  const evidence = { accountVerified: true, accountId: review.accountId, threadId: '123', documentId: 'doc', usable: true };
  let adapter;
  const worker = createInboxWorker({ review, lease, handle, now: () => review.reviewedAt,
    coordinator: { snapshot: job.snapshot, mutate: async (...args) => {
      attempts += 1;
      if (attempts === 1) throw new Error('account-pacing');
      return job.mutate(...args);
    } },
    managedTabs: { check: async () => ({ ready: true }) },
    inspectCurrent: () => evidence, inspectContext: async () => evidence,
    runner: { createPlan: value => value, start: async options => { adapter = options.workerAdapter; } },
    nonce: () => 'admission_1' });
  await worker.run();
  let dispatches = 0;
  const outcome = await adapter.execute({ candidate: candidate(), threadId: '123', signal: new AbortController().signal,
    execute: async () => { dispatches += 1; throw new Error('account-pacing'); } });
  assert.equal(attempts, 2, 'retry only the rejected admission, not an action outcome');
  assert.equal(dispatches, 1);
  assert.equal(outcome.verified, false);
  assert.equal(job.snapshot().tasks[0].messageRemovals, 0);
  assert.equal(job.snapshot().tasks[0].status, 'uncertain');
});

test('oldest worker traversal proves the read-only boundary without an action grant', async () => {
  const source = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
  const view = { getComputedStyle: () => ({}), innerWidth: 1_280, innerHeight: 800 };
  const scroller = Object.assign(new EventTarget(), {
    isConnected: true, children: [], scrollTop: 0, scrollHeight: 100, clientHeight: 100,
    querySelectorAll: () => [], querySelector: () => null, getAttribute: () => null,
    removeAttribute() {}, ownerDocument: { defaultView: view },
    getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 }),
  });
  const document = Object.assign(new EventTarget(), { documentElement: {},
    querySelectorAll: selector => selector.includes('IGDMessagesList') ? [scroller] : [],
    querySelector: () => null });
  const context = vm.createContext({ __instaToolboxTestHooks: true, Date, Map, Set, Object,
    AbortController, DOMException, Event, EventTarget, setTimeout, clearTimeout,
    document, location: { pathname: '/direct/t/123/' }, getComputedStyle: view.getComputedStyle,
    innerWidth: 1_280, innerHeight: 800 });
  vm.runInContext(source, context);
  const runner = context.InstaToolboxDmThreadUnsender;
  let contextChecks = 0;
  let actionChecks = 0;
  const controller = new AbortController();
  const result = await runner.start({
    plan: runner.createPlan({ threadId: '123', scope: 'oldest', limit: 1, expiresAt: Date.now() + 30_000 }),
    workerAdapter: { signal: controller.signal,
      assertContext() { contextChecks += 1; return true; },
      assertAction() { actionChecks += 1; throw new Error('no grant'); },
      execute() { throw new Error('empty fixture cannot mutate'); } },
  });
  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.processed, 0);
  assert.ok(contextChecks > 4, 'oldest boundary must actually traverse and stabilize');
  assert.equal(actionChecks, 0, 'read-only boundary proof must never request a mutation grant');
  for (const interruption of ['cancel', 'expiry', 'context']) {
    const interrupted = new AbortController();
    const cancelOnScroll = () => interrupted.abort('worker-stopped');
    if (interruption === 'cancel') scroller.addEventListener('scroll', cancelOnScroll, { once: true });
    const stopped = await runner.start({
      plan: runner.createPlan({ threadId: '123', scope: 'oldest', limit: 1,
        expiresAt: Date.now() + (interruption === 'expiry' ? 40 : 30_000) }),
      workerAdapter: { signal: interrupted.signal,
        assertContext: () => interruption !== 'context',
        assertAction() { throw new Error('no action grant'); },
        execute() { throw new Error('must not dispatch'); } },
    });
    scroller.removeEventListener('scroll', cancelOnScroll);
    assert.equal(stopped.processed, 0);
    assert.equal(stopped.status, interruption === 'cancel' ? 'stopped' : 'error', stopped.message);
    assert.match(stopped.message, interruption === 'expiry' ? /expired/ : interruption === 'context' ? /worker/ : /stopp/i);
  }
});

test('runner worker evidence rejects absent or contradictory timestamps without changing standalone identity', async () => {
  const source = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
  const context = vm.createContext({ __instaToolboxTestHooks: true, Date, Map, Set, Object,
    getComputedStyle: () => ({ justifyContent: 'flex-end' }) });
  vm.runInContext(source, context);
  const evidence = context.InstaToolboxDmThreadUnsender.__test.workerCandidate;
  const row = (values, children = []) => ({ isConnected: true, children: [],
    getAttribute: key => values[key] || null, querySelectorAll: () => children });
  assert.equal(evidence(row({ 'data-message-id': 'one' })).timestamp, null);
  assert.equal(evidence(row({ 'data-message-id': 'one', 'data-timestamp-ms': '1700000000000' })).timestamp, 1700000000000);
  assert.equal(evidence(row({ 'data-message-id': 'one', 'data-timestamp-ms': '1700000000000' },
    [row({ datetime: '2025-01-01T00:00:00Z' })])).timestamp, null);
  assert.equal(evidence(row({ 'data-message-id': 'one', 'data-sent-by-me': 'false' })).ownershipVerified, false);
});
