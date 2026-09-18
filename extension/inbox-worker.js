import { createInboxReview, inboxReviewKey } from './inbox-coordinator.js';

const fail = (reason) => { throw new Error(reason); };

// Content-runtime adapter. Identity inspectors must come from the extension's
// isolated runtime, never from page messages or page-writable storage.
export function createInboxWorker({
  review, lease, handle, coordinator, managedTabs, runner,
  inspectContext, inspectCurrent, now = Date.now, nonce = () => crypto.randomUUID(),
}) {
  const plan = createInboxReview(review, review.reviewedAt ?? now());
  const reviewKey = inboxReviewKey(plan);
  if (!lease || !handle || lease.threadId !== handle.threadId
    || lease.workerIndex !== handle.workerIndex || !plan.threadIds.includes(lease.threadId)
    || typeof coordinator?.mutate !== 'function' || typeof coordinator?.snapshot !== 'function'
    || typeof managedTabs?.check !== 'function' || typeof inspectContext !== 'function'
    || typeof inspectCurrent !== 'function' || typeof runner?.start !== 'function'
    || typeof runner?.createPlan !== 'function' || typeof nonce !== 'function') fail('worker-adapter-invalid');
  if (plan.removeOwnReactions) fail('worker-reactions-unavailable');
  const abort = new AbortController();
  let started = false;
  let grant = null;
  const attempted = new Set();
  function current() {
    if (abort.signal.aborted) fail('worker-stopped');
    const state = coordinator.snapshot();
    if (state.status !== 'running' || inboxReviewKey(state.review) !== reviewKey) fail('worker-approval-revoked');
    if (now() >= plan.expiresAt) fail('worker-approval-expired');
    const context = inspectCurrent();
    if (context?.accountVerified !== true || context.accountId !== plan.accountId
      || context.threadId !== lease.threadId || context.documentId !== handle.documentId
      || context.usable !== true || context.challenge || context.rateLimited
      || context.actionBlocked || context.sessionExpired) fail('worker-context-changed');
    return context;
  }
  function candidateValid(candidate) {
    return typeof candidate?.key === 'string' && candidate.key.length > 0
      && candidate.key.length <= 512 && candidate.ownershipVerified === true
      && Number.isFinite(candidate.timestamp) && candidate.timestamp > 0
      && candidate.timestamp <= plan.reviewedAt;
  }
  function assertAction({ threadId, candidate }) {
    current();
    if (!grant || grant.signal.aborted || threadId !== lease.threadId
      || !candidateValid(candidate) || candidate.key !== grant.candidate.key
      || candidate.timestamp !== grant.candidate.timestamp) fail('worker-target-changed');
    return true;
  }
  async function waitForPacing(signal, deadline = plan.expiresAt) {
    while (true) {
      current();
      if (signal.aborted) fail('worker-stopped');
      if (now() >= deadline) fail('worker-admission-timeout');
      const remaining = coordinator.snapshot().nextActionAt - now();
      if (!(remaining > 0)) return;
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer); signal.removeEventListener('abort', cancelled);
          abort.signal.removeEventListener('abort', cancelled);
          if (error) reject(error); else resolve();
        };
        const cancelled = () => finish(new Error('worker-stopped'));
        const timer = setTimeout(() => finish(), Math.min(remaining, 250));
        signal.addEventListener('abort', cancelled, { once: true });
        abort.signal.addEventListener('abort', cancelled, { once: true });
        if (signal.aborted || abort.signal.aborted) cancelled();
      });
    }
  }
  const adapter = Object.freeze({
    signal: abort.signal,
    assertContext({ threadId }) {
      current();
      if (threadId !== lease.threadId) fail('worker-thread-changed');
      return true;
    },
    assertAction,
    async execute({ candidate, threadId, signal, execute }) {
      current();
      if (threadId !== lease.threadId || !candidateValid(candidate)) fail('worker-historical-boundary-unproven');
      if (attempted.has(candidate.key)) fail('worker-duplicate-target');
      if (typeof execute !== 'function') fail('worker-executor-unavailable');
      await waitForPacing(signal);
      await managedTabs.check(handle);
      current();
      const actionId = nonce();
      if (typeof actionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(actionId)) fail('worker-action-id-invalid');
      let verified = false;
      let stopReason = null;
      let executionEntered = false;
      const admissionDeadline = Math.min(plan.expiresAt, now() + 30_000);
      try {
        const mutation = {
          accountId: plan.accountId, actionId, kind: 'message',
          delayMs: 1_000,
          inspect: async ({ signal: coordinatorSignal }) => {
            if (signal.aborted || coordinatorSignal.aborted) fail('worker-stopped');
            await managedTabs.check(handle);
            const evidence = await inspectContext({ handle, threadId, reviewedAt: plan.reviewedAt });
            current();
            if (evidence?.accountVerified !== true || evidence.accountId !== plan.accountId
              || evidence.threadId !== threadId || evidence.documentId !== handle.documentId
              || evidence.usable !== true || evidence.challenge || evidence.rateLimited
              || evidence.actionBlocked || evidence.sessionExpired) fail('worker-context-unverified');
            return { accountId: plan.accountId, threadId, ownershipVerified: true,
              withinReviewedBoundary: true, exactTarget: true };
          },
          execute: async ({ signal: coordinatorSignal }) => {
            executionEntered = true;
            const cancelled = () => abort.abort(coordinatorSignal.reason || 'worker-approval-revoked');
            coordinatorSignal.addEventListener('abort', cancelled, { once: true });
            grant = { candidate, signal: coordinatorSignal };
            try {
              assertAction({ threadId, candidate });
              if (signal.aborted || coordinatorSignal.aborted) fail('worker-stopped');
              attempted.add(candidate.key);
              const outcome = await execute();
              verified = outcome?.verified === true;
              return { verified };
            } finally {
              grant = null;
              coordinatorSignal.removeEventListener('abort', cancelled);
            }
          },
        };
        let result;
        while (true) {
          try { result = await coordinator.mutate(lease, mutation); break; }
          catch (error) {
            // The shared admission clock can advance between our readiness
            // check and claim. Only this pre-dispatch rejection is retryable.
            if (error?.message !== 'account-pacing' || executionEntered || now() >= admissionDeadline) throw error;
            await waitForPacing(signal, admissionDeadline);
          }
        }
        if (result.verified !== true) return { verified: false };
      } catch (error) {
        if (!verified) throw error;
        // A proven external removal stays counted even when saving its
        // checkpoint fails. Do not dispatch another action or retry it.
        stopReason = 'worker-checkpoint-failed';
        abort.abort(stopReason);
      }
      return { verified, stopReason };
    },
  });
  return Object.freeze({
    stop(reason = 'worker-stopped') { abort.abort(reason); },
    async run() {
      if (started) fail('worker-already-started');
      started = true;
      current();
      await managedTabs.check(handle);
      current();
      const threadPlan = runner.createPlan({ threadId: lease.threadId, scope: plan.scope,
        limit: plan.limit, speed: plan.speed, expiresAt: plan.expiresAt });
      if (!threadPlan) fail('worker-thread-plan-invalid');
      return runner.start({ plan: threadPlan, workerAdapter: adapter });
    },
  });
}
