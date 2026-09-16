import { createInboxReview, inboxReviewKey } from './inbox-coordinator.js';

const TASK_STATUSES = new Set(['pending', 'running', 'completed', 'partial', 'skipped', 'failed', 'uncertain']);
const JOB_STATUSES = new Set(['review', 'running', 'paused', 'stopped', 'completed', 'partial']);
const REASONS = new Set([
  'paused', 'stopped', 'completed', 'stable-exhaustion', 'limit-reached', 'expired',
  'thread-changed', 'wrong-thread', 'account-changed', 'viewer-changed', 'user-stop',
  'worker-restart', 'worker-retired', 'worker-response-timeout', 'worker-closed',
  'interrupted', 'interrupted-mutation', 'review-required-after-restart',
  'removal-not-proven', 'inspection-failed', 'storage-timeout', 'storage-failed',
  'challenge', 'rate-limited', 'action-blocked', 'session-expired',
  'context-changed', 'context-unavailable', 'document-frozen', 'page-hidden',
  'pagehide', 'freeze', 'reconciliation-required', 'other',
]);
const record = (value) => value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = (value) => structuredClone(value);
const fail = (reason) => { throw new Error(reason); };
const reason = (value) => value == null ? null : REASONS.has(value) ? value : 'other';
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function sanitize(snapshot) {
  if (!record(snapshot) || snapshot.version !== 1 || !record(snapshot.review)
    || !Number.isSafeInteger(snapshot.review.reviewedAt) || snapshot.review.reviewedAt <= 0
    || !JOB_STATUSES.has(snapshot.status)) fail('checkpoint-invalid');
  const review = createInboxReview(snapshot.review, snapshot.review.reviewedAt);
  if (!Array.isArray(snapshot.tasks) || snapshot.tasks.length !== review.threadIds.length) fail('checkpoint-invalid');
  const tasks = snapshot.tasks.map((task, index) => {
    const workerIndex = review.assignmentMode === 'batches' ? index % review.workerCount
      : Math.min(review.workerCount - 1, Math.floor(index / Math.ceil(review.threadIds.length / review.workerCount)));
    const batchIndex = review.assignmentMode === 'batches' ? Math.floor(index / review.workerCount) : undefined;
    if (!record(task) || task.threadId !== review.threadIds[index] || task.workerIndex !== workerIndex
      || task.batchIndex !== batchIndex || !TASK_STATUSES.has(task.status)
      || !count(task.messageRemovals) || !count(task.reactionRemovals)) fail('checkpoint-invalid');
    return {
      threadId: task.threadId, workerIndex, ...(batchIndex !== undefined ? { batchIndex } : {}),
      status: task.status, messageRemovals: task.messageRemovals,
      reactionRemovals: task.reactionRemovals, reason: reason(task.reason),
    };
  });
  const seen = new Set();
  const pending = (value) => {
    if (!record(value) || !review.threadIds.includes(value.threadId) || seen.has(value.threadId)
      || !['message', 'reaction'].includes(value.kind)
      || !['prepared', 'dispatched', 'uncertain'].includes(value.phase)) fail('checkpoint-invalid');
    seen.add(value.threadId);
    return { threadId: value.threadId, kind: value.kind, phase: value.phase };
  };
  const pendingMutation = snapshot.pendingMutation == null ? null : pending(snapshot.pendingMutation);
  const concurrency = review.mutationConcurrency ?? 1;
  let pendingMutations;
  if (snapshot.pendingMutations !== undefined) {
    if (concurrency === 1 || pendingMutation || !Array.isArray(snapshot.pendingMutations)
      || snapshot.pendingMutations.length > concurrency) fail('checkpoint-invalid');
    pendingMutations = snapshot.pendingMutations.map(pending);
  }
  if (!Number.isFinite(snapshot.nextActionAt) || snapshot.nextActionAt < 0) fail('checkpoint-invalid');
  return {
    version: 1, review: clone(review), status: snapshot.status, reason: reason(snapshot.reason), tasks,
    pendingMutation, nextActionAt: snapshot.nextActionAt,
    ...(pendingMutations !== undefined ? { pendingMutations } : {}),
  };
}

