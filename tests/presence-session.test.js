import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceSession, normalizePresenceSessionOptions } from '../extension/presence-session.js';

const NOW = Date.parse('2026-09-16T20:00:00Z');

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

function fixture({ candidates = {}, execute = null, wait = async () => {}, context = null,
  locks = lockManager() } = {}) {
  let clock = NOW;
  let viewer = context || { accountVerified: true, usable: true, accountId: 'viewer',
    accountKey: 'iguser-v1-viewer', challenge: false, actionBlocked: false,
    rateLimited: false, sessionExpired: false };
  const rows = Object.fromEntries(Object.entries(candidates).map(([key, value]) => [key, [...value]]));
  const calls = [];
  const updates = [];
  const nativeActions = {
    inspectContext: () => viewer,
    async find(action, { seen }) {
      const row = (rows[action] || []).find((candidate) => !seen.has(candidate.id));
      calls.push(['find', action, row?.id || null]);
      return row || null;
    },
    async execute(action, candidate, grant) {
      calls.push(['execute', action, candidate.id]);
      grant.assertCurrent();
      return execute ? execute(action, candidate, grant) : { verified: true, label: candidate.label };
    },
  };
  const session = createPresenceSession({ nativeActions, locks, now: () => clock, random: () => 0,
    wait, minDelayMs: 0, maxDelayMs: 0, onUpdate: state => updates.push(state) });
  return { session, calls, updates, locks, setClock: value => { clock = value; },
    setViewer: value => { viewer = value; } };
}

const candidate = (action, id) => ({ action, id, label: id });

test('normalizes a small session and makes story reactions include story viewing', () => {
  const value = normalizePresenceSessionOptions({ maxActions: 4,
    actions: { reactStories: true, likePosts: true, unknown: true } });
  assert.equal(value.maxActions, 4);
  assert.deepEqual(value.actions, {
    viewStories: true, reactStories: true, likePosts: true,
    followPeople: false, acceptRequests: false,
  });
  assert.equal(Object.isFrozen(value), true);
});

test('runs only the reviewed finite action set and verifies every result', async () => {
  const f = fixture({ candidates: {
    viewStories: [candidate('viewStories', 'story:1')],
    likePosts: [candidate('likePosts', 'post:1'), candidate('likePosts', 'post:2')],
  } });
  const review = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 3, actions: { viewStories: true, likePosts: true } },
    expiresAt: NOW + 60_000 });
  const result = await f.session.start(review);
  assert.equal(result.status, 'completed');
  assert.equal(result.completed, 3);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'execute').map(([, action, id]) => [action, id]), [
    ['viewStories', 'story:1'], ['likePosts', 'post:1'], ['likePosts', 'post:2'],
  ]);
  assert.equal(result.results.every(row => row.status === 'completed'), true);
});

test('review authority is runtime-only, one-use, account-bound, and expiring', async () => {
  const f = fixture({ candidates: { likePosts: [candidate('likePosts', 'post:1')] } });
  assert.throws(() => f.session.createReview({ accountId: 'viewer', options: { actions: {} } }), /action-required/);
  const review = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 1, actions: { likePosts: true } }, expiresAt: NOW + 1_000 });
  await f.session.start(review);
  await assert.rejects(f.session.start(review), /review-required/);
  const copied = structuredClone(review);
  await assert.rejects(f.session.start(copied), /review-required/);
  const changed = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 1, actions: { likePosts: true } }, expiresAt: NOW + 1_000 });
  f.setViewer({ accountVerified: true, usable: true, accountId: 'other' });
  await assert.rejects(f.session.start(changed), /context-changed/);
  f.setViewer({ accountVerified: true, usable: true, accountId: 'viewer' });
  const expired = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 1, actions: { likePosts: true } }, expiresAt: NOW + 1 });
  f.setClock(NOW + 2);
  await assert.rejects(f.session.start(expired), /review-expired/);
});

