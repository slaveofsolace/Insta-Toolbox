// Browser-neutral job state. Runtime adapters must supply trusted identity and
// exact-target checks; this module does not open tabs or click Instagram controls.
const MAX_THREADS = 1_000;
const MAX_REVIEW_AGE_MS = 20 * 60 * 1_000;
export const INBOX_COORDINATOR_CAPABILITIES = Object.freeze({
  maxPreparedWorkers: 5,
  defaultConcurrentMutations: 1,
  maxConcurrentMutations: 5,
  assignmentModes: Object.freeze(['contiguous', 'batches']),
});
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
  if (!Number.isInteger(workerCount) || workerCount < 1
    || workerCount > INBOX_COORDINATOR_CAPABILITIES.maxPreparedWorkers) fail('worker-count-invalid');
  const assignmentMode = input.assignmentMode ?? 'contiguous';
  if (!INBOX_COORDINATOR_CAPABILITIES.assignmentModes.includes(assignmentMode)) fail('assignment-mode-invalid');
  const mutationConcurrency = input.mutationConcurrency ?? 1;
  if (!Number.isInteger(mutationConcurrency) || mutationConcurrency < 1) fail('mutation-concurrency-invalid');
  if (mutationConcurrency > INBOX_COORDINATOR_CAPABILITIES.maxConcurrentMutations
    || mutationConcurrency > workerCount) fail('mutation-concurrency-invalid');
  // Preserve canonical keys for existing reviews. New scheduling choices are
  // explicit review content, never an interpretation added to an older approval.
  const scheduling = {};
  if (input.assignmentMode !== undefined) scheduling.assignmentMode = assignmentMode;
  if (input.mutationConcurrency !== undefined) scheduling.mutationConcurrency = mutationConcurrency;
  const expiresAt = input.expiresAt ?? now + MAX_REVIEW_AGE_MS;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_REVIEW_AGE_MS) fail('review-expired');
  const sections = [...new Set(input.discovery?.sections || [])];
  if (!sections.every((entry) => ['primary', 'general', 'requests'].includes(entry))) fail('inbox-section-invalid');
  return Object.freeze({
    version: 1, accountId: input.accountId, threadIds: Object.freeze(threadIds),
    scope, limit, speed, workerCount, removeOwnReactions: input.removeOwnReactions === true,
    ...scheduling,
    reviewedAt: now, expiresAt,
    arrivalPolicy: 'skip-after-review-or-pause',
    discovery: Object.freeze({ sections: Object.freeze(sections), complete: input.discovery?.complete === true }),
  });
}

export function inboxReviewKey(review) {
  // Exact canonical content, not an authentication token or a lossy digest.
  return JSON.stringify(review);
}

