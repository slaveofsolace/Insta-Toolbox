const MODES = new Set(['presence', 'ghost']);
const brokerOwners = new WeakMap();
const identity = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (reason) => { throw new Error(reason); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// The manager and inspectors belong to one trusted runtime. This module neither
// reviews targets nor restores authority from saved metadata.
export function createAccountActivity({
  locks, inspectContext, inspectCurrent, reconcileOutcome = null,
  onSettled = async () => {}, now = Date.now,
  timers = { setTimeout, clearTimeout },
}) {
  if (typeof locks?.request !== 'function' || typeof inspectContext !== 'function'
    || typeof inspectCurrent !== 'function' || typeof onSettled !== 'function'
    || (reconcileOutcome !== null && typeof reconcileOutcome !== 'function')
    || typeof now !== 'function' || typeof timers?.setTimeout !== 'function'
    || typeof timers?.clearTimeout !== 'function') fail('activity-adapter-invalid');
  const leases = new WeakMap();
  if (!brokerOwners.has(locks)) brokerOwners.set(locks, new Map());
  const owners = brokerOwners.get(locks);
  let nextEpoch = 0;

  function bindingOf(input) {
    if (!input || !identity(input.accountId) || !MODES.has(input.mode)
      || !identity(input.jobId) || !identity(input.documentId)
      || !Number.isInteger(input.tabId) || input.tabId < 0
      || !Number.isFinite(input.expiresAt) || input.expiresAt <= now()) fail('activity-binding-invalid');
    return Object.freeze({ accountId: input.accountId, mode: input.mode, jobId: input.jobId,
      tabId: input.tabId, documentId: input.documentId, expiresAt: input.expiresAt });
  }
  function stateOf(lease) {
    const state = lease && leases.get(lease);
    if (!state) fail('activity-lease-invalid');
    return state;
  }
  function clearExpiry(state) {
    if (state.timer !== null) timers.clearTimeout(state.timer);
    state.timer = null;
  }
  function releaseIfSettled(state) {
    if (!state.endRequested || state.pending || state.unresolved || !state.held) return;
    clearExpiry(state);
    state.held = false;
    state.nativeLockHeld = false;
    state.status = 'released';
    if (owners.get(state.binding.accountId) === state.reservation) owners.delete(state.binding.accountId);
    state.hold.resolve();
  }
  function revoke(state, reason, status = 'needs-attention') {
    if (!state.held) return;
    state.endRequested = true;
    state.status = status;
    state.reason = reason;
    state.epoch += 1;
    clearExpiry(state);
    if (!state.abort.signal.aborted) state.abort.abort(reason);
    releaseIfSettled(state);
  }
  function checkExpiry(state) {
    if (state.held && now() >= state.binding.expiresAt) revoke(state, 'activity-expired', 'expired');
  }
  function scheduleExpiry(state) {
    clearExpiry(state);
    if (!state.held || state.endRequested) return;
    state.timer = timers.setTimeout(() => {
      state.timer = null;
      checkExpiry(state);
      scheduleExpiry(state);
    }, Math.min(2_147_483_647, Math.max(1, state.binding.expiresAt - now())));
    state.timer?.unref?.();
  }
  function validContext(binding, context) {
    return context?.accountVerified === true && context.accountId === binding.accountId
      && context.tabId === binding.tabId && context.documentId === binding.documentId
      && context.usable === true && !context.frozen && !context.discarded
      && !context.challenge && !context.rateLimited && !context.actionBlocked && !context.sessionExpired;
  }
  function active(state) {
    checkExpiry(state);
    if (!state.held || state.endRequested || state.abort.signal.aborted || state.unresolved) {
      fail(state.reason || 'activity-lease-revoked');
    }
  }
  function contextNow(state) {
    active(state);
    let context;
    try { context = inspectCurrent(state.binding); }
    catch { revoke(state, 'activity-context-unavailable'); fail('activity-context-unavailable'); }
    if (!validContext(state.binding, context)) {
      revoke(state, 'activity-context-changed'); fail('activity-context-changed');
    }
    return true;
  }
  function snapshotOf(state) {
    checkExpiry(state);
    return Object.freeze({ ...state.binding, status: state.status, reason: state.reason,
      epoch: state.epoch, lockHeld: state.held, nativeLockHeld: state.nativeLockHeld,
      inFlight: Boolean(state.pending),
      actionId: state.pending?.actionId || state.unresolved?.actionId || null,
      verified: state.verified, uncertain: Boolean(state.unresolved && !state.unresolved.verified),
      needsReconciliation: Boolean(state.unresolved),
      unresolvedReason: state.unresolved?.reason || null });
  }

  async function acquire(input) {
    const binding = bindingOf(input);
    if (owners.has(binding.accountId)) fail('account-activity-busy');
    const reservation = Object.freeze({});
    owners.set(binding.accountId, reservation);
    const ready = deferred();
    const hold = deferred();
    let state = null;
    const request = Promise.resolve().then(() => locks.request(
      `insta-toolbox:account-activity:${binding.accountId}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          if (owners.get(binding.accountId) === reservation) owners.delete(binding.accountId);
          ready.reject(new Error('account-activity-busy')); return;
        }
        const lease = Object.freeze(Object.create(null));
        state = { binding, hold, reservation, held: true, nativeLockHeld: true, status: 'active', reason: null,
          epoch: ++nextEpoch, abort: new AbortController(), timer: null,
          pending: null, unresolved: null, endRequested: false, attempts: new Set(), verified: 0 };
        leases.set(lease, state);
        try {
          contextNow(state);
          scheduleExpiry(state);
          ready.resolve(lease);
          await hold.promise;
        } catch (error) {
          revoke(state, error.message || 'activity-acquisition-failed');
          ready.reject(error);
        }
      },
    ));
    // A stolen or lost native lock is not evidence that a dispatched action
    // stopped. Revoke every future grant and preserve its unsettled outcome.
    void request.catch((error) => {
      if (state) { state.nativeLockHeld = false; revoke(state, 'activity-lock-lost'); }
      else if (owners.get(binding.accountId) === reservation) owners.delete(binding.accountId);
      ready.reject(error instanceof Error ? error : new Error('activity-lock-unavailable'));
    });
    return ready.promise;
  }

  async function run(lease, { actionId, execute } = {}) {
    const state = stateOf(lease);
    active(state);
    if (!identity(actionId) || typeof execute !== 'function') fail('activity-action-invalid');
    if (state.pending) fail('activity-action-in-flight');
    if (state.attempts.has(actionId)) fail('activity-action-already-used');
    const operation = { actionId, epoch: state.epoch, dispatched: false };
    state.pending = operation;
    const assertCurrent = () => {
      if (state.pending !== operation || state.epoch !== operation.epoch) fail('activity-grant-revoked');
      return contextNow(state);
    };
    try {
      const context = await inspectContext(state.binding, { signal: state.abort.signal });
      if (!validContext(state.binding, context)) {
        revoke(state, 'activity-context-changed'); fail('activity-context-changed');
      }
      assertCurrent();
      state.attempts.add(actionId);
      operation.dispatched = true;
      let outcome;
      try {
        outcome = await execute(Object.freeze({ signal: state.abort.signal, assertCurrent,
          actionId, epoch: operation.epoch }));
      } catch {
        outcome = { verified: false };
      }
      const verified = outcome?.verified === true;
      if (verified) state.verified += 1;
      else {
        state.unresolved = { actionId, reason: 'activity-outcome-uncertain' };
        revoke(state, 'activity-outcome-uncertain');
      }
      const record = Object.freeze({ ...state.binding, actionId,
        outcome: verified ? 'verified' : 'uncertain' });
      try { await onSettled(record); }
      catch {
        state.unresolved = { actionId, reason: 'activity-checkpoint-failed', verified };
        revoke(state, 'activity-checkpoint-failed');
      }
      return Object.freeze({ verified, uncertain: !verified, needsAttention: state.endRequested,
        reason: state.reason, actionId });
    } catch (error) {
      if (!operation.dispatched && !state.endRequested) revoke(state, 'activity-inspection-failed');
      throw error;
    } finally {
      state.pending = null;
      releaseIfSettled(state);
    }
  }

  async function reconcile(lease) {
    const state = stateOf(lease);
    if (!state.held || state.pending || !state.unresolved || !reconcileOutcome) fail('activity-reconciliation-unavailable');
    const unresolved = state.unresolved;
    state.pending = { actionId: unresolved.actionId, reconciliation: true };
    try {
      const before = await inspectContext(state.binding, { signal: null });
      if (!validContext(state.binding, before)) fail('activity-context-changed');
      const result = await reconcileOutcome(Object.freeze({ ...state.binding, actionId: unresolved.actionId,
        reason: unresolved.reason, previouslyVerified: unresolved.verified === true }));
      if (!['verified', 'not-applied'].includes(result?.outcome)
        || !validContext(state.binding, inspectCurrent(state.binding))) fail('activity-reconciliation-unproven');
      if (unresolved.verified && result.outcome !== 'verified') fail('activity-reconciliation-contradictory');
      await onSettled(Object.freeze({ ...state.binding, actionId: unresolved.actionId, outcome: result.outcome }));
      if (result.outcome === 'verified' && !unresolved.verified) state.verified += 1;
      state.unresolved = null;
      state.reason = 'activity-reconciled';
      return Object.freeze({ outcome: result.outcome });
    } finally {
      state.pending = null;
      releaseIfSettled(state);
    }
  }

  return Object.freeze({ acquire, run, reconcile,
    snapshot: (lease) => snapshotOf(stateOf(lease)),
    pause(lease) { const state = stateOf(lease); revoke(state, 'activity-paused', 'pausing'); return snapshotOf(state); },
    stop(lease) { const state = stateOf(lease); revoke(state, 'activity-stopped', 'stopping'); return snapshotOf(state); },
  });
}
