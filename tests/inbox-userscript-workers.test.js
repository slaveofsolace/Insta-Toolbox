import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUserscriptGhostBridge,
  createUserscriptGhostReview,
  userscriptGhostReviewKey,
} from '../extension/inbox-userscript-workers.js';

const NOW = Date.parse('2026-09-18T20:00:00Z');

function sharedStorage(initial = null) {
  let value = structuredClone(initial);
  let sequence = 0;
  const listeners = new Map();
  return {
    get: async () => structuredClone(value),
    set: async (_key, next) => {
      value = structuredClone(next);
      for (const listener of listeners.values()) listener(structuredClone(value));
    },
    listen: (_key, listener) => { const id = ++sequence; listeners.set(id, listener); return id; },
    unlisten: id => listeners.delete(id),
    value: () => structuredClone(value),
  };
}

const locks = { request: async (_name, _options, callback) => callback({}) };
const runnerStub = {
  createPlan: value => ({ ...value, version: 3, speed: 'standard', reviewedDigest: 'deadbeef' }),
  start: async () => ({ status: 'completed', processed: 0, uncertain: 0 }),
  stop: () => true,
};

test('Ghost review freezes exact threads, worker count and a bounded expiry', () => {
  const review = createUserscriptGhostReview({
    accountId: 'iguser-v1-demo',
    threadIds: ['one', 'two', 'one'],
    workerCount: 5,
    expiresAt: NOW + 24 * 60 * 60_000,
  }, NOW);
  assert.deepEqual(review.threadIds, ['one', 'two']);
  assert.equal(review.workerCount, 2);
  assert.equal(review.openInBackground, true);
  assert.equal(review.expiresAt, NOW + 12 * 60 * 60_000);
  assert.match(userscriptGhostReviewKey(review), /"threadIds":\["one","two"\]/);
});

test('Ghost review can explicitly keep managed tabs in front', () => {
  const review = createUserscriptGhostReview({
    accountId: 'iguser-v1-demo', threadIds: ['one'], workerCount: 1,
    openInBackground: false, expiresAt: NOW + 60_000,
  }, NOW);
  assert.equal(review.openInBackground, false);
});

test('Ghost freezes per-conversation message options instead of widening a finite selection', () => {
  for (const scope of ['newest', 'oldest']) {
    const review = createUserscriptGhostReview({ accountId: 'demo', threadIds: ['one', 'two'], scope, limit: 1 }, NOW);
    assert.equal(review.scope, scope); assert.equal(review.limit, 1);
    assert.equal(Object.isFrozen(review), true);
    assert.match(userscriptGhostReviewKey(review), /"limit":1/);
  }
  for (const limit of [null, 0, -1, 0.5, 5001, Infinity]) {
    assert.throws(() => createUserscriptGhostReview({ accountId: 'demo', threadIds: ['one'], scope: 'newest', limit }, NOW), /message-options-invalid/);
  }
});

