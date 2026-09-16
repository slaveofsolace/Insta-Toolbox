import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxCoordinator, createInboxReview, inboxReviewKey, INBOX_COORDINATOR_CAPABILITIES } from '../extension/inbox-coordinator.js';

const start = 1_000_000;
function fixture(patch = {}, options = {}) {
  let time = start;
  const writes = [];
  const review = createInboxReview({ accountId: 'account_fixture', threadIds: ['thread_a', 'thread_b', 'thread_c', 'thread_d'], ...patch }, time);
  const job = createInboxCoordinator({ review, now: () => time, save: async (state) => { writes.push(state); }, ...options });
  return { review, job, writes, clock: () => time, advance: (ms) => { time += ms; }, approve: () => job.approve(inboxReviewKey(review), review.accountId) };
}
function adapter(lease, patch = {}) {
  return {
    accountId: 'account_fixture', actionId: 'message_fixture', kind: 'message', delayMs: 1_000,
    inspect: async () => ({ accountId: 'account_fixture', threadId: lease.threadId, ownershipVerified: true, withinReviewedBoundary: true, exactTarget: true }),
    execute: async () => ({ verified: true }), ...patch,
  };
}

test('review freezes ordered deduplicated threads and rejects invalid scope, count, identity, and expiry', () => {
  const { review } = fixture({ threadIds: ['thread_b', 'thread_a', 'thread_b'], workerCount: 2 });
  assert.deepEqual(review.threadIds, ['thread_b', 'thread_a']);
  assert.throws(() => review.threadIds.push('thread_c'));
  for (const patch of [{ threadIds: [] }, { threadIds: ['../account'] }, { workerCount: 6 }, { accountId: '' }, { scope: 'newest', limit: Infinity }, { speed: 'unlimited' }, { expiresAt: start }]) {
    assert.throws(() => fixture(patch));
  }
  assert.throws(() => createInboxReview(Object.create({ accountId: 'account_fixture', threadIds: ['thread_a'] }), start), /review-invalid/);
  assert.throws(() => fixture({ discovery: Object.create({ complete: true }) }), /review-invalid/);
});

test('approval binds all reviewed settings; metadata alone never permits a claim', async () => {
  const f = fixture();
  await assert.rejects(f.job.claim(0, f.review.accountId), /approval-required/);
  await assert.rejects(f.job.approve(inboxReviewKey({ ...f.review, speed: 'fast' }), f.review.accountId), /review-changed/);
  await f.approve();
  assert.equal((await f.job.claim(0, f.review.accountId)).threadId, 'thread_a');
});

test('two workers receive stable contiguous assignments and claims are atomic', async () => {
  const f = fixture({ workerCount: 2 }); await f.approve();
  const [a, b] = await Promise.all([f.job.claim(0, f.review.accountId), f.job.claim(1, f.review.accountId)]);
  assert.equal(a.threadId, 'thread_a'); assert.equal(b.threadId, 'thread_c');
  await assert.rejects(f.job.claim(0, f.review.accountId), /already-assigned/);
  await assert.rejects(f.job.finish({ ...a }, 'completed'), /stale-worker/);
  await f.job.finish(a, 'completed');
  assert.equal((await f.job.claim(0, f.review.accountId)).threadId, 'thread_b');
});

test('only one account mutation dispatches at a time and pacing applies across workers', async () => {
  const f = fixture({ workerCount: 2 }); await f.approve();
  const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const first = f.job.mutate(a, adapter(a, { execute: async () => { entered(); return new Promise((resolve) => { release = resolve; }); } }));
  await ready;
  let calls = 0;
  const second = f.job.mutate(b, adapter(b, { execute: async () => { calls += 1; return { verified: true }; } }));
  release({ verified: true }); await first;
  await assert.rejects(second, /account-pacing/); assert.equal(calls, 0);
  f.advance(1_000); await f.job.mutate(b, adapter(b));
  assert.equal(f.job.snapshot().tasks[0].messageRemovals, 1);
  assert.equal(f.job.snapshot().tasks[2].messageRemovals, 1);
});

test('ownership, exact thread, account and historical boundary are required before dispatch', async () => {
  for (const bad of [{ ownershipVerified: false }, { exactTarget: false }, { withinReviewedBoundary: false }, { threadId: 'other' }, { accountId: 'other' }]) {
    const f = fixture(); await f.approve(); const a = await f.job.claim(0, f.review.accountId); let calls = 0;
    const normal = adapter(a);
    await assert.rejects(f.job.mutate(a, { ...normal, inspect: async () => ({ ...await normal.inspect(), ...bad }), execute: async () => { calls += 1; } }), /target-not-proven/);
    assert.equal(calls, 0); assert.equal(f.job.snapshot().tasks[0].messageRemovals, 0);
  }
});

