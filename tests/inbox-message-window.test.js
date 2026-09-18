import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxReview, createInboxCoordinator, inboxReviewKey } from '../extension/inbox-coordinator.js';

const now = 1_800_000_000_000;
const input = { accountId: 'test-account', threadIds: ['100', '200'], expiresAt: now + 60_000 };

test('old inbox reviews retain their exact historical window and canonical shape', () => {
  const review = createInboxReview(input, now);
  assert.equal(review.version, 1);
  assert.equal(review.arrivalPolicy, 'skip-after-review-or-pause');
  assert.equal('messageWindow' in review, false);
  assert.deepEqual(createInboxReview(review, now), review);
});

test('during-run messages require an explicit versioned review, never an inferred fallback', () => {
  const review = createInboxReview({ ...input, messageWindow: 'during-run' }, now);
  assert.equal(review.version, 2);
  assert.equal(review.arrivalPolicy, 'include-sent-while-running');
  assert.equal(review.messageWindow, 'during-run');
  assert.deepEqual(createInboxReview(review, now), review);
  assert.notEqual(inboxReviewKey(review), inboxReviewKey(createInboxReview(input, now)));
  for (const invalid of [
    { version: 2 }, { version: 3 }, { messageWindow: 'unknown' },
    { version: 1, messageWindow: 'during-run' },
    { messageWindow: 'during-run', arrivalPolicy: 'skip-after-review-or-pause' },
  ]) assert.throws(() => createInboxReview({ ...input, ...invalid }, now));
});

test('new window survives metadata checkpoints without restoring action authority', async () => {
  const review = createInboxReview({ ...input, messageWindow: 'during-run' }, now);
  let stored;
  const job = createInboxCoordinator({ review, now: () => now, save: async value => { stored = structuredClone(value); } });
  await job.approve(inboxReviewKey(review), review.accountId);
  assert.equal(stored.review.messageWindow, 'during-run');
  const restored = createInboxCoordinator({ review, restored: stored, now: () => now, save: async () => {} });
  await assert.rejects(restored.claim(0, review.accountId));
});

test('obsolete Fast pacing cannot be used in either inbox review version', () => {
  for (const messageWindow of [undefined, 'during-run']) {
    assert.throws(() => createInboxReview({ ...input, messageWindow, speed: 'fast' }, now), /speed-invalid/);
  }
});

test('settled interrupted workers become partial without reviving their lease or clearing uncertainty', async () => {
  const review = createInboxReview({ ...input, messageWindow: 'during-run' }, now);
  const job = createInboxCoordinator({ review, now: () => now, save: async () => {} });
  await job.approve(inboxReviewKey(review), review.accountId);
  const lease = await job.claim(0, review.accountId);
  await assert.rejects(job.settleInterrupted(lease), /settlement-invalid/);
  await job.interrupt('stopped', { stop: true });
  await assert.rejects(job.settleInterrupted({ ...lease }), /settlement-invalid/);
  const result = await job.settleInterrupted(lease);
  assert.equal(result.tasks[0].status, 'partial');
  assert.equal(result.tasks[0].messageRemovals, 0);
  assert.equal(result.status, 'stopped');
  await assert.rejects(job.claim(0, review.accountId));
  await assert.rejects(job.settleInterrupted(lease), /settlement-invalid/);
});