export function createInboxCoordinator({ review, save, now = Date.now, restored = null, stageTimeoutMs = 30_000, saveTimeoutMs = 10_000, concurrencyCapability = null }) {
  if (typeof save !== 'function') fail('durable-storage-required');
  if (!Number.isFinite(stageTimeoutMs) || stageTimeoutMs < 1 || stageTimeoutMs > 120_000) fail('stage-timeout-invalid');
  if (!Number.isFinite(saveTimeoutMs) || saveTimeoutMs < 1 || saveTimeoutMs > 120_000) fail('save-timeout-invalid');
  const frozen = createInboxReview(review, review.reviewedAt ?? now());
  const key = inboxReviewKey(frozen);
  const concurrency = frozen.mutationConcurrency ?? 1;
  // Only the trusted runtime may supply this admission policy. Never read it
  // from page messages, a checkpoint, or reviewed client settings.
  if (concurrencyCapability !== null && !record(concurrencyCapability)) fail('concurrent-mutations-unavailable');
  const capability = concurrencyCapability ? clone(concurrencyCapability) : null;
  if (concurrency > 1 && (!record(capability) || capability.version !== 1
    || capability.accountId !== frozen.accountId
    || !Number.isInteger(capability.maxConcurrentMutations) || capability.maxConcurrentMutations < concurrency
    || capability.maxConcurrentMutations > INBOX_COORDINATOR_CAPABILITIES.maxConcurrentMutations
    || !Number.isFinite(capability.expiresAt) || capability.expiresAt <= now())) fail('concurrent-mutations-unavailable');
  let state = {
    version: 1, review: clone(frozen), status: 'review', reason: null,
    tasks: frozen.threadIds.map((threadId, index) => ({
      threadId, workerIndex: frozen.assignmentMode === 'batches' ? index % frozen.workerCount
        : Math.min(frozen.workerCount - 1, Math.floor(index / Math.ceil(frozen.threadIds.length / frozen.workerCount))),
      ...(frozen.assignmentMode === 'batches' ? { batchIndex: Math.floor(index / frozen.workerCount) } : {}),
      status: 'pending', messageRemovals: 0, reactionRemovals: 0, reason: null,
    })),
    pendingMutation: null, nextActionAt: 0,
    ...(concurrency > 1 ? { pendingMutations: [] } : {}),
  };
  if (restored) {
    if (!record(restored) || restored.version !== 1 || inboxReviewKey(restored.review) !== key
      || !Array.isArray(restored.tasks) || restored.tasks.length !== frozen.threadIds.length
      || restored.tasks.some((task, index) => !record(task) || task.threadId !== frozen.threadIds[index]
        || task.workerIndex !== state.tasks[index].workerIndex
        || task.batchIndex !== state.tasks[index].batchIndex
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
    if (restored.pendingMutations !== undefined) {
      if (concurrency === 1 || !Array.isArray(restored.pendingMutations)
        || restored.pendingMutations.length > concurrency || restored.pendingMutation) fail('checkpoint-invalid');
      const seen = new Set();
      state.pendingMutations = restored.pendingMutations.map((pending) => {
        if (!record(pending) || !['message', 'reaction'].includes(pending.kind)
          || !['prepared', 'dispatched', 'uncertain'].includes(pending.phase)
          || seen.has(pending.threadId)) fail('checkpoint-invalid');
        const task = state.tasks.find((item) => item.threadId === pending.threadId);
        if (!task) fail('checkpoint-invalid');
        seen.add(task.threadId); task.status = 'uncertain'; task.reason = 'interrupted-mutation';
        return { threadId: task.threadId, kind: pending.kind, phase: 'uncertain' };
      });
    }
    state.status = 'paused'; state.reason = 'review-required-after-restart';
  }
  let tail = Promise.resolve();
  let authorized = false;
  let generation = 0;
  let abort = new AbortController();
  let storageTimeout = null;
  const leases = new Map();
  const attempts = new Set();
  const inFlight = new Map();
  const pendingFor = (threadId) => state.pendingMutation?.threadId === threadId
    || state.pendingMutations?.some((item) => item.threadId === threadId);
  const hasPending = () => !!state.pendingMutation || !!state.pendingMutations?.length;
  const snapshot = () => clone(state);
  function currentBatch() {
    if (frozen.assignmentMode !== 'batches') return null;
    const unfinished = state.tasks.find((task) => !TERMINAL.has(task.status)
      || leases.has(task.threadId) || pendingFor(task.threadId));
    return unfinished?.batchIndex ?? null;
  }
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
    // A timed-out adapter may still write later. Never start a newer write in
    // this instance after that point, even if the old promise eventually settles.
    if (storageTimeout) throw storageTimeout;
    try {
      const checkpoint = snapshot();
      await new Promise((resolve, reject) => {
        let settled = false;
        const deadline = now() + saveTimeoutMs;
        const finish = (error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        const expired = () => {
          storageTimeout = new Error('storage-timeout');
          finish(storageTimeout);
        };
        const timer = setTimeout(expired, saveTimeoutMs);
        Promise.resolve().then(() => save(checkpoint)).then(() => {
          if (settled) return;
          if (now() >= deadline) expired(); else finish();
        }, (error) => finish(error instanceof Error ? error : new Error('storage-failed')));
      });
    } catch (error) {
      revoke(storageTimeout ? 'storage-timeout' : 'storage-failed', state.status === 'stopped' ? 'stopped' : 'paused');
      throw error;
    }
  }
  function active(accountId) {
    if (storageTimeout) fail('storage-timeout');
    if (accountId !== frozen.accountId) { revoke('account-changed'); fail('account-changed'); }
    if (now() >= frozen.expiresAt) { revoke('approval-expired'); fail('approval-expired'); }
    if (concurrency > 1 && now() >= capability.expiresAt) { revoke('concurrency-capability-expired'); fail('concurrency-capability-expired'); }
    if (!authorized || state.status !== 'running') fail(state.reason || 'approval-required');
  }
  function taskFor(lease) {
    if (!lease || leases.get(lease.threadId) !== lease || lease.generation !== generation) fail('stale-worker');
    return state.tasks.find((task) => task.threadId === lease.threadId);
  }
  function boundedStage(callback, signal, cancelOnAbort, startImmediately = false) {
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
      if (startImmediately) {
        try { Promise.resolve(callback()).then((value) => finish(null, value), (error) => finish(error)); }
        catch (error) { finish(error); }
      } else Promise.resolve().then(callback).then((value) => finish(null, value), (error) => finish(error));
    });
  }
  async function concurrentMutation(lease, { accountId, actionId, kind, inspect, execute, delayMs }) {
    const operation = await serial(async () => {
      active(accountId);
      const task = taskFor(lease);
      if (!identity(actionId) || !['message', 'reaction'].includes(kind)) fail('mutation-invalid');
      if (kind === 'reaction' && !frozen.removeOwnReactions) fail('reaction-not-approved');
      if (kind === 'message' && frozen.limit !== null && task.messageRemovals >= frozen.limit) fail('message-limit-reached');
      if (!Number.isFinite(delayMs) || delayMs < 0 || typeof inspect !== 'function' || typeof execute !== 'function') fail('mutation-adapter-invalid');
      if (state.pendingMutation || state.pendingMutations.some((item) => item.phase === 'uncertain')) fail('reconciliation-required');
      if (inFlight.has(lease.threadId)) fail('thread-mutation-in-flight');
      if (inFlight.size >= concurrency) fail('mutation-capacity');
      if (now() < state.nextActionAt) fail('account-pacing');
      const actionKey = `${lease.threadId}:${kind}:${actionId}`;
      if (attempts.has(actionKey)) fail('duplicate-action');
      const item = { task, actionKey, signal: abort.signal, dispatched: false, marker: null };
      inFlight.set(lease.threadId, item);
      return item;
    });
    try {
      let evidence;
      try {
        evidence = await boundedStage(() => inspect({ threadId: lease.threadId, signal: operation.signal, reviewedAt: frozen.reviewedAt }), operation.signal, true);
      } catch (error) {
        if (state.status === 'running') revoke(error.message === 'worker-response-timeout' ? 'worker-response-timeout' : 'inspection-failed');
        throw error;
      }
      let execution;
      await serial(async () => {
        active(accountId); taskFor(lease);
        if (['challenge', 'action-block', 'rate-limit', 'session-expired'].includes(evidence?.restriction)) {
          revoke(evidence.restriction); fail(evidence.restriction);
        }
        if (evidence?.accountId !== frozen.accountId || evidence?.threadId !== lease.threadId
          || evidence?.ownershipVerified !== true || evidence?.withinReviewedBoundary !== true
          || evidence?.exactTarget !== true) fail('target-not-proven');
        if (now() < state.nextActionAt) fail('account-pacing');
        operation.marker = { threadId: lease.threadId, kind, phase: 'prepared' };
        state.pendingMutations.push(operation.marker);
        await persist();
        active(accountId); taskFor(lease);
        attempts.add(operation.actionKey);
        operation.marker.phase = 'dispatched';
        await persist();
        active(accountId); taskFor(lease);
        if (now() < state.nextActionAt) fail('account-pacing');
        // Anchor spacing to actual adapter invocation, after every awaited save.
        // Start synchronously inside this serial admission, but never hold the
        // state queue while its execution/verification promise is outstanding.
        execution = boundedStage(() => {
          active(accountId); taskFor(lease);
          state.nextActionAt = now() + delayMs;
          operation.dispatched = true;
          return execute({ threadId: lease.threadId, signal: operation.signal, evidence });
        }, operation.signal, false, true);
      });
      let result;
      try {
        result = await execution;
      } catch (error) {
        if (!operation.dispatched) throw error;
        result = { verified: false };
      }
      return await serial(async () => {
        // Settlement is allowed after revocation. Each exact dispatched action
        // owns its own marker and may report a verified outcome only once.
        if (result?.verified === true) {
          operation.task[kind === 'message' ? 'messageRemovals' : 'reactionRemovals'] += 1;
          state.pendingMutations = state.pendingMutations.filter((item) => item !== operation.marker);
        } else {
          operation.task.status = 'uncertain'; operation.task.reason = 'removal-not-proven';
          operation.marker.phase = 'uncertain';
          revoke('removal-not-proven', state.status === 'stopped' ? 'stopped' : 'paused');
        }
        if (['challenge', 'action-block', 'rate-limit', 'session-expired'].includes(result?.restriction)) {
          revoke(result.restriction, state.status === 'stopped' ? 'stopped' : 'paused');
        }
        await persist();
        return { verified: result?.verified === true, state: snapshot() };
      });
    } finally {
      await serial(async () => {
        inFlight.delete(lease.threadId);
        if (!operation.dispatched && operation.marker && !storageTimeout && state.reason !== 'storage-failed') {
          state.pendingMutations = state.pendingMutations.filter((item) => item !== operation.marker);
          await persist();
        }
      });
    }
  }
  return Object.freeze({
    snapshot,
    batchProgress: () => ({
      mode: frozen.assignmentMode || 'contiguous',
      currentBatchIndex: currentBatch(),
      totalBatches: frozen.assignmentMode === 'batches' ? Math.ceil(frozen.threadIds.length / frozen.workerCount) : null,
      preparedWorkerLimit: frozen.workerCount,
      mutationConcurrency: concurrency,
    }),
    approve: (reviewKey, accountId) => serial(async () => {
      if (storageTimeout) fail('storage-timeout');
      if (reviewKey !== key || accountId !== frozen.accountId) fail('review-changed');
      if (hasPending() || leases.size || inFlight.size) fail('reconciliation-required');
      if (state.status === 'stopped' || state.status === 'completed') fail('job-finished');
      if (now() >= frozen.expiresAt) fail('approval-expired');
      if (concurrency > 1 && now() >= capability.expiresAt) fail('concurrency-capability-expired');
      authorized = true; abort = new AbortController(); state.status = 'running'; state.reason = null;
      await persist(); return snapshot();
    }),
    claim: (workerIndex, accountId) => serial(async () => {
      active(accountId);
      if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= frozen.workerCount) fail('worker-invalid');
      if ([...leases.values()].some((lease) => lease.workerIndex === workerIndex)) fail('worker-already-assigned');
      const batch = currentBatch();
      const task = state.tasks.find((item) => item.workerIndex === workerIndex && item.status === 'pending'
        && (frozen.assignmentMode !== 'batches' || item.batchIndex === batch));
      if (!task) return null;
      const lease = Object.freeze({ threadId: task.threadId, workerIndex, generation });
      leases.set(task.threadId, lease); task.status = 'running'; await persist(); return lease;
    }),
    mutate: (lease, options) => concurrency > 1 ? concurrentMutation(lease, options) : serial(async () => {
      const { accountId, actionId, kind, inspect, execute, delayMs } = options;
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
      if (!TERMINAL.has(status) || status === 'uncertain' || state.pendingMutation
        || pendingFor(lease.threadId) || inFlight.has(lease.threadId)) fail('completion-invalid');
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
      if (inFlight.has(threadId)) fail('worker-settlement-required');
      if (pendingFor(threadId) && reconciled !== true) fail('reconciliation-required');
      const task = state.tasks.find((item) => item.threadId === threadId);
      if (!task) fail('thread-not-reviewed');
      leases.delete(threadId);
      if (state.pendingMutation?.threadId === threadId) state.pendingMutation = null;
      if (state.pendingMutations) state.pendingMutations = state.pendingMutations.filter((item) => item.threadId !== threadId);
      if (['running', 'partial', 'uncertain'].includes(task.status)) {
        task.status = 'skipped'; task.reason = 'worker-retired';
      }
      await persist(); return snapshot();
    }),
  });
}
