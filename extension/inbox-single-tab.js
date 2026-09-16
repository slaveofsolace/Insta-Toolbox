import { createInboxCoordinator, createInboxReview, inboxReviewKey } from './inbox-coordinator.js';

const fail = (reason) => { throw new Error(reason); };
const restricted = (context) => context?.restriction || context?.challenge || context?.rateLimited
  || context?.actionBlocked || context?.sessionExpired;

// This adapter has no page-message entry point. Its runner, navigation and
// identity readers must all belong to the same isolated runtime.
export function createSingleTabInboxReview(input, now = Date.now()) {
  if (input?.messageWindow !== 'during-run') fail('message-window-review-required');
  if (input.workerCount !== undefined && input.workerCount !== 1) fail('single-tab-worker-required');
  if (input.mutationConcurrency !== undefined && input.mutationConcurrency !== 1) fail('serial-mutations-required');
  if (input.removeOwnReactions === true) fail('inbox-reactions-unavailable');
  const review = createInboxReview({ ...input, workerCount: 1, mutationConcurrency: 1,
    messageWindow: 'during-run', removeOwnReactions: false }, now);
  if (review.messageWindow !== 'during-run') fail('message-window-contract-unavailable');
  return review;
}

export function createSingleTabInboxController({
  review, runner, navigate, inspectCurrent, locks, save, now = Date.now,
  restored = null, stageTimeoutMs = 30_000, saveTimeoutMs = 10_000,
} = {}) {
  if (typeof runner?.start !== 'function' || typeof runner?.createPlan !== 'function'
    || typeof navigate !== 'function' || typeof inspectCurrent !== 'function'
    || typeof locks?.request !== 'function' || typeof save !== 'function'
    || typeof now !== 'function') fail('single-tab-runtime-unavailable');
  const frozen = createSingleTabInboxReview(review, review?.reviewedAt ?? now());
  const reviewKey = inboxReviewKey(frozen);
  if (inboxReviewKey(review) !== reviewKey) fail('single-tab-review-invalid');
  const coordinator = createInboxCoordinator({ review: frozen, save, now, restored, stageTimeoutMs, saveTimeoutMs });
  const listeners = new Set();
  const abort = new AbortController();
  const lockName = `insta-toolbox:account-activity:${frozen.accountId}`;
  let authority = null, used = false, running = null, active = null, lockHeld = false;
  let phase = restored ? 'review-required' : 'review', documentId = null, actionSequence = 0;
  const pendingNative = new Set();
  const snapshot = () => {
    const state = coordinator.snapshot();
    return { ...state, phase,
      currentThreadId: active?.lease.threadId || null, lockHeld,
      canStart: !restored && !used && !abort.signal.aborted,
      canStop: Boolean(running && phase !== 'finished' && !abort.signal.aborted),
      canSkip: Boolean(active && !active.abort.signal.aborted && !abort.signal.aborted),
    };
  };
  function publish(nextPhase = phase) {
    phase = nextPhase;
    for (const listener of listeners) { try { listener(snapshot()); } catch {} }
  }
  function context(threadId = null, requireAuthority = true) {
    if (abort.signal.aborted) fail('inbox-run-stopped');
    if (now() >= frozen.expiresAt) fail('approval-expired');
    if (requireAuthority && (!authority || !lockHeld || coordinator.snapshot().status !== 'running')) fail('inbox-approval-revoked');
    const value = inspectCurrent();
    if (!value || value.then || value.accountVerified !== true || value.accountId !== frozen.accountId
      || value.usable !== true || typeof value.documentId !== 'string' || !value.documentId
      || (documentId && documentId !== value.documentId)) fail('inbox-context-changed');
    if (restricted(value)) fail('inbox-account-restricted');
    if (threadId !== null && value.threadId !== threadId) fail('inbox-thread-changed');
    return value;
  }
  async function pacing(signal) {
    while (coordinator.snapshot().nextActionAt > now()) {
      context(active.lease.threadId);
      if (signal.aborted || active.abort.signal.aborted) fail('inbox-thread-stopped');
      await new Promise((resolve, reject) => {
        let timer, settled = false;
        const finish = (error) => {
          if (settled) return; settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', cancelled);
          active?.abort.signal.removeEventListener('abort', cancelled);
          error ? reject(error) : resolve();
        };
        const cancelled = () => finish(new Error('inbox-thread-stopped'));
        signal.addEventListener('abort', cancelled, { once: true });
        active.abort.signal.addEventListener('abort', cancelled, { once: true });
        timer = setTimeout(() => finish(), Math.min(250, coordinator.snapshot().nextActionAt - now()));
        if (signal.aborted || active.abort.signal.aborted) cancelled();
      });
    }
  }
  function adapterFor(item, token) {
    let grant = null, inFlight = false;
    const attemptedKeys = new Set();
    const guard = () => {
      if (token !== authority || active !== item || item.abort.signal.aborted) fail('inbox-thread-stopped');
      context(item.lease.threadId);
      return true;
    };
    const validCandidate = (candidate) => candidate?.ownershipVerified === true
      && (candidate.key === null || (typeof candidate.key === 'string' && candidate.key.length > 0 && candidate.key.length <= 512))
      && (candidate.timestamp === null || (Number.isFinite(candidate.timestamp) && candidate.timestamp > 0));
    const assertAction = ({ threadId, candidate }) => {
      guard();
      if (!grant || grant.signal.aborted || threadId !== item.lease.threadId || !validCandidate(candidate)
        || candidate.key !== grant.candidate.key || candidate.timestamp !== grant.candidate.timestamp) fail('inbox-target-changed');
      return true;
    };
    return Object.freeze({
      signal: item.abort.signal,
      assertContext({ threadId }) { guard(); if (threadId !== item.lease.threadId) fail('inbox-thread-changed'); return true; },
      assertAction,
      async execute({ candidate, threadId, signal, execute }) {
        guard();
        if (threadId !== item.lease.threadId || !validCandidate(candidate) || typeof execute !== 'function'
          || !signal || signal.aborted) fail('inbox-target-unproven');
        if (candidate.key && attemptedKeys.has(candidate.key)) fail('inbox-target-already-attempted');
        if (inFlight) fail('inbox-action-in-flight');
        const approvedCandidate = Object.freeze({ key: candidate.key, timestamp: candidate.timestamp,
          ownershipVerified: true });
        inFlight = true;
        let verified = false;
        try {
          await pacing(signal);
          guard();
          const result = await coordinator.mutate(item.lease, {
            accountId: frozen.accountId, actionId: `single_${++actionSequence}`, kind: 'message', delayMs: 1_000,
            inspect: async ({ signal: coordinatorSignal }) => {
              guard();
              if (signal.aborted || coordinatorSignal.aborted) fail('inbox-thread-stopped');
              return { accountId: frozen.accountId, threadId, ownershipVerified: true,
                withinReviewedBoundary: frozen.messageWindow === 'during-run', exactTarget: true };
            },
            execute: async ({ signal: coordinatorSignal }) => {
              const cancel = () => item.abort.abort(coordinatorSignal.reason || 'inbox-approval-revoked');
              coordinatorSignal.addEventListener('abort', cancel, { once: true });
              grant = { candidate: approvedCandidate, signal: coordinatorSignal };
              try {
                assertAction({ threadId, candidate: approvedCandidate });
                if (signal.aborted || coordinatorSignal.aborted) fail('inbox-thread-stopped');
                if (approvedCandidate.key) attemptedKeys.add(approvedCandidate.key);
                const native = Promise.resolve().then(execute);
                pendingNative.add(native);
                try { verified = (await native)?.verified === true; }
                finally { pendingNative.delete(native); }
                return { verified };
              } finally {
                grant = null;
                coordinatorSignal.removeEventListener('abort', cancel);
              }
            },
          });
          publish();
          return { verified: result.verified === true };
        } catch (error) {
          if (!verified) throw error;
          // Keep a proven result counted in the runner even if its checkpoint
          // failed. The coordinator has already revoked further authority.
          item.abort.abort('inbox-checkpoint-failed');
          return { verified: true, stopReason: 'inbox-checkpoint-failed' };
        } finally {
          inFlight = false;
        }
      },
    });
  }
  async function executeQueue(token) {
    return locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock || lock.name !== lockName || lock.mode !== 'exclusive') fail('inbox-account-busy');
      lockHeld = true;
      try {
        documentId = context(null, false).documentId;
        await coordinator.approve(reviewKey, frozen.accountId);
        context();
        while (!abort.signal.aborted && coordinator.snapshot().status === 'running') {
          context();
          const lease = await coordinator.claim(0, frozen.accountId);
          if (!lease) break;
          const item = { lease, abort: new AbortController(), skipped: false };
          active = item;
          const cancel = () => item.abort.abort(abort.signal.reason || 'inbox-run-stopped');
          abort.signal.addEventListener('abort', cancel, { once: true });
          try {
            publish('opening-conversation');
            await navigate({ accountId: frozen.accountId, threadId: lease.threadId,
              expiresAt: frozen.expiresAt, signal: item.abort.signal,
              assertCurrent: () => { context(); if (item.abort.signal.aborted) fail('inbox-thread-stopped'); return true; } });
            if (!item.abort.signal.aborted) {
              context(lease.threadId);
              const plan = runner.createPlan({ threadId: lease.threadId, scope: frozen.scope,
                limit: frozen.limit, speed: 'standard', expiresAt: frozen.expiresAt });
              if (!plan) fail('inbox-thread-plan-invalid');
              publish('unsending');
              const outcome = await runner.start({ plan, workerAdapter: adapterFor(item, token) });
              if (outcome?.uncertain > 0 || coordinator.snapshot().pendingMutation) {
                if (coordinator.snapshot().status === 'running') await coordinator.interrupt('removal-not-proven');
              } else if (!abort.signal.aborted && coordinator.snapshot().status === 'running') {
                const status = item.skipped ? 'skipped' : outcome?.status === 'completed' ? 'completed'
                  : outcome?.processed > 0 ? 'partial' : 'failed';
                await coordinator.finish(lease, status, status === 'completed' ? null : item.skipped ? 'skipped' : 'conversation-incomplete');
                if (!item.skipped && outcome?.status !== 'completed') await coordinator.interrupt('conversation-incomplete');
              }
            } else if (item.skipped && !abort.signal.aborted && coordinator.snapshot().status === 'running') {
              await coordinator.finish(lease, 'skipped', 'skipped');
            }
          } catch (error) {
            if (item.skipped && !abort.signal.aborted && coordinator.snapshot().status === 'running'
              && !coordinator.snapshot().pendingMutation) await coordinator.finish(lease, 'skipped', 'skipped');
            else {
              if (coordinator.snapshot().status === 'running') await coordinator.interrupt('execution-interrupted').catch(() => {});
              throw error;
            }
          } finally {
            abort.signal.removeEventListener('abort', cancel);
            item.abort.abort('conversation-finished');
            if (pendingNative.size) publish('settling');
            await Promise.allSettled([...pendingNative]);
            const settled = coordinator.snapshot();
            if (['paused', 'stopped'].includes(settled.status) && !settled.pendingMutation
              && settled.tasks.find(task => task.threadId === lease.threadId)?.status === 'running') {
              await coordinator.settleInterrupted(lease).catch(() => {});
            }
            active = null;
          }
        }
      } catch (error) {
        if (coordinator.snapshot().status === 'running') await coordinator.interrupt('execution-interrupted').catch(() => {});
        throw error;
      } finally {
        // An adapter timeout is not proof that a native action finished. Keep
        // the account lock until every dispatched native promise has settled.
        await Promise.allSettled([...pendingNative]);
        lockHeld = false;
        authority = null;
        publish('finished');
      }
      return snapshot();
    });
  }
  function interrupt(reason, stop) {
    if (used && phase === 'finished') return Promise.resolve(snapshot());
    abort.abort(reason);
    authority = null;
    publish('settling');
    const persisted = coordinator.interrupt(reason, { stop });
    return Promise.allSettled([persisted, running]).then(() => snapshot());
  }
  return Object.freeze({
    snapshot,
    reviewKey: () => reviewKey,
    subscribe(listener) {
      if (typeof listener !== 'function') fail('inbox-listener-invalid');
      listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener);
    },
    approve(key) {
      if (restored) fail('review-required-after-restart');
      if (used || abort.signal.aborted || authority) fail('inbox-review-already-used');
      if (key !== reviewKey) fail('inbox-review-changed');
      documentId = context(null, false).documentId;
      authority = Object.freeze({});
      return authority;
    },
    start(token) {
      if (restored || token !== authority || !authority || used || abort.signal.aborted) return Promise.reject(new Error('inbox-runtime-approval-required'));
      used = true;
      publish('starting');
      running = executeQueue(token).finally(() => { authority = null; publish('finished'); });
      return running;
    },
    pause: () => interrupt('paused', false),
    stop: () => interrupt('stopped', true),
    skip() {
      if (!active || abort.signal.aborted || active.abort.signal.aborted) return false;
      active.skipped = true; active.abort.abort('conversation-skipped'); publish('settling'); return true;
    },
  });
}
