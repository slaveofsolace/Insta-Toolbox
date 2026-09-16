import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxCoordinator, createInboxReview } from '../extension/inbox-coordinator.js';
import { createInboxCheckpointStore } from '../extension/inbox-checkpoint-store.js';

const NOW = Date.parse('2026-09-16T16:00:00Z');
function checkpoint(index = 0, accountId = 'account_a') {
  const review = createInboxReview({ accountId, threadIds: ['101', '102'], workerCount: 1 }, NOW + index);
  return createInboxCoordinator({ review, save: async () => {}, now: () => NOW + index }).snapshot();
}
function harness(extra = {}) {
  let stored = null;
  let accountId = 'account_a';
  let writes = 0;
  const store = createInboxCheckpointStore({
    read: async () => structuredClone(stored),
    write: async (value) => { writes += 1; stored = structuredClone(value); },
    inspectAccount: () => ({ accountId, accountVerified: true, restriction: false }),
    ...extra,
  });
  return { store, setAccount(value) { accountId = value; }, setRecord(value) { stored = value; }, get record() { return stored; }, get writes() { return writes; } };
}

test('keeps twenty recent jobs and replaces same-review snapshots without accumulating counts', async () => {
  const h = harness();
  for (let i = 0; i < 22; i += 1) await h.store.save(checkpoint(i));
  assert.equal(h.record.jobs.length, 20);
  const latest = checkpoint(21); latest.tasks[0].messageRemovals = 2;
  await h.store.save(latest); await h.store.save(latest);
  assert.equal(h.record.jobs.length, 20);
  assert.equal((await h.store.load()).tasks[0].messageRemovals, 2);
  assert.equal((await h.store.history())[19].review.reviewedAt, NOW + 2);
});

test('sanitizes nested payload and authority fields while retaining exact review/task metadata', async () => {
  const h = harness(); const data = checkpoint();
  data.authorized = true; data.lease = { secret: 'private marker' }; data.body = 'private marker';
  data.review.cookie = 'private marker'; data.review.confirmed = true;
  data.tasks[0].message = 'private marker'; data.tasks[0].candidate = { text: 'private marker' };
  data.tasks[0].reason = 'private marker';
  data.status = 'running'; data.tasks[0].status = 'running';
  await h.store.save(data);
  assert.equal(JSON.stringify(h.record).includes('private marker'), false);
  assert.equal('authorized' in h.record.jobs[0], false);
  assert.equal('confirmed' in h.record.jobs[0].review, false);
  const loaded = await h.store.load();
  assert.equal(loaded.status, 'paused');
  assert.equal(loaded.reason, 'review-required-after-restart');
  assert.equal(loaded.tasks[0].status, 'partial');
});

test('pending dispatch becomes uncertain on load and remains compatible with coordinator recovery', async () => {
  const h = harness(); const data = checkpoint();
  data.status = 'running'; data.tasks[0].status = 'running';
  data.tasks[0].messageRemovals = 3;
  data.pendingMutation = { threadId: '101', kind: 'message', phase: 'dispatched', candidate: { text: 'secret' } };
  await h.store.save(data);
  const loaded = await h.store.load();
  assert.deepEqual(loaded.pendingMutation, { threadId: '101', kind: 'message', phase: 'uncertain' });
  assert.equal(loaded.tasks[0].messageRemovals, 3);
  assert.equal(loaded.tasks[0].status, 'uncertain');
  const coordinator = createInboxCoordinator({ review: loaded.review, restored: loaded, save: async () => {}, now: () => NOW });
  await assert.rejects(coordinator.claim(0, 'account_a'));
  assert.equal(coordinator.snapshot().reason, 'review-required-after-restart');
});

test('history and latest load are account-filtered and account switches during reads reject', async () => {
  const h = harness(); await h.store.save(checkpoint());
  h.setAccount('account_b'); await h.store.save(checkpoint(1, 'account_b'));
  assert.equal((await h.store.history()).length, 1);
  assert.equal((await h.store.load()).review.accountId, 'account_b');
  await assert.rejects(h.store.save(checkpoint()), /account-mismatch/);
  let owner = 'account_a';
  const store = createInboxCheckpointStore({ read: async () => { owner = 'account_b'; return h.record; }, write: async () => {}, inspectAccount: () => ({ accountId: owner, accountVerified: true }) });
  await assert.rejects(store.load(), /account-changed/);
});

test('unverified account, malformed versions, tasks and counters fail without writes', async () => {
  const h = harness();
  for (const mutate of [
    (s) => { s.version = 2; }, (s) => { s.tasks.pop(); },
    (s) => { s.tasks[0].messageRemovals = -1; }, (s) => { s.tasks[0].workerIndex = 99; },
    (s) => { s.pendingMutation = { threadId: '999', kind: 'message', phase: 'prepared' }; },
  ]) { const data = checkpoint(); mutate(data); await assert.rejects(h.store.save(data)); }
  h.setRecord({ version: 99, jobs: [] }); await assert.rejects(h.store.load(), /history-invalid/);
  assert.equal(h.writes, 0);
  const noAccount = harness({ inspectAccount: () => ({ accountId: 'account_a', accountVerified: false }) });
  await assert.rejects(noAccount.store.history(), /verified-account-required/);
});

