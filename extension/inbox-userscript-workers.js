const JOB_KEY = 'instaToolboxGhostJobV1';
const VERSION = 1;
const MAX_THREADS = 1_000;
const MAX_WORKERS = 5;
const MAX_TTL_MS = 12 * 60 * 60_000;
const HEARTBEAT_MS = 3_000;
const STALE_MS = 90_000;
const TERMINAL = new Set(['completed', 'partial', 'skipped', 'failed', 'uncertain', 'stopped']);
const reviews = new WeakSet();
const consumed = new WeakSet();

const clone = value => structuredClone(value);
const fail = reason => { throw new Error(reason); };
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const digest = (value) => {
  const source = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function createUserscriptGhostReview({
  accountId,
  threadIds,
  workerCount = 2,
  openInBackground = true,
  expiresAt,
} = {}, now = Date.now()) {
  if (!identity(accountId) || !Array.isArray(threadIds) || !threadIds.length
    || threadIds.length > MAX_THREADS || !threadIds.every(identity)) fail('ghost-review-invalid');
  const unique = [...new Set(threadIds)];
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > MAX_WORKERS) {
    fail('ghost-worker-count-invalid');
  }
  const expiry = Math.min(Number(expiresAt) || (now + MAX_TTL_MS), now + MAX_TTL_MS);
  if (!Number.isFinite(expiry) || expiry <= now) fail('ghost-review-expired');
  const review = Object.freeze({
    version: VERSION,
    accountId,
    threadIds: Object.freeze(unique),
    workerCount: Math.min(workerCount, unique.length),
    openInBackground: openInBackground !== false,
    scope: 'all',
    reviewedAt: now,
    expiresAt: expiry,
  });
  reviews.add(review);
  return review;
}

export const userscriptGhostReviewKey = review => JSON.stringify(review);