test('unapproved reactions fail and approved reactions have separate verified counters', async () => {
  const f = fixture(); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  await assert.rejects(f.job.mutate(a, adapter(a, { kind: 'reaction' })), /reaction-not-approved/);
  const r = fixture({ removeOwnReactions: true }); await r.approve(); const b = await r.job.claim(0, r.review.accountId);
  await r.job.mutate(b, adapter(b, { kind: 'reaction' }));
  assert.equal(r.job.snapshot().tasks[0].reactionRemovals, 1);
  assert.equal(r.job.snapshot().tasks[0].messageRemovals, 0);
});

test('finite scope is enforced independently of the worker adapter', async () => {
  const f = fixture({ scope: 'newest', limit: 1 }); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  await f.job.mutate(a, adapter(a)); f.advance(1_000);
  await assert.rejects(f.job.mutate(a, adapter(a, { actionId: 'message_two' })), /message-limit-reached/);
});

test('uncertain outcomes revoke authority, record zero success, and prevent blind retry', async () => {
  const f = fixture(); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  const result = await f.job.mutate(a, adapter(a, { execute: async () => { throw new Error('ack-lost'); } }));
  assert.equal(result.verified, false); assert.equal(result.state.status, 'paused');
  assert.equal(result.state.tasks[0].status, 'uncertain'); assert.equal(result.state.tasks[0].messageRemovals, 0);
  await assert.rejects(f.approve(), /reconciliation-required/);
  await assert.rejects(f.job.retireWorker(a.threadId, { terminated: true }), /reconciliation-required/);
});

test('Stop during inspection prevents the next dispatch', async () => {
  const f = fixture(); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  let inspected, release, clicks = 0; const ready = new Promise((resolve) => { inspected = resolve; });
  const normal = adapter(a);
  const mutation = f.job.mutate(a, { ...normal, inspect: async () => { inspected(); await new Promise((resolve) => { release = resolve; }); return normal.inspect(); }, execute: async () => { clicks += 1; return { verified: true }; } });
  await ready; const stopped = f.job.interrupt('stop', { stop: true }); release();
  await assert.rejects(mutation, /inspection-cancelled|stop/); await stopped;
  assert.equal(clicks, 0); assert.equal(f.job.snapshot().status, 'stopped');
});

test('Stop settles a dispatched result without losing verified removals or starting another', async () => {
  const f = fixture(); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  let entered, release; const ready = new Promise((resolve) => { entered = resolve; });
  const mutation = f.job.mutate(a, adapter(a, { execute: async ({ signal }) => { entered(); await new Promise((resolve) => { release = resolve; }); assert.equal(signal.aborted, true); return { verified: true }; } }));
  await ready; const stopped = f.job.interrupt('stop', { stop: true }); release();
  await mutation; await stopped;
  assert.equal(f.job.snapshot().tasks[0].messageRemovals, 1);
  await assert.rejects(f.job.mutate(a, adapter(a)), /stop/);
});

test('elapsed expiry and account switching revoke authority even after a background delay', async () => {
  const f = fixture(); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  f.advance(20 * 60 * 1_000);
  await assert.rejects(f.job.mutate(a, adapter(a)), /approval-expired/);
  const b = fixture(); await b.approve();
  await assert.rejects(b.job.claim(0, 'other_account'), /account-changed/);
});

test('restart never restores authority and pending dispatch requires reconciliation', async () => {
  const f = fixture(); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  await f.job.mutate(a, adapter(a));
  const checkpoint = f.writes.find((write) => write.pendingMutation?.phase === 'dispatched');
  assert.ok(checkpoint); assert.equal('authority' in checkpoint, false);
  const restored = createInboxCoordinator({ review: f.review, restored: checkpoint, save: async () => {}, now: () => start });
  assert.equal(restored.snapshot().tasks[0].status, 'uncertain');
  await assert.rejects(restored.claim(0, f.review.accountId), /review-required-after-restart/);
  await assert.rejects(restored.approve(inboxReviewKey(f.review), f.review.accountId), /reconciliation-required/);
  assert.throws(() => createInboxCoordinator({ review: f.review, restored: { ...checkpoint, review: { ...checkpoint.review, accountId: 'other' } }, save: async () => {} }), /checkpoint-invalid/);
});

