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
  assert.deepEqual(opened.map(value => value.url), [
    'https://www.instagram.com/direct/t/one/',
    'https://www.instagram.com/direct/t/two/',
  ]);
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
    tasks: [{ threadId: 'thread_1', index: 0, status: 'opening', messageRemovals: 0, reason: null }],
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
    location: { pathname: '/direct/t/thread_1/' },
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
