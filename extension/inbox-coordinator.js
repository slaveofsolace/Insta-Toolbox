// Browser-neutral job state. Runtime adapters must supply trusted identity and
// exact-target checks; this module does not open tabs or click Instagram controls.
const MAX_THREADS = 1_000;
const MAX_REVIEW_AGE_MS = 20 * 60 * 1_000;
const TERMINAL = new Set(['completed', 'partial', 'skipped', 'failed', 'uncertain']);
const clone = (value) => structuredClone(value);
const fail = (reason) => { throw new Error(reason); };
const identity = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const record = (value) => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function createInboxReview(input, now = Date.now()) {
  if (!record(input) || !Number.isFinite(now) || (input.discovery && !record(input.discovery))) fail('review-invalid');
  if (!identity(input?.accountId)) fail('account-identity-required');
  if (!Array.isArray(input.threadIds) || !input.threadIds.length
    || input.threadIds.length > MAX_THREADS || !input.threadIds.every(identity)) fail('thread-inventory-invalid');
  const threadIds = [...new Set(input.threadIds)];
  const scope = input.scope || 'all';
  if (!['all', 'newest', 'oldest'].includes(scope)) fail('message-scope-invalid');
  const limit = scope === 'all' ? null : input.limit;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5_000)) fail('message-limit-invalid');
  const speed = input.speed || 'standard';
  if (!['standard', 'fast'].includes(speed)) fail('speed-invalid');
  const workerCount = input.workerCount ?? 1;
  if (![1, 2].includes(workerCount)) fail('worker-count-invalid');
  const expiresAt = input.expiresAt ?? now + MAX_REVIEW_AGE_MS;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_REVIEW_AGE_MS) fail('review-expired');
  const sections = [...new Set(input.discovery?.sections || [])];
  if (!sections.every((entry) => ['primary', 'general', 'requests'].includes(entry))) fail('inbox-section-invalid');
  return Object.freeze({
    version: 1, accountId: input.accountId, threadIds: Object.freeze(threadIds),
    scope, limit, speed, workerCount, removeOwnReactions: input.removeOwnReactions === true,
    reviewedAt: now, expiresAt,
    arrivalPolicy: 'skip-after-review-or-pause',
    discovery: Object.freeze({ sections: Object.freeze(sections), complete: input.discovery?.complete === true }),
  });
}

export function inboxReviewKey(review) {
  // Exact canonical content, not an authentication token or a lossy digest.
  return JSON.stringify(review);
}

