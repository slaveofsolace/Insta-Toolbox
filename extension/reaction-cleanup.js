(() => {
  'use strict';
  if (globalThis.InstaToolboxReactionCleanup) return;

  // A separate pass over surviving messages; it never invokes message Unsend.
  function create({ reactions = globalThis.InstaToolboxOwnReactions,
    createWalker = globalThis.InstaToolboxDmThreadUnsender?.createMessageWalker,
    inspectContext, now = Date.now } = {}) {
    if (typeof createWalker !== 'function' || typeof inspectContext !== 'function'
      || typeof reactions?.create !== 'function' || typeof reactions?.consumePlan !== 'function') {
      throw new Error('reaction-cleanup-unavailable');
    }
    let current = null;
    const wait = (ms, signal) => new Promise((resolve, reject) => {
      let timer, settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new DOMException('Stopped', 'AbortError'));
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(), ms);
      if (signal.aborted) abort();
    });
    let state = Object.freeze({ status: 'idle', removed: 0, skipped: 0,
      uncertain: 0, checked: 0, canStop: false, message: 'Ready' });
    const listeners = new Set();
    function publish(patch) {
      state = Object.freeze({ ...state, ...patch });
      for (const listener of listeners) { try { listener({ ...state }); } catch {} }
      return { ...state };
    }
    function contextFor(plan) {
      const context = inspectContext();
      if (context?.then || context?.threadId !== plan.threadId
        || context?.accountId !== plan.accountUsername || context.accountVerified !== true
        || context.usable !== true || context.restriction) throw new Error('reaction-context-changed');
      return context;
    }
    return Object.freeze({
      snapshot: () => ({ ...state }),
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener); listener({ ...state });
        return () => listeners.delete(listener);
      },
      stop() {
        if (!current || current.controller.signal.aborted) return false;
        publish({ status: 'stopping', canStop: false, message: 'Stopping after this reaction…' });
        current.controller.abort('Stopped'); return true;
      },
      async start({ plan, signal, onVerifiedRemoval } = {}) {
        if (current) throw new Error('reaction-cleanup-active');
        if (!plan || (signal && (typeof signal.aborted !== 'boolean'
          || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) {
          throw new Error('reaction-review-required');
        }
        contextFor(plan);
        reactions.consumePlan(plan, plan.threadId, plan.accountUsername);
        const controller = new AbortController();
        const run = { controller };
        current = run;
        const abort = () => controller.abort(signal?.reason || 'Stopped');
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        let walker;
        const checkRun = () => {
          if (current !== run || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
          if (plan.expiresAt <= now()) throw new Error('reaction-review-expired');
          contextFor(plan); return true;
        };
        const assertAuthorized = () => {
          checkRun();
          if (walker && walker.assertCurrent() !== true) throw new Error('reaction-traversal-interrupted');
          return true;
        };
        publish({ status: 'running', removed: 0, skipped: 0, uncertain: 0, complete: false, reason: null,
          checked: 0, canStop: true, message: 'Checking your reactions…' });
        try {
          assertAuthorized();
          walker = createWalker({ threadId: plan.threadId, expiresAt: plan.expiresAt,
            signal: controller.signal, order: 'newest', holdUntilClosed: true });
          if (typeof walker?.assertCurrent !== 'function' || typeof walker.next !== 'function'
            || typeof walker.close !== 'function') throw new Error('reaction-traversal-unavailable');
          const adapter = reactions.create({ inspectContext, assertAuthorized });
          let completed = false;
          let nextRemovalAt = 0;
          while (plan.limit === null || state.removed < plan.limit) {
            assertAuthorized();
            const item = await walker.next();
            checkRun();
            if (item.done) {
              if (!['exhausted', 'stable-exhaustion'].includes(item.reason)) {
                throw new Error(item.reason || 'reaction-traversal-unproven');
              }
              completed = true; break;
            }
            assertAuthorized();
            const row = item.value?.row || item.value;
            if (!row?.isConnected) throw new Error('reaction-message-changed');
            const badges = adapter.badges(row);
            for (const badge of badges) {
              assertAuthorized();
              if (plan.limit !== null && state.removed >= plan.limit) break;
              const remaining = nextRemovalAt - now();
              if (remaining > 0) await wait(remaining, controller.signal);
              assertAuthorized();
              const result = await adapter.remove({ row, badge, threadId: plan.threadId,
                accountId: plan.accountUsername, signal: controller.signal });
              if (result?.verified === true && result.removed === 1) {
                nextRemovalAt = now() + 1_000;
                publish({ removed: state.removed + 1,
                  message: `${state.removed + 1} reaction${state.removed === 0 ? '' : 's'} removed` });
                // Count settled removals even if Stop arrived after dispatch.
                if (typeof onVerifiedRemoval === 'function') {
                  try { await onVerifiedRemoval(Object.freeze({ removed: state.removed, threadId: plan.threadId })); }
                  catch { throw new Error('reaction-checkpoint-failed'); }
                }
                if (result.needsAttention) throw new Error(result.reason || 'reaction-dialog-close-unavailable');
              } else if (result?.skipped === true) {
                publish({ skipped: state.skipped + 1 });
              } else {
                throw Object.assign(new Error('reaction-outcome-uncertain'), { code: 'REACTION_OUTCOME_UNCERTAIN' });
              }
            }
            publish({ checked: state.checked + 1 });
          }
          if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
          publish({ status: 'completed', complete: completed, canStop: false,
            message: `${state.removed} reaction${state.removed === 1 ? '' : 's'} removed${state.skipped ? ` · ${state.skipped} skipped` : ''}` });
        } catch (error) {
          const uncertain = error?.code === 'REACTION_OUTCOME_UNCERTAIN';
          const stopped = !uncertain && controller.signal.aborted;
          publish({ status: stopped ? 'stopped' : 'needs-attention', complete: false,
            uncertain: uncertain ? 1 : 0, canStop: false,
            reason: uncertain ? 'reaction-outcome-uncertain' : error?.message || 'reaction-cleanup-interrupted',
            message: uncertain
              ? 'Reaction removal is uncertain. Check the conversation before trying again.'
              : stopped ? `Stopped · ${state.removed} reaction${state.removed === 1 ? '' : 's'} removed`
                : error?.message === 'reaction-checkpoint-failed'
                  ? `${state.removed} reaction${state.removed === 1 ? '' : 's'} removed; the local result could not be saved.`
                  : error?.message === 'reaction-dialog-close-unavailable'
                    ? `${state.removed} reaction${state.removed === 1 ? '' : 's'} removed. Close Instagram’s reaction list before continuing.`
                  : 'Reaction cleanup stopped. The conversation needs attention.' });
        } finally {
          try { walker?.close(); } finally {
            signal?.removeEventListener('abort', abort);
            if (current === run) current = null;
          }
        }
        return { ...state };
      },
    });
  }
  Object.defineProperty(globalThis, 'InstaToolboxReactionCleanup', {
    configurable: false, writable: false, value: Object.freeze({ create }),
  });
})();