function parseRecord(value) {
  if (value == null) return { version: 1, jobs: [] };
  // Earlier candidates stored one plain coordinator snapshot at this same key.
  if (record(value) && value.version === 1 && value.jobs === undefined
    && record(value.review) && Array.isArray(value.tasks)) {
    return { version: 1, jobs: [sanitize(value)] };
  }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.jobs) || value.jobs.length > 20) fail('checkpoint-history-invalid');
  const jobs = value.jobs.map(sanitize);
  const keys = jobs.map((job) => inboxReviewKey(job.review));
  if (new Set(keys).size !== keys.length) fail('checkpoint-history-invalid');
  return { version: 1, jobs };
}

function recover(snapshot) {
  const copy = clone(snapshot);
  const markers = [copy.pendingMutation, ...(copy.pendingMutations || [])].filter(Boolean);
  for (const task of copy.tasks) {
    if (task.status === 'running') { task.status = 'partial'; task.reason = 'worker-restart'; }
    if (markers.some((marker) => marker.threadId === task.threadId)) {
      task.status = 'uncertain'; task.reason = 'interrupted-mutation';
    }
  }
  for (const marker of markers) marker.phase = 'uncertain';
  if (markers.length || ['review', 'running', 'paused'].includes(copy.status)) {
    copy.status = 'paused'; copy.reason = 'review-required-after-restart';
  }
  return copy;
}

/** One trusted coordinator owns a store instance and its single backing key. */
export function createInboxCheckpointStore({ read, write, inspectAccount, timeoutMs = 10_000, now = Date.now } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function' || typeof inspectAccount !== 'function'
    || typeof now !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail('checkpoint-storage-adapter-invalid');
  let tail = Promise.resolve();
  let writeFailure = null;
  const serial = (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  function account() {
    const context = inspectAccount();
    if (!record(context) || context.accountVerified !== true || context.restriction
      || typeof context.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(context.accountId)) fail('verified-account-required');
    return context.accountId;
  }
  const sameAccount = (expected) => { if (account() !== expected) fail('checkpoint-account-changed'); };
  async function bounded(operation, kind) {
    let timer;
    const started = now();
    if (!Number.isFinite(started)) fail('checkpoint-clock-invalid');
    try {
      const value = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`checkpoint-${kind}-timeout`)), timeoutMs); }),
      ]);
      const ended = now();
      if (!Number.isFinite(ended) || ended < started || ended - started >= timeoutMs) fail(`checkpoint-${kind}-timeout`);
      return value;
    } finally { clearTimeout(timer); }
  }
  async function readFor(expected) {
    const stored = parseRecord(await bounded(read, 'read'));
    sameAccount(expected);
    return stored;
  }
  return Object.freeze({
    load: () => serial(async () => {
      const expected = account();
      const stored = await readFor(expected);
      const latest = stored.jobs.find((job) => job.review.accountId === expected);
      return latest ? recover(latest) : null;
    }),
    history: () => serial(async () => {
      const expected = account();
      const stored = await readFor(expected);
      return stored.jobs.filter((job) => job.review.accountId === expected).map(recover);
    }),
    save: (snapshot) => {
      // Copy immediately: a queued persistence call must not observe later mutations.
      let clean;
      let expected;
      try {
        expected = account(); clean = sanitize(snapshot);
        if (clean.review.accountId !== expected) fail('checkpoint-account-mismatch');
      } catch (error) { return Promise.reject(error); }
      return serial(async () => {
        if (writeFailure) throw writeFailure;
        sameAccount(expected);
        const stored = await readFor(expected);
        const key = inboxReviewKey(clean.review);
        const previous = stored.jobs.find((job) => inboxReviewKey(job.review) === key);
        if (previous && clean.tasks.some((task, index) => (
          task.messageRemovals < previous.tasks[index].messageRemovals
          || task.reactionRemovals < previous.tasks[index].reactionRemovals
        ))) fail('checkpoint-count-regression');
        const next = { version: 1, jobs: [clean, ...stored.jobs.filter((job) => inboxReviewKey(job.review) !== key)].slice(0, 20) };
        sameAccount(expected);
        try { await bounded(() => write(clone(next)), 'write'); }
        catch (error) {
          // A timed-out or rejected write may still settle. Fence all newer writes.
          writeFailure = new Error(error?.message === 'checkpoint-write-timeout' ? 'checkpoint-write-timeout' : 'checkpoint-write-failed');
          throw writeFailure;
        }
        sameAccount(expected);
        return clone(clean);
      });
    },
  });
}