export function createInboxCoordinator({ review, save, now = Date.now, restored = null, stageTimeoutMs = 30_000 }) {
  if (typeof save !== 'function') fail('durable-storage-required');
  if (!Number.isFinite(stageTimeoutMs) || stageTimeoutMs < 1 || stageTimeoutMs > 120_000) fail('stage-timeout-invalid');
  const frozen = createInboxReview(review, review.reviewedAt ?? now());
  const key = inboxReviewKey(frozen);
  let state = {
    version: 1, review: clone(frozen), status: 'review', reason: null,
    tasks: frozen.threadIds.map((threadId, index) => ({
      threadId, workerIndex: Math.min(frozen.workerCount - 1, Math.floor(index / Math.ceil(frozen.threadIds.length / frozen.workerCount))),
      status: 'pending', messageRemovals: 0, reactionRemovals: 0, reason: null,
    })),
    pendingMutation: null, nextActionAt: 0,
  };
  if (restored) {
    if (!record(restored) || restored.version !== 1 || inboxReviewKey(restored.review) !== key
      || !Array.isArray(restored.tasks) || restored.tasks.length !== frozen.threadIds.length
      || restored.tasks.some((task, index) => !record(task) || task.threadId !== frozen.threadIds[index]
        || task.workerIndex !== state.tasks[index].workerIndex
        || !['pending', 'running', ...TERMINAL].includes(task.status)
        || !Number.isSafeInteger(task.messageRemovals) || task.messageRemovals < 0
        || !Number.isSafeInteger(task.reactionRemovals) || task.reactionRemovals < 0)) fail('checkpoint-invalid');
    state.tasks = clone(restored.tasks);
    state.nextActionAt = Number.isFinite(restored.nextActionAt) ? restored.nextActionAt : 0;
    for (const task of state.tasks) {
      if (task.status === 'running') { task.status = 'partial'; task.reason = 'worker-restart'; }
    }
    if (restored.pendingMutation) {
      if (!record(restored.pendingMutation)
        || !['message', 'reaction'].includes(restored.pendingMutation.kind)
        || !['prepared', 'dispatched', 'uncertain'].includes(restored.pendingMutation.phase)) fail('checkpoint-invalid');
      const task = state.tasks.find((item) => item.threadId === restored.pendingMutation.threadId);
      if (!task) fail('checkpoint-invalid');
      task.status = 'uncertain'; task.reason = 'interrupted-mutation';
      state.pendingMutation = { threadId: task.threadId, kind: restored.pendingMutation.kind, phase: 'uncertain' };
    }
    state.status = 'paused'; state.reason = 'review-required-after-restart';
  }
  let tail = Promise.resolve();
  let authorized = false;
  let generation = 0;
  let abort = new AbortController();
  const leases = new Map();
  const attempts = new Set();
  const snapshot = () => clone(state);
  const serial = (fn) => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  function revoke(reason, status = 'paused') {
    authorized = false; generation += 1; abort.abort(reason);
    state.status = status; state.reason = reason;
    // Retain leases: a missing heartbeat cannot prove an old worker stopped.
  }
  async function persist() {
    try { await save(snapshot()); }
    catch (error) { revoke('storage-failed'); throw error; }
  }
  function active(accountId) {
    if (accountId !== frozen.accountId) { revoke('account-changed'); fail('account-changed'); }
    if (now() >= frozen.expiresAt) { revoke('approval-expired'); fail('approval-expired'); }
    if (!authorized || state.status !== 'running') fail(state.reason || 'approval-required');
  }
  function taskFor(lease) {
    if (!lease || leases.get(lease.threadId) !== lease || lease.generation !== generation) fail('stale-worker');
    return state.tasks.find((task) => task.threadId === lease.threadId);
  }
  function boundedStage(callback, signal, cancelOnAbort) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        if (error) reject(error); else resolve(value);
      };
      const cancelled = () => finish(new Error('inspection-cancelled'));
      const timer = setTimeout(() => finish(new Error('worker-response-timeout')), stageTimeoutMs);
      if (cancelOnAbort) {
        signal.addEventListener('abort', cancelled, { once: true });
        if (signal.aborted) { cancelled(); return; }
      }
      Promise.resolve().then(callback).then((value) => finish(null, value), (error) => finish(error));
    });
  }
  return Object.freeze({
    snapshot,
    approve: (reviewKey, accountId) => serial(async () => {
      if (reviewKey !== key || accountId !== frozen.accountId) fail('review-changed');
      if (state.pendingMutation || leases.size) fail('reconciliation-required');
      if (state.status === 'stopped' || state.status === 'completed') fail('job-finished');
      if (now() >= frozen.expiresAt) fail('approval-expired');
      authorized = true; abort = new AbortController(); state.status = 'running'; state.reason = null;
      await persist(); return snapshot();
    }),
    claim: (workerIndex, accountId) => serial(async () => {
      active(accountId);
      if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= frozen.workerCount) fail('worker-invalid');
      if ([...leases.values()].some((lease) => lease.workerIndex === workerIndex)) fail('worker-already-assigned');
      const task = state.tasks.find((item) => item.workerIndex === workerIndex && item.status === 'pending');
      if (!task) return null;
      const lease = Object.freeze({ threadId: task.threadId, workerIndex, generation });
      leases.set(task.threadId, lease); task.status = 'running'; await persist(); return lease;
    }),
    mutate: (lease, { accountId, actionId, kind, inspect, execute, delayMs }) => serial(async () => {
      active(accountId);
      const task = taskFor(lease);
      if (!identity(actionId) || !['message', 'reaction'].includes(kind)) fail('mutation-invalid');
      if (kind === 'reaction' && !frozen.removeOwnReactions) fail('reaction-not-approved');
      if (kind === 'message' && frozen.limit !== null && task.messageRemovals >= frozen.limit) fail('message-limit-reached');
      if (!Number.isFinite(delayMs) || delayMs < 0 || typeof inspect !== 'function' || typeof execute !== 'function') fail('mutation-adapter-invalid');
      if (state.pendingMutation) fail('reconciliation-required');
      if (now() < state.nextActionAt) fail('account-pacing');
      const actionKey = `${lease.threadId}:${kind}:${actionId}`;
      if (attempts.has(actionKey)) fail('duplicate-action');
      const signal = abort.signal;
      let evidence;
      try {
        evidence = await boundedStage(() => inspect({ threadId: lease.threadId, signal, reviewedAt: frozen.reviewedAt }), signal, true);
      } catch (error) {
        if (state.status === 'running') revoke(error.message === 'worker-response-timeout' ? 'worker-response-timeout' : 'inspection-failed');
        throw error;
      }
      active(accountId); taskFor(lease);
      if (evidence?.accountId !== frozen.accountId || evidence?.threadId !== lease.threadId
        || evidence?.ownershipVerified !== true || evidence?.withinReviewedBoundary !== true
        || evidence?.exactTarget !== true) fail('target-not-proven');
      state.pendingMutation = { threadId: lease.threadId, kind, phase: 'prepared' };
      await persist();
      active(accountId); taskFor(lease);
      attempts.add(actionKey);
      state.pendingMutation.phase = 'dispatched';
      // Persist the dispatch marker before the adapter can affect Instagram.
      await persist();
      active(accountId); taskFor(lease);
      let result;
      try { result = await boundedStage(() => execute({ threadId: lease.threadId, signal, evidence }), signal, false); }
      catch { result = { verified: false }; }
      if (result?.verified === true) {
        task[kind === 'message' ? 'messageRemovals' : 'reactionRemovals'] += 1;
        state.pendingMutation = null;
        state.nextActionAt = now() + delayMs;
      } else {
        task.status = 'uncertain'; task.reason = 'removal-not-proven';
        state.pendingMutation.phase = 'uncertain';
        revoke('removal-not-proven', state.status === 'stopped' ? 'stopped' : 'paused');
      }
      await persist();
      return { verified: result?.verified === true, state: snapshot() };
    }),
    finish: (lease, status, reason = null) => serial(async () => {
      const task = taskFor(lease);
      if (!TERMINAL.has(status) || status === 'uncertain' || state.pendingMutation) fail('completion-invalid');
      task.status = status; task.reason = reason; leases.delete(task.threadId);
      if (state.tasks.every((item) => TERMINAL.has(item.status))) {
        authorized = false;
        state.status = state.tasks.every((item) => item.status === 'completed') ? 'completed' : 'partial';
      }
      await persist(); return snapshot();
    }),
    interrupt: (reason = 'paused', { stop = false } = {}) => {
      revoke(reason, stop ? 'stopped' : 'paused');
      return serial(async () => { await persist(); return snapshot(); });
    },
    retireWorker: (threadId, { terminated, reconciled = false } = {}) => serial(async () => {
      if (terminated !== true) fail('worker-termination-required');
      if (state.pendingMutation?.threadId === threadId && reconciled !== true) fail('reconciliation-required');
      const task = state.tasks.find((item) => item.threadId === threadId);
      if (!task) fail('thread-not-reviewed');
      leases.delete(threadId);
      if (state.pendingMutation?.threadId === threadId) state.pendingMutation = null;
      if (['running', 'partial', 'uncertain'].includes(task.status)) {
        task.status = 'skipped'; task.reason = 'worker-retired';
      }
      await persist(); return snapshot();
    }),
  });
}
