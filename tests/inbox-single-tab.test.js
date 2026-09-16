import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleTabInboxController, createSingleTabInboxReview } from '../extension/inbox-single-tab.js';

const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
function lockManager() {
  const held = new Set();
  return { held, async request(name, options, callback) {
    assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' }); }
    finally { held.delete(name); }
  } };
}
function setup(options = {}) {
  let clock = 1_700_000_000_000;
  let state = { accountVerified: true, accountId: 'account_1', documentId: 'document_1', usable: true, threadId: null };
  let saves = 0;
  const checkpoints = [], navigation = [], dispatches = [], starts = [], events = [];
  const locks = options.locks || lockManager();
  const review = createSingleTabInboxReview({ accountId: state.accountId, threadIds: ['123', '456'],
    scope: 'all', messageWindow: 'during-run', ...options.review }, clock);
  let controller;
  const runner = {
    createPlan(value) { return Object.freeze({ ...value }); },
    async start({ plan, workerAdapter }) {
      starts.push(plan); await options.onStart?.({ plan, workerAdapter });
      let processed = 0;
      for (let index = 0; index < (options.messages ?? 1); index += 1) {
        if (workerAdapter.signal.aborted) break;
        const candidate = { key: null, timestamp: null, ownershipVerified: true, ...options.candidate };
        try {
          workerAdapter.assertContext({ threadId: plan.threadId });
          const result = await workerAdapter.execute({ candidate, threadId: plan.threadId,
            signal: new AbortController().signal,
            execute: async () => {
              workerAdapter.assertAction({ threadId: plan.threadId, candidate });
              await options.beforeDispatch?.({ controller, plan, workerAdapter, candidate, index });
              workerAdapter.assertAction({ threadId: plan.threadId, candidate });
              dispatches.push(plan.threadId);
              await options.afterDispatch?.({ controller, plan, workerAdapter, candidate, index });
              return { verified: options.verified !== false };
            } });
          if (!result.verified) return { status: 'error', processed, uncertain: 1 };
          processed += 1;
        } catch { return { status: 'error', processed, uncertain: 0 }; }
      }
      return { status: workerAdapter.signal.aborted ? 'stopped' : 'completed', processed, uncertain: 0 };
    },
  };
  controller = createSingleTabInboxController({ review, runner, locks,
    now: () => clock, restored: options.restored,
    stageTimeoutMs: options.stageTimeoutMs ?? 30_000,
    saveTimeoutMs: options.saveTimeoutMs ?? 10_000,
    inspectCurrent: () => options.inspect ? options.inspect(state) : state,
    navigate: async ({ accountId, threadId, signal, assertCurrent }) => {
      assertCurrent(); assert.equal(accountId, state.accountId);
      await options.beforeNavigation?.({ controller, threadId, signal, assertCurrent });
      assertCurrent();
      navigation.push(threadId); state = { ...state, threadId };
    },
    save: async checkpoint => {
      saves += 1;
      if (options.failSave?.(saves, checkpoint)) throw new Error('storage-failed');
      await options.onSave?.(checkpoint);
      checkpoints.push(structuredClone(checkpoint));
      // Simulated persistence latency also advances the shared pacing clock.
      clock += options.saveAdvanceMs ?? 2_000;
    },
  });
  controller.subscribe(value => events.push(value));
  return { controller, review, locks, checkpoints, navigation, dispatches, starts, events,
    context: value => { state = { ...state, ...value }; },
    advance: value => { clock += value; },
    start: () => controller.start(controller.approve(controller.reviewKey())),
  };
}

test('the reviewed during-run mode drives multiple conversations through the existing runner serially', async () => {
  const env = setup({ messages: 2 });
  const result = await env.start();
  assert.equal(result.status, 'completed');
  assert.deepEqual(env.navigation, ['123', '456']);
  assert.deepEqual(env.dispatches, ['123', '123', '456', '456']);
  assert.deepEqual(result.tasks.map(task => task.messageRemovals), [2, 2]);
  assert.equal(result.review.version, 2);
  assert.equal(result.review.arrivalPolicy, 'include-sent-while-running');
  assert.equal(result.review.messageWindow, 'during-run');
  assert.equal(result.lockHeld, false);
  assert.equal(result.canStop, false);
  assert.equal(env.locks.held.size, 0);
  assert.ok(env.starts.every(plan => plan.speed === 'standard' && plan.scope === 'all'));
  assert.ok(env.checkpoints.some(checkpoint => checkpoint.pendingMutation?.phase === 'dispatched'));
  assert.ok(env.events.some(snapshot => snapshot.phase === 'unsending' && snapshot.currentThreadId === '123'));
  assert.equal(JSON.stringify(env.checkpoints).includes('ownershipVerified'), false, 'candidate payloads are not persisted');
  assert.equal((await env.controller.stop()).status, 'completed', 'Stop cannot rewrite an already completed job');
});