export function createUserscriptGhostBridge({
  storage,
  locks,
  openTab,
  runner,
  inspectContext,
  location = globalThis.location,
  now = Date.now,
  random = Math.random,
  randomId = () => crypto.randomUUID(),
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  if (typeof storage?.get !== 'function' || typeof storage?.set !== 'function'
    || typeof storage?.listen !== 'function' || typeof storage?.unlisten !== 'function'
    || typeof locks?.request !== 'function' || typeof openTab !== 'function'
    || typeof runner?.createPlan !== 'function' || typeof runner?.start !== 'function'
    || typeof runner?.stop !== 'function' || typeof inspectContext !== 'function'
    || typeof now !== 'function' || typeof random !== 'function' || typeof randomId !== 'function'
    || typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function'
    || typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    fail('ghost-bridge-adapter-required');
  }

  const jobLock = () => 'insta-toolbox:ghost-job';
  const mutationLock = accountId => `insta-toolbox:ghost-mutation:${accountId}`;
  const coordinatorLock = jobId => `insta-toolbox:ghost-coordinator:${jobId}`;
  const read = async () => clone(await storage.get(JOB_KEY));
  const write = async value => storage.set(JOB_KEY, clone(value));
  const update = mutator => locks.request(jobLock(), { mode: 'exclusive' }, async () => {
    const current = await read();
    const next = await mutator(current);
    if (next) await write(next);
    return next ? clone(next) : current;
  });
  const validJob = (job) => job?.version === VERSION && identity(job.jobId)
    && identity(job.accountId) && Array.isArray(job.tasks)
    && job.tasks.every(task => identity(task.threadId) && typeof task.status === 'string');
  const activeJob = (job) => validJob(job) && job.status === 'running'
    && Number(job.expiresAt) > now();
  const coordinatorPresent = job => locks.request(
    coordinatorLock(job.jobId),
    { mode: 'exclusive', ifAvailable: true },
    async lock => !lock,
  );
  const threadFromLocation = () => String(location?.pathname || '').match(/^\/direct\/t\/([^/?#]+)\/?$/)?.[1] || null;
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    let timer = null;
    const finish = (error) => {
      clearTimeoutFn(timer);
      signal?.removeEventListener?.('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    if (signal?.aborted) return abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    timer = setTimeoutFn(() => finish(), ms);
  });

  function createManager(review) {
    if (!review || !reviews.has(review) || consumed.has(review)) fail('ghost-review-required');
    const coordinatorId = randomId();
    const listeners = new Set();
    const handles = new Map();
    let storageListener = null;
    let heartbeat = null;
    let current = null;
    let finishing = null;
    let releaseCoordinatorLock = null;
    let coordinatorLockPromise = null;
    let resolveFinished = null;
    const finished = new Promise(resolve => { resolveFinished = resolve; });
    const snapshot = () => current ? clone(current) : null;
    const publish = (job) => {
      current = job ? clone(job) : null;
      const value = snapshot();
      for (const listener of listeners) listener(value);
      if (value && value.status !== 'running') settle();
    };
    const settle = () => {
      if (finishing) return finishing;
      finishing = Promise.resolve().then(async () => {
        if (heartbeat !== null) clearIntervalFn(heartbeat);
        heartbeat = null;
        if (storageListener !== null) storage.unlisten(storageListener);
        storageListener = null;
        releaseCoordinatorLock?.();
        releaseCoordinatorLock = null;
        await Promise.resolve(coordinatorLockPromise).catch(() => {});
        for (const handle of handles.values()) {
          try { await handle?.close?.(); } catch {}
        }
        handles.clear();
        resolveFinished(snapshot());
        return snapshot();
      });
      return finishing;
    };
    const tick = async () => {
      const launches = [];
      const job = await update((value) => {
        if (!validJob(value) || value.jobId !== current?.jobId
          || value.coordinatorId !== coordinatorId || value.status !== 'running') return value;
        if (now() >= value.expiresAt) {
          value.status = 'expired'; value.reason = 'approval-expired';
          for (const task of value.tasks) if (!TERMINAL.has(task.status)) task.status = 'stopped';
          return value;
        }
        value.coordinatorHeartbeatAt = now();
        const stale = value.tasks.find(task => task.status === 'running'
          && now() - Number(task.workerHeartbeatAt) > STALE_MS);
        if (stale) {
          stale.status = 'uncertain'; stale.reason = 'worker-lost';
          value.status = 'paused'; value.reason = 'worker-lost';
          return value;
        }
        const active = value.tasks.filter(task => ['opening', 'running'].includes(task.status)).length;
        for (const task of value.tasks.filter(task => task.status === 'pending').slice(0, value.workerCount - active)) {
          task.status = 'opening';
          task.launchId = randomId();
          launches.push({ threadId: task.threadId, launchId: task.launchId });
        }
        if (value.tasks.every(task => TERMINAL.has(task.status))) {
          value.status = value.tasks.every(task => task.status === 'completed') ? 'completed' : 'partial';
        }
        value.updatedAt = now();
        return value;
      });
      publish(job);
      for (const launch of launches) {
        try {
          const handle = await openTab(`https://www.instagram.com/direct/t/${encodeURIComponent(launch.threadId)}/`, {
            active: !review.openInBackground, insert: true, setParent: true,
          });
          handles.set(launch.threadId, handle);
        } catch {
          const failed = await update((value) => {
            if (!validJob(value) || value.jobId !== current?.jobId) return value;
            const task = value.tasks.find(item => item.threadId === launch.threadId
              && item.launchId === launch.launchId && item.status === 'opening');
            if (task) { task.status = 'failed'; task.reason = 'tab-open-failed'; }
            value.status = 'paused'; value.reason = 'tab-open-failed'; value.updatedAt = now();
            return value;
          });
          publish(failed);
        }
      }
      return snapshot();
    };
    return Object.freeze({
      kind: 'multi-tab',
      snapshot,
      subscribe(listener) {
        if (typeof listener !== 'function') fail('ghost-listener-required');
        listeners.add(listener); if (current) listener(snapshot());
        return () => listeners.delete(listener);
      },
      async start() {
        if (current) fail('ghost-manager-started');
        consumed.add(review);
        const jobId = randomId();
        current = {
          version: VERSION, jobId, coordinatorId, accountId: review.accountId,
          status: 'running', reason: null, workerCount: review.workerCount,
          openInBackground: review.openInBackground,
          expiresAt: review.expiresAt, reviewedAt: review.reviewedAt,
          reviewKey: userscriptGhostReviewKey(review), coordinatorHeartbeatAt: now(),
          nextActionAt: 0, pendingMutation: null, updatedAt: now(),
          tasks: review.threadIds.map((threadId, index) => ({
            threadId, index, status: 'pending', messageRemovals: 0, reason: null,
          })),
        };
        let announceCoordinatorLock;
        const coordinatorReady = new Promise(resolve => { announceCoordinatorLock = resolve; });
        coordinatorLockPromise = locks.request(
          coordinatorLock(jobId),
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            announceCoordinatorLock(Boolean(lock));
            if (!lock) return;
            await new Promise(resolve => { releaseCoordinatorLock = resolve; });
          },
        );
        if (!await coordinatorReady) fail('ghost-coordinator-active');
        try {
          await locks.request(jobLock(), { mode: 'exclusive' }, async () => {
            const existing = await read();
            if (activeJob(existing)) fail('ghost-job-active');
            await write(current);
          });
          storageListener = storage.listen(JOB_KEY, value => {
            if (!validJob(value) || value.jobId !== current?.jobId) return;
            publish(value);
          });
          heartbeat = setIntervalFn(() => { void tick().catch(() => {}); }, HEARTBEAT_MS);
          await tick();
          return finished;
        } catch (error) {
          current.status = 'failed'; current.reason = error?.message || 'ghost-start-failed';
          await settle();
          throw error;
        }
      },
      async stop() {
        if (!current || current.status !== 'running') return snapshot();
        const stopped = await update((value) => {
          if (!validJob(value) || value.jobId !== current.jobId) return value;
          value.status = 'stopped'; value.reason = 'stopped'; value.updatedAt = now();
          for (const task of value.tasks) if (!TERMINAL.has(task.status)) {
            task.status = 'stopped'; task.reason = 'stopped';
          }
          return value;
        });
        publish(stopped);
        await settle();
        return snapshot();
      },
    });
  }

  async function attachWorker() {
    const threadId = threadFromLocation();
    if (!threadId) return null;
    const workerId = randomId();
    let latest = await read();
    const context = inspectContext();
    if (!activeJob(latest) || !await coordinatorPresent(latest)
      || context?.accountId !== latest.accountId
      || context?.threadId !== threadId || context?.usable !== true) return null;
    latest = await update((value) => {
      if (!activeJob(value) || value.accountId !== context.accountId) return value;
      const task = value.tasks.find(item => item.threadId === threadId && item.status === 'opening');
      if (!task) return value;
      task.status = 'running'; task.workerId = workerId; task.workerHeartbeatAt = now();
      value.updatedAt = now();
      return value;
    });
    let task = latest?.tasks?.find(item => item.threadId === threadId);
    if (!task || task.workerId !== workerId || task.status !== 'running') return null;
    const controller = new AbortController();
    const storageListener = storage.listen(JOB_KEY, value => {
      if (!validJob(value) || value.jobId !== latest.jobId) {
        controller.abort('ghost-worker-revoked'); runner.stop(); return;
      }
      latest = clone(value);
      const row = latest.tasks.find(item => item.threadId === threadId);
      if (latest.status !== 'running' || row?.workerId !== workerId || row.status !== 'running') {
        controller.abort(latest.reason || 'ghost-worker-revoked'); runner.stop();
      }
    });
    const heartbeat = setIntervalFn(() => { void update((value) => {
      if (!validJob(value) || value.jobId !== latest.jobId || value.status !== 'running') return value;
      const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
      if (row?.status === 'running') row.workerHeartbeatAt = now();
      value.updatedAt = now();
      return value;
    }).catch(() => { controller.abort('ghost-worker-storage-failed'); runner.stop(); }); }, HEARTBEAT_MS);
    const valid = (candidate = null) => {
      const currentContext = inspectContext();
      const row = latest?.tasks?.find(item => item.threadId === threadId);
      if (controller.signal.aborted || !activeJob(latest) || row?.workerId !== workerId
        || row?.status !== 'running' || currentContext?.accountId !== latest.accountId
        || currentContext?.threadId !== threadId || currentContext?.usable !== true
        || currentContext?.restriction) fail('ghost-worker-context-changed');
      if (candidate && candidate.ownershipVerified !== true) fail('ghost-worker-target-unproven');
      return true;
    };
    let grant = null;
    const adapter = Object.freeze({
      signal: controller.signal,
      assertContext: ({ threadId: expected }) => expected === threadId && valid(),
      assertAction: ({ threadId: expected, candidate }) => expected === threadId && grant
        && candidate?.key === grant.key && candidate?.timestamp === grant.timestamp && valid(candidate),
      execute: ({ candidate, threadId: expected, signal, execute }) => locks.request(
        mutationLock(latest.accountId), { mode: 'exclusive' }, async () => {
          if (expected !== threadId || signal.aborted || typeof execute !== 'function') fail('ghost-worker-target-unproven');
          latest = await read(); valid(candidate);
          if (!await coordinatorPresent(latest)) fail('ghost-coordinator-lost');
          while (Number(latest.nextActionAt) > now()) {
            await sleep(Math.min(500, latest.nextActionAt - now()), controller.signal);
            latest = await read(); valid(candidate);
            if (!await coordinatorPresent(latest)) fail('ghost-coordinator-lost');
          }
          grant = { key: candidate.key, timestamp: candidate.timestamp };
          latest = await update((value) => {
            if (!activeJob(value) || value.jobId !== latest.jobId || value.pendingMutation) fail('ghost-job-changed');
            const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
            if (row?.status !== 'running') fail('ghost-worker-revoked');
            value.pendingMutation = { threadId, workerId, phase: 'dispatched' };
            value.nextActionAt = now() + 1_000 + Math.floor(Math.max(0, Math.min(1, random())) * 1_000);
            value.updatedAt = now();
            return value;
          });
          let result;
          try { result = await execute(); }
          catch { result = { verified: false }; }
          latest = await update((value) => {
            if (!validJob(value) || value.jobId !== latest.jobId) return value;
            const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
            if (result?.verified === true && row) {
              row.messageRemovals += 1; value.pendingMutation = null;
            } else {
              if (row) { row.status = 'uncertain'; row.reason = 'removal-not-proven'; }
              if (value.pendingMutation?.workerId === workerId) value.pendingMutation.phase = 'uncertain';
              value.status = 'paused'; value.reason = 'removal-not-proven';
            }
            value.updatedAt = now();
            return value;
          });
          grant = null;
          if (result?.verified !== true) controller.abort('removal-not-proven');
          return { verified: result?.verified === true };
        }),
    });
    try {
      const plan = runner.createPlan({ threadId, scope: 'all', expiresAt: latest.expiresAt });
      if (!plan) fail('ghost-thread-plan-invalid');
      const outcome = await runner.start({ plan, workerAdapter: adapter });
      latest = await update((value) => {
        if (!validJob(value) || value.jobId !== latest.jobId) return value;
        const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
        if (!row || row.status !== 'running') return value;
        row.status = outcome?.status === 'completed' ? 'completed'
          : outcome?.uncertain ? 'uncertain' : outcome?.processed > 0 ? 'partial' : 'failed';
        row.reason = outcome?.status === 'completed' ? null : outcome?.message || 'conversation-incomplete';
        if (row.status === 'uncertain') { value.status = 'paused'; value.reason = 'removal-not-proven'; }
        value.updatedAt = now();
        return value;
      });
      return clone(latest.tasks.find(item => item.threadId === threadId));
    } finally {
      clearIntervalFn(heartbeat);
      storage.unlisten(storageListener);
      grant = null;
    }
  }

  return Object.freeze({
    createReview: value => createUserscriptGhostReview(value, now()),
    createManager,
    attachWorker,
    readJob: read,
  });
}

export const USERSCRIPT_GHOST_LIMITS = Object.freeze({ maxWorkers: MAX_WORKERS, maxThreads: MAX_THREADS });