test('manager opens only reviewed inactive worker tabs and Stop closes only owned tabs', async () => {
  let id = 0;
  const storage = sharedStorage();
  const opened = [];
  const closed = [];
  const bridge = createUserscriptGhostBridge({
    storage, locks,
    openTab: async (url, options) => {
      opened.push({ url, options });
      return { close: async () => { closed.push(url); } };
    },
    runner: runnerStub,
    inspectContext: () => ({ accountId: 'iguser-v1-demo', usable: true }),
    location: { pathname: '/direct/inbox/' },
    now: () => NOW,
    randomId: () => `runtime_${++id}`,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  const review = bridge.createReview({
    accountId: 'iguser-v1-demo', threadIds: ['one', 'two', 'three'],
    workerCount: 2, expiresAt: NOW + 60_000,
  });
  const manager = bridge.createManager(review);
  const running = manager.start();
  while (opened.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(opened.map(value => value.url.split('#')[0]), [
    'https://www.instagram.com/direct/t/one/',
    'https://www.instagram.com/direct/t/two/',
  ]);
  assert.ok(opened.every(value => new URL(value.url).hash.startsWith('#insta-toolbox-worker=')));
  assert.equal(opened.every(value => value.options.active === false), true);
  await manager.stop();
  const result = await running;
  assert.equal(result.status, 'stopped');
  assert.deepEqual(new Set(closed), new Set(opened.map(value => value.url)));
  assert.equal(storage.value().tasks.find(task => task.threadId === 'three').status, 'stopped');
});

test('worker serializes verified removals through the shared mutation lane', async () => {
  let clock = NOW;
  let id = 0;
  const storage = sharedStorage({
    version: 1,
    jobId: 'job_1',
    coordinatorId: 'coordinator_1',
    accountId: 'iguser-v1-demo',
    status: 'running',
    reason: null,
    workerCount: 1,
    expiresAt: NOW + 60_000,
    reviewedAt: NOW,
    reviewKey: 'review',
    coordinatorHeartbeatAt: NOW,
    nextActionAt: 0,
    pendingMutation: null,
    updatedAt: NOW,
    tasks: [{ threadId: 'thread_1', launchId: 'launch_1', index: 0, status: 'opening', messageRemovals: 0, reason: null }],
  });
  const calls = [];
  const runner = {
    createPlan: value => ({ ...value, version: 3, speed: 'standard', reviewedDigest: 'deadbeef' }),
    async start({ workerAdapter }) {
      for (const key of ['message-a', 'message-b']) {
        const candidate = { key, timestamp: null, ownershipVerified: true };
        assert.equal(workerAdapter.assertContext({ threadId: 'thread_1' }), true);
        const result = await workerAdapter.execute({
          candidate, threadId: 'thread_1', signal: new AbortController().signal,
          execute: async () => {
            assert.equal(workerAdapter.assertAction({ threadId: 'thread_1', candidate }), true);
            await workerAdapter.onDispatch();
            calls.push(key);
            return { verified: true };
          },
        });
        assert.equal(result.verified, true);
      }
      return { status: 'completed', processed: 2, uncertain: 0 };
    },
    stop: () => true,
  };
  const workerLocks = {
    request: async (name, _options, callback) => callback(
      name.startsWith('insta-toolbox:ghost-coordinator:') ? null : {},
    ),
  };
  const bridge = createUserscriptGhostBridge({
    storage, locks: workerLocks, openTab: async () => null, runner,
    inspectContext: () => ({ accountId: 'iguser-v1-demo', threadId: 'thread_1', usable: true }),
    location: { pathname: '/direct/t/thread_1/', hash: '#insta-toolbox-worker=job_1.launch_1' },
    now: () => clock,
    random: () => 0,
    randomId: () => `worker_${++id}`,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: (callback, ms) => { clock += ms; queueMicrotask(callback); return 1; },
    clearTimeoutFn: () => {},
  });
  const outcome = await bridge.attachWorker();
  assert.deepEqual(calls, ['message-a', 'message-b']);
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.messageRemovals, 2);
  assert.equal(storage.value().pendingMutation, null);
});

function workerFixture({ readyAfter = 0, execute, hash = '#insta-toolbox-worker=job_1.launch_1', messageOptions = {} } = {}) {
  let clock = NOW, inspections = 0, starts = 0;
  const plans = [];
  const storage = sharedStorage({ version: 1, jobId: 'job_1', coordinatorId: 'coordinator_1',
    accountId: 'demo', status: 'running', expiresAt: NOW + 120_000, nextActionAt: 0,
    pendingMutation: null, ...messageOptions, tasks: [{ threadId: 'one', launchId: 'launch_1', status: 'opening',
      messageRemovals: 0, openedAt: NOW }] });
  const bridge = createUserscriptGhostBridge({ storage,
    locks: { request: async (name, _options, callback) => callback(name.includes('ghost-coordinator:') ? null : {}) },
    openTab: async () => null,
    location: { pathname: '/direct/t/one/', hash },
    now: () => clock, random: () => 0, randomId: () => 'worker_1',
    inspectContext: () => ++inspections <= readyAfter ? { usable: false }
      : { usable: true, accountId: 'demo', threadId: 'one' },
    runner: { ...runnerStub, async start({ workerAdapter, plan }) {
      plans.push(plan);
      starts += 1;
      return execute ? execute(workerAdapter, storage) : { status: 'completed', processed: 0 };
    } },
    setIntervalFn: () => 1, clearIntervalFn: () => {},
    setTimeoutFn: (callback, ms) => { clock += ms; queueMicrotask(callback); return 1; },
    clearTimeoutFn: () => {},
  });
  return { bridge, storage, plans, get starts() { return starts; }, get clock() { return clock; } };
}

test('worker dispatch preserves the reviewed per-conversation newest count', async () => {
  const f = workerFixture({ messageOptions: { scope: 'newest', limit: 1 } });
  assert.equal((await f.bridge.attachWorker()).status, 'completed');
  assert.equal(f.plans[0].scope, 'newest'); assert.equal(f.plans[0].limit, 1);
});

test('managed workers wait for the authenticated React pane instead of attaching only once', async () => {
  const f = workerFixture({ readyAfter: 8 });
  assert.equal((await f.bridge.attachWorker()).status, 'completed');
  assert.equal(f.starts, 1);
  assert.ok(f.clock >= NOW + 2_000);
});

test('ordinary, stale and forged launch tabs never claim a reviewed conversation', async () => {
  for (const hash of ['', '#insta-toolbox-worker=job_1.old', '#insta-toolbox-worker=other.launch_1']) {
    const f = workerFixture({ hash });
    assert.equal(await f.bridge.attachWorker(), null);
    assert.equal(f.starts, 0);
    assert.equal(f.storage.value().tasks[0].status, 'opening');
  }
});

test('a worker that never becomes ready has a bounded startup deadline', async () => {
  const f = workerFixture({ readyAfter: Infinity });
  assert.equal(await f.bridge.attachWorker(), null);
  assert.equal(f.starts, 0);
  assert.equal(f.clock, NOW + 60_000);
});

test('zero-click menu failures remain retryable and never become uncertain deletions', async () => {
  const f = workerFixture({ async execute(adapter, storage) {
    const candidate = { key: 'message', timestamp: null, ownershipVerified: true };
    const action = execute => adapter.execute({ candidate, threadId: 'one', signal: adapter.signal, execute });
    await assert.rejects(action(async () => { throw new Error('The message menu did not appear.'); }), /menu did not appear/);
    assert.equal(storage.value().status, 'running');
    assert.equal(storage.value().pendingMutation, null);
    assert.equal(storage.value().tasks[0].messageRemovals, 0);
    assert.equal((await action(async () => { await adapter.onDispatch(); return { verified: true }; })).verified, true);
    return { status: 'completed', processed: 1 };
  } });
  assert.equal((await f.bridge.attachWorker()).messageRemovals, 1);
});

test('an exact retained target can retry, but an uncertain click is recorded without counting success', async () => {
  const f = workerFixture({ async execute(adapter, storage) {
    const candidate = { key: 'message', timestamp: null, ownershipVerified: true };
    for (const code of ['DM_UNSEND_RETRYABLE', 'DM_OUTCOME_UNCERTAIN']) {
      await assert.rejects(adapter.execute({ candidate, threadId: 'one', signal: adapter.signal,
        execute: async () => { await adapter.onDispatch(); throw Object.assign(new Error(code), { code }); },
      }), new RegExp(code));
      assert.equal(storage.value().pendingMutation, null);
      assert.equal(storage.value().tasks[0].messageRemovals, 0);
    }
    assert.equal(storage.value().tasks[0].uncertain, 1);
    return { status: 'error', processed: 0, uncertain: 1 };
  } });
  assert.equal((await f.bridge.attachWorker()).status, 'uncertain');
  assert.equal(f.storage.value().status, 'running', 'other reviewed conversations remain eligible');
});

test('runner exceptions settle the task instead of stranding a running worker', async () => {
  const f = workerFixture({ execute: async () => { throw new Error('pane disappeared'); } });
  const outcome = await f.bridge.attachWorker();
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.reason, 'pane disappeared');
});

test('a long Ghost inventory never grows beyond its configured tab pool', async () => {
  let clock = NOW, sequence = 0, tick, live = 0, maximum = 0;
  const opened = [], closed = [], storage = sharedStorage();
  const bridge = createUserscriptGhostBridge({ storage, locks, runner: runnerStub,
    inspectContext: () => ({ accountId: 'demo', usable: true }), location: { pathname: '/direct/inbox/' },
    now: () => clock, randomId: () => `id_${++sequence}`,
    setIntervalFn: callback => { tick = callback; return 1; }, clearIntervalFn: () => {},
    openTab: async url => { opened.push(url); maximum = Math.max(maximum, ++live);
      return { close: async () => { closed.push(url); live -= 1; } }; },
  });
  const manager = bridge.createManager(bridge.createReview({ accountId: 'demo',
    threadIds: Array.from({ length: 8 }, (_, index) => `thread_${index}`), workerCount: 2 }));
  const finished = manager.start();
  while (opened.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  while (storage.value().status === 'running') {
    const job = storage.value();
    for (const task of job.tasks) if (task.status === 'opening') task.status = 'completed';
    await storage.set('', job);
    clock += 3_000; tick();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal((await finished).status, 'completed');
  assert.equal(opened.length, 8); assert.equal(closed.length, 8); assert.equal(maximum, 2); assert.equal(live, 0);
});

test('an unopened conversation times out and the pool advances to the next reviewed thread', async () => {
  let clock = NOW, sequence = 0, tick;
  const storage = sharedStorage(), opened = [];
  const bridge = createUserscriptGhostBridge({ storage, locks, runner: runnerStub,
    inspectContext: () => ({ accountId: 'demo', usable: true }), location: { pathname: '/direct/inbox/' },
    now: () => clock, randomId: () => `id_${++sequence}`,
    setIntervalFn: callback => { tick = callback; return 1; }, clearIntervalFn: () => {},
    openTab: async url => { opened.push(url); return { close: async () => {} }; },
  });
  const manager = bridge.createManager(bridge.createReview({ accountId: 'demo', threadIds: ['one', 'two'], workerCount: 1 }));
  const finished = manager.start();
  while (opened.length < 1) await new Promise(resolve => setTimeout(resolve, 0));
  clock += 61_000; tick();
  while (opened.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(storage.value().tasks[0].reason, 'conversation-load-timeout');
  await manager.stop(); await finished;
});

test('opening retries are bounded, back off, close old tabs and invalidate each old launch', { timeout: 5000 }, async () => {
  let clock = NOW, sequence = 0, tick;
  const storage = sharedStorage(), opened = [], closed = [];
  const bridge = createUserscriptGhostBridge({ storage, locks, runner: runnerStub,
    inspectContext: () => ({ accountId: 'demo', usable: true }), location: { pathname: '/direct/inbox/' },
    now: () => clock, randomId: () => `retry_${++sequence}`,
    setIntervalFn: callback => { tick = callback; return 1; }, clearIntervalFn: () => {},
    openTab: async url => { opened.push(url); return { close: async () => { closed.push(url); } }; },
  });
  const manager = bridge.createManager(bridge.createReview({ accountId: 'demo', threadIds: ['one'], workerCount: 1 }));
  const finished = manager.start();
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  while (opened.length < 1) await flush();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    clock += 61_000; tick(); await flush(); await flush();
    assert.equal(storage.value().tasks[0].launchId, null);
    assert.equal(closed.length, attempt);
    if (attempt < 3) {
      assert.equal(storage.value().tasks[0].status, 'pending');
      assert.equal(opened.length, attempt, 'no immediate retry');
      clock += 2_000 * attempt; tick(); await flush(); await flush();
      assert.equal(opened.length, attempt + 1);
      assert.equal(new Set(opened).size, attempt + 1, 'old URL cannot claim the new opening');
    }
  }
  assert.equal((await finished).status, 'partial');
  assert.equal(storage.value().tasks[0].openAttempts, 3);
  assert.equal(storage.value().tasks[0].messageRemovals, 0);
});

test('coordinator account changes pause the entire pool before any new tab opens', async () => {
  const storage = sharedStorage(); let opens = 0;
  const bridge = createUserscriptGhostBridge({ storage, locks, runner: runnerStub,
    inspectContext: () => ({ accountId: 'different', usable: true }), location: { pathname: '/direct/inbox/' },
    now: () => NOW, setIntervalFn: () => 1, clearIntervalFn: () => {},
    openTab: async () => { opens += 1; return {}; },
  });
  const manager = bridge.createManager(bridge.createReview({ accountId: 'demo', threadIds: ['one'] }));
  const result = await manager.start();
  assert.equal(result.status, 'paused'); assert.equal(result.reason, 'account-changed'); assert.equal(opens, 0);
});