test('old or unknown message-window reviews cannot gain broader execution semantics', () => {
  const base = { accountId: 'account_1', threadIds: ['123'] };
  for (const input of [base, { ...base, messageWindow: 'historical' },
    { ...base, version: 1, messageWindow: 'during-run' },
    { ...base, version: 2 }, { ...base, version: 9, messageWindow: 'during-run' },
    { ...base, messageWindow: 'during-run', arrivalPolicy: 'skip-after-review-or-pause' }]) {
    assert.throws(() => createSingleTabInboxReview(input));
  }
  assert.throws(() => createSingleTabInboxReview({ ...base, messageWindow: 'during-run', speed: 'fast' }));
  assert.throws(() => createSingleTabInboxReview({ ...base, messageWindow: 'during-run', workerCount: 2 }));
  assert.throws(() => createSingleTabInboxReview({ ...base, messageWindow: 'during-run', removeOwnReactions: true }));
});

test('original runtime approval is required and cannot be copied, replayed, or restored from JSON', async () => {
  const env = setup();
  const token = env.controller.approve(env.controller.reviewKey());
  await assert.rejects(env.controller.start({}), /runtime-approval/);
  await assert.rejects(env.controller.start(structuredClone(token)), /runtime-approval/);
  await env.controller.start(token);
  await assert.rejects(env.controller.start(token), /runtime-approval/);
  assert.throws(() => env.controller.approve(env.controller.reviewKey()), /already-used/);
  const restored = setup({ restored: env.checkpoints.at(-1) });
  assert.equal(restored.controller.snapshot().status, 'paused');
  assert.throws(() => restored.controller.approve(restored.controller.reviewKey()), /review-required-after-restart/);
  await assert.rejects(restored.controller.start(token), /runtime-approval/);
  assert.equal(restored.dispatches.length, 0);
});

test('the shared account lock prevents collisions and is held until the active native outcome settles', async () => {
  const gate = deferred(), dispatched = deferred(), locks = lockManager();
  const first = setup({ locks, afterDispatch: async () => { dispatched.resolve(); await gate.promise; } });
  const running = first.start(); await dispatched.promise;
  assert.ok(locks.held.has('insta-toolbox:account-activity:account_1'));
  const second = setup({ locks });
  await assert.rejects(second.start(), /inbox-account-busy/);
  assert.equal(second.navigation.length, 0);
  const stopping = first.controller.stop();
  assert.equal(locks.held.size, 1, 'Stop cannot release an unsettled mutation');
  gate.resolve(); await running; const stopped = await stopping;
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.tasks[0].messageRemovals, 1);
  assert.equal(stopped.tasks[0].status, 'partial');
  assert.equal(first.checkpoints.at(-1).tasks[0].status, 'partial', 'settled task state is durable, not display-only');
  assert.deepEqual(first.dispatches, ['123']);
  assert.equal(locks.held.size, 0);
});

test('Pause ends authority after settling the dispatched result, and never advances to another conversation', async () => {
  const env = setup({ afterDispatch: ({ controller }) => { void controller.pause(); } });
  const result = await env.start();
  assert.equal(result.status, 'paused');
  assert.equal(result.tasks[0].messageRemovals, 1);
  assert.equal(result.tasks[0].status, 'partial');
  assert.deepEqual(env.navigation, ['123']);
  assert.throws(() => env.controller.approve(env.controller.reviewKey()), /already-used/);
});

test('Skip settles the current action then continues only with the remaining reviewed threads', async () => {
  const env = setup({ messages: 2,
    afterDispatch: ({ controller, plan }) => { if (plan.threadId === '123') assert.equal(controller.skip(), true); } });
  const result = await env.start();
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.tasks.map(task => task.status), ['skipped', 'completed']);
  assert.deepEqual(result.tasks.map(task => task.messageRemovals), [1, 2]);
  assert.deepEqual(env.dispatches, ['123', '456', '456']);
});

test('Skip during navigation cancels that thread without granting its runner authority', async () => {
  const env = setup({ beforeNavigation: ({ controller, threadId }) => { if (threadId === '123') controller.skip(); } });
  const result = await env.start();
  assert.deepEqual(env.dispatches, ['456']);
  assert.deepEqual(result.tasks.map(task => task.status), ['skipped', 'completed']);
});

test('uncertain removals halt the entire queue, persist uncertainty, and are never retried', async () => {
  const env = setup({ verified: false, messages: 2 });
  const result = await env.start();
  assert.equal(result.status, 'paused');
  assert.equal(result.tasks[0].status, 'uncertain');
  assert.equal(result.pendingMutation.phase, 'uncertain');
  assert.equal(result.tasks[0].messageRemovals, 0);
  assert.deepEqual(env.dispatches, ['123']);
  assert.deepEqual(env.navigation, ['123']);
});