test('storage failure before dispatch prevents execution', async () => {
  let writes = 0, clicks = 0;
  const f = fixture({}, { save: async () => { writes += 1; if (writes === 3) throw new Error('disk-full'); } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  await assert.rejects(f.job.mutate(a, adapter(a, { execute: async () => { clicks += 1; return { verified: true }; } })), /disk-full/);
  assert.equal(clicks, 0); assert.equal(f.job.snapshot().reason, 'storage-failed');
});

test('frozen inspection is bounded without dispatch; an unacknowledged dispatch remains uncertain', async () => {
  const first = fixture({}, { stageTimeoutMs: 5 }); await first.approve();
  const a = await first.job.claim(0, first.review.accountId);
  await assert.rejects(first.job.mutate(a, adapter(a, { inspect: () => new Promise(() => {}) })), /worker-response-timeout/);
  assert.equal(first.job.snapshot().reason, 'worker-response-timeout');
  assert.equal(first.job.snapshot().pendingMutation, null);
  const second = fixture({}, { stageTimeoutMs: 5 }); await second.approve();
  const b = await second.job.claim(0, second.review.accountId);
  const result = await second.job.mutate(b, adapter(b, { execute: () => new Promise(() => {}) }));
  assert.equal(result.verified, false); assert.equal(result.state.pendingMutation.phase, 'uncertain');
  await assert.rejects(second.approve(), /reconciliation-required/);
});

test('storage failure after a verified removal retains uncertainty in the last durable dispatch marker', async () => {
  const writes = []; let count = 0;
  const f = fixture({}, { save: async (state) => { count += 1; if (count === 5) throw new Error('disk-full'); writes.push(state); } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  await assert.rejects(f.job.mutate(a, adapter(a)), /disk-full/);
  assert.equal(f.job.snapshot().tasks[0].messageRemovals, 1);
  const restored = createInboxCoordinator({ review: f.review, restored: writes.at(-1), now: () => start, save: async () => {} });
  assert.equal(restored.snapshot().tasks[0].status, 'uncertain');
});

test('missing workers are never replaced based only on silence; retired lease stays fenced', async () => {
  const f = fixture({ workerCount: 2 }); await f.approve(); const a = await f.job.claim(0, f.review.accountId);
  await f.job.interrupt('worker-silent');
  await assert.rejects(f.approve(), /reconciliation-required/);
  await assert.rejects(f.job.retireWorker(a.threadId), /worker-termination-required/);
  await f.job.retireWorker(a.threadId, { terminated: true }); await f.approve();
  const replacement = await f.job.claim(0, f.review.accountId);
  assert.equal(replacement.threadId, 'thread_b');
  await assert.rejects(f.job.mutate(a, adapter(a)), /stale-worker/);
});

test('completed selected inventory does not claim complete inbox discovery', async () => {
  const f = fixture({ threadIds: ['thread_a'], discovery: { sections: ['primary'], complete: false } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId); await f.job.finish(a, 'completed');
  assert.equal(f.job.snapshot().status, 'completed');
  assert.equal(f.job.snapshot().review.discovery.complete, false);
});

test('checkpoint and snapshot callers cannot mutate internal review, assignments, or counters', async () => {
  const f = fixture(); await f.approve();
  const state = f.job.snapshot(); state.review.threadIds[0] = 'other'; state.review.accountId = 'other'; state.tasks[0].messageRemovals = 900;
  f.writes[0].tasks[0].threadId = 'other';
  assert.equal(f.job.snapshot().review.accountId, 'account_fixture');
  assert.equal(f.job.snapshot().review.threadIds[0], 'thread_a');
  assert.equal(f.job.snapshot().tasks[0].messageRemovals, 0);
  assert.equal((await f.job.claim(0, f.review.accountId)).threadId, 'thread_a');
});

test('prepared worker bounds and mutation concurrency are separate explicit capabilities', () => {
  assert.equal(INBOX_COORDINATOR_CAPABILITIES.maxPreparedWorkers, 5);
  assert.equal(INBOX_COORDINATOR_CAPABILITIES.defaultConcurrentMutations, 1);
  assert.equal(INBOX_COORDINATOR_CAPABILITIES.maxConcurrentMutations, 5);
  for (const workerCount of [1, 2, 3, 4, 5]) assert.equal(fixture({ workerCount }).review.workerCount, workerCount);
  for (const workerCount of [0, -1, 1.5, 6, Infinity, '5']) assert.throws(() => fixture({ workerCount }), /worker-count-invalid/);
  for (const mutationConcurrency of [2, 5]) assert.throws(() => fixture({ workerCount: 5, mutationConcurrency }), /concurrent-mutations-unavailable/);
  for (const mutationConcurrency of [0, -1, 1.5, '5', 6, 100]) assert.throws(() => fixture({ workerCount: 5, mutationConcurrency }), /mutation-concurrency-invalid/);
  assert.throws(() => fixture({ assignmentMode: 'unbounded' }), /assignment-mode-invalid/);
  assert.throws(() => { INBOX_COORDINATOR_CAPABILITIES.maxConcurrentMutations = 100; }, TypeError);
});

test('existing review keys remain unchanged and batching cannot be added to an approval', async () => {
  const f = fixture({ workerCount: 2 });
  assert.equal(Object.hasOwn(f.review, 'assignmentMode'), false);
  assert.equal(Object.hasOwn(f.review, 'mutationConcurrency'), false);
  const changed = createInboxReview({ ...f.review, assignmentMode: 'batches', mutationConcurrency: 1 }, start);
  assert.notEqual(inboxReviewKey(changed), inboxReviewKey(f.review));
  await assert.rejects(f.job.approve(inboxReviewKey(changed), f.review.accountId), /review-changed/);
  assert.equal(f.job.batchProgress().mode, 'contiguous');
});

test('ten conversations use two frozen batches of five and refill only after the whole batch settles', async () => {
  const threadIds = Array.from({ length: 10 }, (_, i) => `thread_${i + 1}`);
  const f = fixture({ threadIds, workerCount: 5, assignmentMode: 'batches', mutationConcurrency: 1 });
  await f.approve();
  const first = await Promise.all(Array.from({ length: 5 }, (_, index) => f.job.claim(index, f.review.accountId)));
  assert.deepEqual(first.map((lease) => lease.threadId), threadIds.slice(0, 5));
  assert.deepEqual(f.job.batchProgress(), { mode: 'batches', currentBatchIndex: 0, totalBatches: 2, preparedWorkerLimit: 5, mutationConcurrency: 1 });
  await f.job.finish(first[0], 'completed');
  assert.equal(await f.job.claim(0, f.review.accountId), null);
  for (const lease of first.slice(1)) await f.job.finish(lease, 'completed');
  const second = await Promise.all(Array.from({ length: 5 }, (_, index) => f.job.claim(index, f.review.accountId)));
  assert.deepEqual(second.map((lease) => lease.threadId), threadIds.slice(5));
  assert.equal(f.job.batchProgress().currentBatchIndex, 1);
  for (const lease of second) await f.job.finish(lease, 'completed');
  assert.equal(f.job.snapshot().status, 'completed');
  assert.equal(f.job.batchProgress().currentBatchIndex, null);
  await assert.rejects(f.job.mutate(first[0], adapter(first[0])), /approval-required/);
});

test('a short final batch never invents targets or leaves unused workers assigned', async () => {
  const threadIds = Array.from({ length: 7 }, (_, i) => `thread_${i + 1}`);
  const f = fixture({ threadIds, workerCount: 5, assignmentMode: 'batches' }); await f.approve();
  for (let index = 0; index < 5; index += 1) {
    const lease = await f.job.claim(index, f.review.accountId); await f.job.finish(lease, index === 0 ? 'skipped' : 'completed');
  }
  const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  for (let index = 2; index < 5; index += 1) assert.equal(await f.job.claim(index, f.review.accountId), null);
  assert.deepEqual([a.threadId, b.threadId], threadIds.slice(5));
  await f.job.finish(a, 'completed'); await f.job.finish(b, 'completed');
  assert.equal(f.job.snapshot().status, 'partial');
  assert.equal(f.job.snapshot().tasks.length, 7);
});

test('five prepared workers still share one dispatch and one account pacing deadline', async () => {
  const f = fixture({ threadIds: ['a', 'b', 'c', 'd', 'e'], workerCount: 5, assignmentMode: 'batches' });
  await f.approve();
  const leases = await Promise.all(Array.from({ length: 5 }, (_, index) => f.job.claim(index, f.review.accountId)));
  let calls = 0;
  const results = await Promise.allSettled(leases.map((lease) => f.job.mutate(lease, adapter(lease, {
    execute: async () => { calls += 1; return { verified: true }; },
  }))));
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(results.slice(1).every((result) => result.reason.message === 'account-pacing'));
  assert.equal(f.job.snapshot().nextActionAt, start + 1_000);
});

test('uncertain batch outcomes block refill and restart never restores approved batching authority', async () => {
  const f = fixture({ threadIds: ['a', 'b', 'c', 'd'], workerCount: 2, assignmentMode: 'batches' }); await f.approve();
  const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  await f.job.finish(b, 'completed');
  await f.job.mutate(a, adapter(a, { execute: async () => ({ verified: false }) }));
  assert.equal(f.job.batchProgress().currentBatchIndex, 0);
  await assert.rejects(f.job.claim(1, f.review.accountId), /removal-not-proven/);
  const restored = createInboxCoordinator({ review: f.review, restored: f.job.snapshot(), save: async () => {}, now: () => start });
  await assert.rejects(restored.approve(inboxReviewKey(f.review), f.review.accountId), /reconciliation-required/);
  await assert.rejects(restored.claim(0, f.review.accountId), /review-required-after-restart/);
  const altered = f.job.snapshot(); altered.tasks[2].batchIndex = 0;
  assert.throws(() => createInboxCoordinator({ review: f.review, restored: altered, save: async () => {}, now: () => start }), /checkpoint-invalid/);
});

test('batch Stop prevents queued mutations and batch advancement without losing dispatched proof', async () => {
  const f = fixture({ threadIds: ['a', 'b', 'c', 'd'], workerCount: 2, assignmentMode: 'batches' }); await f.approve();
  const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  let entered, release, calls = 0;
  const ready = new Promise((resolve) => { entered = resolve; });
  const first = f.job.mutate(a, adapter(a, { execute: async () => { entered(); return new Promise((resolve) => { release = resolve; }); } }));
  await ready;
  const second = f.job.mutate(b, adapter(b, { execute: async () => { calls += 1; return { verified: true }; } }));
  const rejected = assert.rejects(second, /stop/);
  const stopped = f.job.interrupt('stop', { stop: true });
  release({ verified: true }); await first; await rejected; await stopped;
  assert.equal(calls, 0); assert.equal(f.job.snapshot().tasks[0].messageRemovals, 1);
  assert.equal(f.job.batchProgress().currentBatchIndex, 0);
  assert.ok(f.job.snapshot().tasks.slice(2).every((task) => task.status === 'pending'));
});

const acceptedCapability = (maxConcurrentMutations) => ({ version: 1, accountId: 'account_fixture', maxConcurrentMutations, expiresAt: start + 60_000 });
function concurrentFixture(count = 2, options = {}) {
  return fixture({ threadIds: Array.from({ length: count }, (_, i) => `thread_${i}`), workerCount: count, mutationConcurrency: count, assignmentMode: 'batches' }, {
    concurrencyCapability: acceptedCapability(count), ...options,
  });
}
async function heldMutation(f, lease, patch = {}) {
  let entered, settle;
  const ready = new Promise((resolve) => { entered = resolve; });
  const result = f.job.mutate(lease, adapter(lease, {
    execute: async ({ signal }) => { entered(); return new Promise((resolve) => { settle = (value) => resolve({ ...value, aborted: signal.aborted }); }); },
    ...patch,
  }));
  await ready;
  return { result, settle };
}

test('concurrent admission requires an account-bound live runtime capability independent of review JSON', () => {
  for (const capability of [null, acceptedCapability(1), { ...acceptedCapability(5), accountId: 'other' },
    { ...acceptedCapability(5), expiresAt: start }, { ...acceptedCapability(5), maxConcurrentMutations: 6 }]) {
    assert.throws(() => concurrentFixture(2, { concurrencyCapability: capability }), /concurrent-mutations-unavailable/);
  }
  const f = concurrentFixture(5);
  assert.equal(f.job.batchProgress().mutationConcurrency, 5);
  assert.equal('concurrencyCapability' in f.job.snapshot(), false);
  assert.equal('concurrencyCapability' in f.review, false);
});

test('two then five concurrent actions admit through one pacing clock and settle out of order', async () => {
  for (const count of [2, 5]) {
    const f = concurrentFixture(count); await f.approve();
    const leases = await Promise.all(Array.from({ length: count }, (_, i) => f.job.claim(i, f.review.accountId)));
    const actions = [];
    for (const lease of leases) {
      actions.push(await heldMutation(f, lease));
      f.advance(1_000);
    }
    assert.equal(f.job.snapshot().pendingMutations.length, count);
    assert.equal(f.job.snapshot().tasks.reduce((sum, task) => sum + task.messageRemovals, 0), 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      actions[index].settle({ verified: true }); await actions[index].result;
      assert.equal(f.job.snapshot().tasks[index].messageRemovals, 1);
    }
    assert.equal(f.job.snapshot().pendingMutations.length, 0);
    assert.equal(f.job.snapshot().nextActionAt, start + count * 1_000);
  }
});

test('concurrent workers cannot multiply pacing or overlap mutations in one conversation', async () => {
  const f = concurrentFixture(); await f.approve();
  const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  const first = await heldMutation(f, a);
  await assert.rejects(f.job.mutate(a, adapter(a, { actionId: 'other' })), /thread-mutation-in-flight/);
  await assert.rejects(f.job.finish(a, 'completed'), /completion-invalid/);
  await assert.rejects(f.job.retireWorker(a.threadId, { terminated: true, reconciled: true }), /worker-settlement-required/);
  await assert.rejects(f.job.mutate(b, adapter(b)), /account-pacing/);
  f.advance(1_000); const second = await heldMutation(f, b);
  first.settle({ verified: true }); second.settle({ verified: true });
  await Promise.all([first.result, second.result]);
  await assert.rejects(f.job.mutate(a, adapter(a)), /account-pacing/);
  f.advance(1_000); await assert.rejects(f.job.mutate(a, adapter(a)), /duplicate-action/);
});

test('Stop fences concurrent admission while every dispatched result settles accurately', async () => {
  const f = concurrentFixture(5); await f.approve();
  const leases = await Promise.all(Array.from({ length: 5 }, (_, i) => f.job.claim(i, f.review.accountId)));
  const actions = [];
  for (const lease of leases.slice(0, 4)) { actions.push(await heldMutation(f, lease)); f.advance(1_000); }
  await f.job.interrupt('stop', { stop: true });
  await assert.rejects(f.job.mutate(leases[4], adapter(leases[4])), /stop/);
  for (const action of actions) action.settle({ verified: true });
  await Promise.all(actions.map((action) => action.result));
  assert.deepEqual(f.job.snapshot().tasks.map((task) => task.messageRemovals), [1, 1, 1, 1, 0]);
  assert.equal(f.job.snapshot().status, 'stopped');
  assert.equal(f.job.snapshot().pendingMutations.length, 0);
});

test('one uncertain concurrent result revokes new work without discarding other in-flight proof', async () => {
  const f = concurrentFixture(5); await f.approve();
  const leases = await Promise.all(Array.from({ length: 5 }, (_, i) => f.job.claim(i, f.review.accountId)));
  const actions = [];
  for (const lease of leases.slice(0, 4)) { actions.push(await heldMutation(f, lease)); f.advance(1_000); }
  actions[1].settle({ verified: false }); await actions[1].result;
  await assert.rejects(f.job.mutate(leases[4], adapter(leases[4])), /removal-not-proven/);
  for (const index of [3, 0, 2]) { actions[index].settle({ verified: true }); await actions[index].result; }
  assert.deepEqual(f.job.snapshot().tasks.map((task) => task.messageRemovals), [1, 0, 1, 1, 0]);
  assert.deepEqual(f.job.snapshot().pendingMutations, [{ threadId: leases[1].threadId, kind: 'message', phase: 'uncertain' }]);
  await assert.rejects(f.approve(), /reconciliation-required/);
});

test('restart preserves every concurrent pending action as uncertain and never restores capability', async () => {
  const f = concurrentFixture(); await f.approve();
  const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  const first = await heldMutation(f, a); f.advance(1_000); const second = await heldMutation(f, b);
  const checkpoint = f.job.snapshot();
  assert.throws(() => createInboxCoordinator({ review: f.review, restored: checkpoint, now: () => start, save: async () => {} }), /concurrent-mutations-unavailable/);
  const restored = createInboxCoordinator({ review: f.review, restored: checkpoint, now: () => start, save: async () => {}, concurrencyCapability: acceptedCapability(2) });
  assert.ok(restored.snapshot().tasks.every((task) => task.status === 'uncertain'));
  assert.ok(restored.snapshot().pendingMutations.every((pending) => pending.phase === 'uncertain'));
  await assert.rejects(restored.approve(inboxReviewKey(f.review), f.review.accountId), /reconciliation-required/);
  const corrupt = structuredClone(checkpoint); corrupt.pendingMutations[1] = { ...corrupt.pendingMutations[0] };
  assert.throws(() => createInboxCoordinator({ review: f.review, restored: corrupt, now: () => start, save: async () => {}, concurrencyCapability: acceptedCapability(2) }), /checkpoint-invalid/);
  first.settle({ verified: true }); second.settle({ verified: true }); await Promise.all([first.result, second.result]);
});

test('concurrent persistence failure prevents the next dispatch and preserves already dispatched results', async () => {
  let failNext = false;
  const f = concurrentFixture(2, { save: async () => { if (failNext) { failNext = false; throw new Error('disk-full'); } } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  const first = await heldMutation(f, a); f.advance(1_000); failNext = true; let calls = 0;
  await assert.rejects(f.job.mutate(b, adapter(b, { execute: async () => { calls += 1; return { verified: true }; } })), /disk-full/);
  first.settle({ verified: true }); await first.result;
  assert.equal(calls, 0); assert.equal(f.job.snapshot().tasks[0].messageRemovals, 1);
  assert.equal(f.job.snapshot().reason, 'storage-failed');
  assert.equal(f.job.snapshot().pendingMutations[0].threadId, b.threadId);
});

test('capability expiry and restriction reports fence concurrent work without losing dispatched proof', async () => {
  const f = concurrentFixture(); await f.approve();
  const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  const first = await heldMutation(f, a); f.advance(60_000);
  await assert.rejects(f.job.mutate(b, adapter(b)), /concurrency-capability-expired/);
  first.settle({ verified: true }); await first.result;
  assert.equal(f.job.snapshot().tasks[0].messageRemovals, 1);
  const g = concurrentFixture(); await g.approve(); const c = await g.job.claim(0, g.review.accountId), d = await g.job.claim(1, g.review.accountId);
  await g.job.mutate(c, adapter(c, { execute: async () => ({ verified: true, restriction: 'rate-limit' }) }));
  g.advance(1_000); await assert.rejects(g.job.mutate(d, adapter(d)), /rate-limit/);
  assert.equal(g.job.snapshot().tasks[0].messageRemovals, 1);
});

test('concurrent capacity includes inspections and Stop cancels an undispatched inspection', async () => {
  const f = fixture({ workerCount: 4, mutationConcurrency: 2 }, { concurrencyCapability: acceptedCapability(2) });
  await f.approve(); const leases = await Promise.all([0, 1, 2].map((index) => f.job.claim(index, f.review.accountId)));
  const first = await heldMutation(f, leases[0]); f.advance(1_000);
  let entered, inspected = 0;
  const ready = new Promise((resolve) => { entered = resolve; });
  const second = f.job.mutate(leases[1], adapter(leases[1], { inspect: () => { entered(); return new Promise(() => {}); } }));
  await ready;
  await assert.rejects(f.job.mutate(leases[2], adapter(leases[2], { inspect: async () => { inspected += 1; } })), /mutation-capacity/);
  const rejected = assert.rejects(second, /inspection-cancelled/);
  await f.job.interrupt('stop', { stop: true }); await rejected;
  first.settle({ verified: true }); await first.result;
  assert.equal(inspected, 0); assert.equal(f.job.snapshot().tasks[1].messageRemovals, 0);
  assert.equal(f.job.snapshot().pendingMutations.length, 0);
});

test('concurrent state saves never overlap even when acknowledgments arrive together', async () => {
  let saving = 0, peak = 0;
  const f = concurrentFixture(5, { save: async () => {
    saving += 1; peak = Math.max(peak, saving);
    await new Promise((resolve) => setTimeout(resolve, 1)); saving -= 1;
  } });
  await f.approve(); const leases = await Promise.all(Array.from({ length: 5 }, (_, i) => f.job.claim(i, f.review.accountId)));
  const actions = [];
  for (const lease of leases) { actions.push(await heldMutation(f, lease)); f.advance(1_000); }
  actions.forEach((action) => action.settle({ verified: true })); await Promise.all(actions.map((action) => action.result));
  assert.equal(peak, 1); assert.equal(saving, 0);
  assert.equal(f.job.snapshot().tasks.reduce((sum, task) => sum + task.messageRemovals, 0), 5);
});

test('Stop between durable intent and dispatch makes no click and leaves no false pending result', async () => {
  let dispatchSaved, release, held = false;
  const ready = new Promise((resolve) => { dispatchSaved = resolve; });
  const f = concurrentFixture(2, { save: async (state) => {
    if (!held && state.pendingMutations?.some((item) => item.phase === 'dispatched')) {
      held = true;
      dispatchSaved(); await new Promise((resolve) => { release = resolve; });
    }
  } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId); let calls = 0;
  const mutation = f.job.mutate(a, adapter(a, { execute: async () => { calls += 1; return { verified: true }; } }));
  const rejected = assert.rejects(mutation, /stop/);
  await ready; const stopping = f.job.interrupt('stop', { stop: true }); release();
  await rejected; await stopping;
  assert.equal(calls, 0); assert.equal(f.job.snapshot().pendingMutations.length, 0);
  assert.equal(f.job.snapshot().tasks[0].messageRemovals, 0);
});

test('concurrent checkpoint failure after success leaves every unresolved durable action recoverable', async () => {
  const durable = []; let failSettlement = false;
  const f = concurrentFixture(2, { save: async (state) => {
    if (failSettlement) throw new Error('disk-full');
    durable.push(structuredClone(state));
  } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  const first = await heldMutation(f, a); f.advance(1_000); const second = await heldMutation(f, b);
  failSettlement = true;
  const rejectedFirst = assert.rejects(first.result, /disk-full/), rejectedSecond = assert.rejects(second.result, /disk-full/);
  first.settle({ verified: true }); second.settle({ verified: true });
  await Promise.all([rejectedFirst, rejectedSecond]);
  assert.deepEqual(f.job.snapshot().tasks.map((task) => task.messageRemovals), [1, 1]);
  const restored = createInboxCoordinator({ review: f.review, restored: durable.at(-1), now: () => start, save: async () => {}, concurrencyCapability: acceptedCapability(2) });
  assert.equal(restored.snapshot().pendingMutations.length, 2);
  assert.ok(restored.snapshot().tasks.every((task) => task.status === 'uncertain' && task.messageRemovals === 0));
});

test('dispatch spacing starts after a delayed dispatch-marker save, at actual execute invocation', async () => {
  let delayed = false;
  const timestamps = [];
  const f = concurrentFixture(2, { save: async (state) => {
    if (!delayed && state.pendingMutations?.some((item) => item.phase === 'dispatched')) {
      delayed = true;
      await Promise.resolve();
      f.advance(5_000);
    }
  } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const first = f.job.mutate(a, adapter(a, { execute: async () => {
    timestamps.push(f.clock());
    entered();
    return new Promise((resolve) => { release = resolve; });
  } }));
  await ready;
  assert.equal(f.job.snapshot().nextActionAt, timestamps[0] + 1_000);
  await assert.rejects(f.job.mutate(b, adapter(b)), /account-pacing/);
  f.advance(999); await assert.rejects(f.job.mutate(b, adapter(b)), /account-pacing/);
  f.advance(1);
  await f.job.mutate(b, adapter(b, { execute: async () => { timestamps.push(f.clock()); return { verified: true }; } }));
  release({ verified: true }); await first;
  assert.deepEqual(timestamps, [start + 5_000, start + 6_000]);
});

test('hung save releases the queue, settles dispatched proof, and latches all later writes including Stop', async () => {
  const durable = []; let hang = false, lateSave, entered, calls = 0;
  const ready = new Promise((resolve) => { entered = resolve; });
  const f = concurrentFixture(2, { saveTimeoutMs: 5, save: async (state) => {
    calls += 1;
    if (hang) {
      entered();
      await new Promise((resolve) => { lateSave = resolve; });
    }
    durable.push(structuredClone(state));
  } });
  await f.approve(); const a = await f.job.claim(0, f.review.accountId), b = await f.job.claim(1, f.review.accountId);
  const first = await heldMutation(f, a); f.advance(1_000);
  const firstRejected = assert.rejects(first.result, /storage-timeout/);
  hang = true; let secondClicks = 0;
  const second = f.job.mutate(b, adapter(b, { execute: async () => { secondClicks += 1; return { verified: true }; } }));
  const secondRejected = assert.rejects(second, /storage-timeout/);
  await ready;
  const stopped = assert.rejects(f.job.interrupt('stop', { stop: true }), /storage-timeout/);
  first.settle({ verified: true });
  await Promise.all([firstRejected, secondRejected, stopped]);
  assert.equal(secondClicks, 0);
  assert.equal(f.job.snapshot().status, 'stopped');
  assert.equal(f.job.snapshot().tasks[0].messageRemovals, 1);
  assert.ok(durable.at(-1).pendingMutations.some((item) => item.threadId === a.threadId && item.phase === 'dispatched'));
  const writeCount = calls;
  await assert.rejects(f.approve(), /storage-timeout/);
  await assert.rejects(f.job.interrupt('stop', { stop: true }), /storage-timeout/);
  assert.equal(calls, writeCount);
  hang = false; lateSave(); await Promise.resolve(); await Promise.resolve();
  await assert.rejects(f.approve(), /storage-timeout/);
  assert.equal(calls, writeCount);
  assert.ok(durable.at(-1).pendingMutations.some((item) => item.threadId === a.threadId && item.phase === 'dispatched'));
});

test('save deadline validates bounds and a serial hung save cannot restore approval', async () => {
  for (const saveTimeoutMs of [0, -1, Infinity, 120_001]) assert.throws(() => fixture({}, { saveTimeoutMs }), /save-timeout-invalid/);
  let calls = 0;
  const f = fixture({}, { saveTimeoutMs: 5, save: () => { calls += 1; return new Promise(() => {}); } });
  await assert.rejects(f.approve(), /storage-timeout/);
  await assert.rejects(f.approve(), /storage-timeout/);
  await assert.rejects(f.job.claim(0, f.review.accountId), /storage-timeout/);
  assert.equal(calls, 1);
  assert.equal(f.job.snapshot().status, 'paused');
});

test('late save acknowledgment checks elapsed time even before a throttled timeout callback runs', async () => {
  let calls = 0;
  const f = fixture({}, { saveTimeoutMs: 100, save: async () => { calls += 1; f.advance(101); } });
  await assert.rejects(f.approve(), /storage-timeout/);
  await assert.rejects(f.approve(), /storage-timeout/);
  assert.equal(calls, 1);
});