test('delayed writes serialize and capture caller snapshots immediately', async () => {
  let release; let stored; let writes = 0;
  const store = createInboxCheckpointStore({
    read: async () => stored,
    write: async (data) => { writes += 1; if (writes === 1) await new Promise((r) => { release = r; }); stored = data; },
    inspectAccount: () => ({ accountId: 'account_a', accountVerified: true }),
  });
  const first = store.save(checkpoint());
  await new Promise((r) => setTimeout(r, 0));
  const newer = checkpoint(); newer.tasks[0].messageRemovals = 2;
  const second = store.save(newer); newer.tasks[0].messageRemovals = 900;
  assert.equal(writes, 1); release(); await first; await second;
  assert.equal(stored.jobs[0].tasks[0].messageRemovals, 2);
  assert.equal(writes, 2);
  await assert.rejects(store.save(checkpoint()), /count-regression/);
});

test('timed-out write fences all newer writes even after late settlement', async () => {
  let release; let writes = 0; let stored = null;
  const h = harness({ timeoutMs: 10, read: async () => stored, write: async (value) => { writes += 1; await new Promise((r) => { release = r; }); stored = value; } });
  await assert.rejects(h.store.save(checkpoint()), /write-timeout/);
  await assert.rejects(h.store.save(checkpoint(1)), /write-timeout/);
  assert.equal(writes, 1);
  release(); await new Promise((r) => setTimeout(r, 0));
  await assert.rejects(h.store.save(checkpoint(2)), /write-timeout/);
  assert.equal(stored.jobs.length, 1);
});

test('write rejection is visible and fenced; timed-out read writes nothing', async () => {
  const h = harness({ write: async () => { throw new Error('private disk path'); } });
  await assert.rejects(h.store.save(checkpoint()), /checkpoint-write-failed/);
  await assert.rejects(h.store.save(checkpoint(1)), /checkpoint-write-failed/);
  const stalled = harness({ timeoutMs: 5, read: async () => new Promise(() => {}) });
  await assert.rejects(stalled.store.load(), /checkpoint-read-timeout/);
  await assert.rejects(stalled.store.save(checkpoint()), /checkpoint-read-timeout/);
  assert.equal(stalled.writes, 0);
});

test('account switch while write settles never reports save success for the new account', async () => {
  let owner = 'account_a'; let stored;
  const store = createInboxCheckpointStore({ read: async () => null, write: async (data) => { stored = data; owner = 'account_b'; }, inspectAccount: () => ({ accountId: owner, accountVerified: true }) });
  await assert.rejects(store.save(checkpoint()), /account-changed/);
  assert.equal(stored.jobs[0].review.accountId, 'account_a');
});

test('loads legacy single checkpoint and migrates to history on next successful save', async () => {
  const h = harness(); const old = checkpoint();
  old.tasks[0].messageRemovals = 4; old.authorized = true;
  h.setRecord(old);
  assert.equal((await h.store.load()).tasks[0].messageRemovals, 4);
  assert.equal((await h.store.history()).length, 1);
  await h.store.save(checkpoint(1));
  assert.equal(h.record.version, 1);
  assert.equal(h.record.jobs.length, 2);
  assert.equal('authorized' in h.record.jobs[1], false);
});

test('missing viewer does not latch storage: entering inbox can retry load', async () => {
  let verified = false;
  const h = harness({ inspectAccount: () => ({ accountId: 'account_a', accountVerified: verified }) });
  h.setRecord(checkpoint());
  await assert.rejects(h.store.load(), /verified-account-required/);
  verified = true;
  assert.equal((await h.store.load()).review.accountId, 'account_a');
});

test('parallel pending markers and batch assignments retain separate counters and uncertainty', async () => {
  const h = harness();
  const review = createInboxReview({ accountId: 'account_a', threadIds: ['101', '102'], workerCount: 2, mutationConcurrency: 2, assignmentMode: 'batches' }, NOW);
  const data = createInboxCoordinator({ review, save: async () => {}, now: () => NOW, concurrencyCapability: { version: 1, accountId: 'account_a', maxConcurrentMutations: 2, expiresAt: NOW + 1000 } }).snapshot();
  data.pendingMutations = [{ threadId: '101', kind: 'message', phase: 'prepared' }, { threadId: '102', kind: 'reaction', phase: 'uncertain' }];
  data.tasks[1].reactionRemovals = 2;
  await h.store.save(data);
  const loaded = await h.store.load();
  assert.equal(loaded.pendingMutations.length, 2);
  assert.ok(loaded.tasks.every((task) => task.status === 'uncertain'));
  assert.equal(loaded.tasks[1].workerIndex, 1);
  assert.equal(loaded.tasks[1].batchIndex, 0);
  assert.equal(loaded.tasks[1].reactionRemovals, 2);
  assert.equal('concurrencyCapability' in loaded, false);
});

test('late acknowledgments fail elapsed deadlines before a throttled timer callback runs', async () => {
  let clock = NOW; let writes = 0;
  const h = harness({ timeoutMs: 1000, now: () => clock, write: async () => { writes += 1; clock += 1001; } });
  await assert.rejects(h.store.save(checkpoint()), /write-timeout/);
  await assert.rejects(h.store.save(checkpoint(1)), /write-timeout/);
  assert.equal(writes, 1);
});