test('uncertain outcomes stop without retrying the same target', async () => {
  const f = fixture({
    candidates: { followPeople: [candidate('followPeople', 'profile:one')] },
    execute: async () => ({ verified: false, uncertain: true, reason: 'relationship-not-confirmed' }),
  });
  const review = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 3, actions: { followPeople: true } }, expiresAt: NOW + 60_000 });
  const result = await f.session.start(review);
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.completed, 0);
  assert.equal(result.uncertain, 1);
  assert.equal(f.calls.filter(([kind]) => kind === 'execute').length, 1);
});

test('Pause prevents the next mutation and Resume continues the same review', async () => {
  let releaseWait;
  const waiting = new Promise(resolve => { releaseWait = resolve; });
  let waits = 0;
  const f = fixture({
    candidates: { likePosts: [candidate('likePosts', 'post:1'), candidate('likePosts', 'post:2')] },
    wait: async () => { waits += 1; await waiting; },
  });
  const review = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 2, actions: { likePosts: true } }, expiresAt: NOW + 60_000 });
  const running = f.session.start(review);
  while (waits === 0) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.session.pause(), true);
  releaseWait();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.calls.filter(([kind]) => kind === 'execute').length, 1);
  assert.equal(f.session.snapshot().status, 'paused');
  assert.equal(f.session.resume(), true);
  const result = await running;
  assert.equal(result.status, 'completed');
  assert.equal(result.completed, 2);
});

test('Stop aborts waits and prevents the next mutation', async () => {
  let waiting = false;
  const f = fixture({
    candidates: { likePosts: [candidate('likePosts', 'post:1'), candidate('likePosts', 'post:2')] },
    wait: (_ms, signal) => new Promise((resolve, reject) => {
      waiting = true;
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    }),
  });
  const review = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 2, actions: { likePosts: true } }, expiresAt: NOW + 60_000 });
  const running = f.session.start(review);
  while (!waiting) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.session.stop(), true);
  const result = await running;
  assert.equal(result.status, 'stopped');
  assert.equal(result.completed, 1);
  assert.equal(f.calls.filter(([kind]) => kind === 'execute').length, 1);
});

test('Presence and Ghost use one exclusive account activity lane', async () => {
  const locks = lockManager();
  let waiting = false;
  const f = fixture({ locks,
    candidates: { likePosts: [candidate('likePosts', 'post:1'), candidate('likePosts', 'post:2')] },
    wait: (_ms, signal) => new Promise((resolve, reject) => {
      waiting = true;
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    }),
  });
  const review = f.session.createReview({ accountId: 'viewer',
    options: { maxActions: 2, actions: { likePosts: true } }, expiresAt: NOW + 60_000 });
  const running = f.session.start(review);
  while (!waiting) await new Promise(resolve => setTimeout(resolve, 0));
  const lockName = 'insta-toolbox:account-activity:iguser-v1-viewer';
  assert.equal(locks.held.has(lockName), true);
  const ghostWhilePresenceRuns = await locks.request(lockName,
    { mode: 'exclusive', ifAvailable: true }, async lock => Boolean(lock));
  assert.equal(ghostWhilePresenceRuns, false);
  f.session.stop();
  await running;
  const ghostAfterPresenceStops = await locks.request(lockName,
    { mode: 'exclusive', ifAvailable: true }, async lock => Boolean(lock));
  assert.equal(ghostAfterPresenceStops, true);
});

test('restriction or account loss before dispatch stops the session', async () => {
  let inspections = 0;
  const f = fixture({ candidates: { likePosts: [candidate('likePosts', 'post:1')] } });
  const original = f.session;
  const review = original.createReview({ accountId: 'viewer',
    options: { maxActions: 1, actions: { likePosts: true } }, expiresAt: NOW + 60_000 });
  f.setViewer({ accountVerified: true, usable: true, accountId: 'viewer', rateLimited: true });
  await assert.rejects(original.start(review), /context-changed/);
  assert.equal(inspections, 0);
});
