import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxCoordinator, createInboxReview, inboxReviewKey } from '../extension/inbox-coordinator.js';

const start = 1_000_000;
function fixture(patch = {}, options = {}) {
  let time = start;
  const writes = [];
  const review = createInboxReview({ accountId: 'account_fixture', threadIds: ['thread_a', 'thread_b', 'thread_c', 'thread_d'], ...patch }, time);
  const job = createInboxCoordinator({ review, now: () => time, save: async (state) => { writes.push(state); }, ...options });
  return { review, job, writes, advance: (ms) => { time += ms; }, approve: () => job.approve(inboxReviewKey(review), review.accountId) };
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
  for (const patch of [{ threadIds: [] }, { threadIds: ['../account'] }, { workerCount: 3 }, { accountId: '' }, { scope: 'newest', limit: Infinity }, { speed: 'unlimited' }, { expiresAt: start }]) {
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