test('account, document, thread, restrictions and expiry are rechecked before every native dispatch', async () => {
  for (const change of ['account', 'document', 'thread', 'restriction', 'expiry']) {
    let env;
    env = setup({ beforeDispatch: () => {
      if (change === 'account') env.context({ accountId: 'another' });
      if (change === 'document') env.context({ documentId: 'replacement' });
      if (change === 'thread') env.context({ threadId: '789' });
      if (change === 'restriction') env.context({ rateLimited: true });
      if (change === 'expiry') env.advance(30 * 60_000);
    } });
    const result = await env.start();
    assert.equal(env.dispatches.length, 0, change);
    assert.equal(result.tasks[0].messageRemovals, 0, change);
    assert.equal(result.status, 'paused', change);
    assert.equal(env.navigation.length, 1, change);
  }
});

test('missing Web Locks or asynchronous identity adapters cannot start execution', async () => {
  const review = createSingleTabInboxReview({ accountId: 'account_1', threadIds: ['123'], messageWindow: 'during-run' });
  assert.throws(() => createSingleTabInboxController({ review, runner: {}, save() {}, inspectCurrent() {}, navigate() {} }), /runtime-unavailable/);
  const env = setup({ inspect: state => Promise.resolve(state) });
  assert.throws(() => env.controller.approve(env.controller.reviewKey()), /context-changed/);
  assert.equal(env.navigation.length, 0);
});

test('pre-dispatch storage failure leaves zero native mutations and preserves a fail-closed checkpoint', async () => {
  const env = setup({ failSave: (_index, checkpoint) => checkpoint.pendingMutation?.phase === 'prepared' });
  const result = await env.start();
  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'storage-failed');
  assert.equal(result.tasks[0].messageRemovals, 0);
  assert.equal(env.dispatches.length, 0);
});

test('post-success storage failure retains the verified count but dispatches nothing further', async () => {
  const env = setup({ messages: 2,
    failSave: (_index, checkpoint) => checkpoint.tasks[0].messageRemovals === 1 });
  const result = await env.start();
  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'storage-failed');
  assert.equal(result.tasks[0].messageRemovals, 1);
  assert.deepEqual(env.dispatches, ['123']);
});

test('untrusted ownership never reaches the native executor even in during-run mode', async () => {
  const env = setup({ candidate: { ownershipVerified: false } });
  await env.start();
  assert.equal(env.dispatches.length, 0);
});

test('an expired approval and a changed document cannot start a previously reviewed queue', async () => {
  for (const change of ['expiry', 'document']) {
    const env = setup();
    const token = env.controller.approve(env.controller.reviewKey());
    if (change === 'expiry') env.advance(30 * 60_000);
    else env.context({ documentId: 'replaced_after_review' });
    await assert.rejects(env.controller.start(token), /expired|context-changed/);
    assert.equal(env.navigation.length, 0);
    assert.equal(env.dispatches.length, 0);
    assert.equal(env.locks.held.size, 0);
  }
});

test('coordinator timeout does not release the lock or admit a replacement while native settlement is pending', async () => {
  const gate = deferred(), entered = deferred(), locks = lockManager();
  const env = setup({ locks, stageTimeoutMs: 15,
    afterDispatch: async () => { entered.resolve(); await gate.promise; } });
  const pending = env.start(); await entered.promise;
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(env.controller.snapshot().pendingMutation?.phase, 'uncertain');
  assert.equal(env.controller.snapshot().lockHeld, true);
  assert.equal(env.controller.snapshot().phase, 'settling');
  const collision = setup({ locks });
  await assert.rejects(collision.start(), /account-busy/);
  gate.resolve(); const result = await pending;
  assert.equal(result.status, 'paused');
  assert.equal(result.tasks[0].status, 'uncertain');
  assert.equal(result.tasks[0].messageRemovals, 0, 'late unacknowledged success requires reconciliation');
  assert.equal(locks.held.size, 0);
});

test('during-run review explicitly permits new arrivals without claiming a historical timestamp boundary', async () => {
  const env = setup({ review: { scope: 'newest', limit: 1 },
    candidate: { timestamp: 1_700_000_100_000 } });
  const result = await env.start();
  assert.equal(result.status, 'completed');
  assert.deepEqual(env.dispatches, ['123', '456']);
  assert.ok(env.starts.every(plan => plan.scope === 'newest' && plan.limit === 1));
});

test('a timed-out checkpoint never dispatches or starts another write after its late completion', async () => {
  const saveGate = deferred();
  let writes = 0;
  const env = setup({ saveTimeoutMs: 10, saveAdvanceMs: 0,
    onSave: async checkpoint => { writes += 1; if (checkpoint.pendingMutation?.phase === 'prepared') await saveGate.promise; } });
  const result = await env.start();
  assert.equal(result.reason, 'storage-timeout');
  assert.equal(env.dispatches.length, 0);
  assert.equal(writes, 3);
  saveGate.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(writes, 3);
  await assert.rejects(async () => env.start(), /already-used|runtime-approval/);
});
