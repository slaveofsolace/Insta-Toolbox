(() => {
  'use strict';

  if (globalThis.InstaToolboxOwnReactions) return;

  const emojiOnly = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D)+$/u;
  const text = (node) => String(node?.textContent || '').trim().replace(/\s+/g, ' ');
  const visible = (node) => Boolean(node && node.isConnected !== false
    && !node.closest?.('[hidden], [aria-hidden="true"]')
    && (!node.getClientRects || node.getClientRects().length));
  const uncertain = (message) => Object.assign(new Error(message), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  const badgeEmoji = (node) => {
    const value = text(node).replace(/\s*[0-9]{1,6}$/, '').trim();
    return emojiOnly.test(value) ? value : null;
  };
  const badgeCount = (node) => Number(text(node).match(/([0-9]{1,6})$/)?.[1] || 1);
  const plans = new WeakSet();
  const consumed = new WeakSet();
  const unresolvedAttempts = new Set();
  function fingerprint(value) {
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (const character of value) {
      const code = character.codePointAt(0);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${value.length}:${first >>> 0}:${second >>> 0}`;
  }
  function createPlan({ threadId, accountUsername, expiresAt, limit = null } = {}) {
    if (!/^[0-9]{1,128}$/.test(threadId || '') || !/^[a-z0-9._]{1,30}$/.test(accountUsername || '')
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 20 * 60_000
      || (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5_000))) return null;
    // A plan is an isolated-runtime object, not restorable/importable authority.
    const plan = Object.freeze({ version: 1, threadId, accountUsername, expiresAt, limit });
    plans.add(plan); return plan;
  }
  function validatePlan(plan, threadId, accountUsername) {
    return plans.has(plan) && !consumed.has(plan) && plan.threadId === threadId
      && plan.accountUsername === accountUsername && plan.expiresAt > Date.now();
  }
  function consumePlan(plan, threadId, accountUsername) {
    if (!validatePlan(plan, threadId, accountUsername)) throw new Error('reaction-review-required');
    consumed.add(plan);
  }

  function reactionBadges(row) {
    return [...row?.querySelectorAll?.('[role="button"]') || []].filter((node) => (
      node.isConnected && node.getAttribute('tabindex') === '0'
      && !node.getAttribute('aria-label') && !node.getAttribute('aria-haspopup')
      && !node.closest?.('[aria-label="Message actions"]')
      && node.querySelector?.('[role="none"]') && badgeEmoji(node)
    ));
  }
  const badges = (row) => reactionBadges(row).filter(visible);

  function messageSignature(row) {
    // Instagram aria-hides the conversation while reaction details are open.
    // That accessibility change must not turn the badge into message content.
    const reactions = reactionBadges(row);
    const relevant = (node) => !node.closest?.('[aria-label="Message actions"]')
      && !reactions.some((badge) => badge === node || badge.contains(node));
    const ids = ['data-message-id', 'data-item-id'].map((name) => row.getAttribute?.(name) || '');
    const content = [...row.querySelectorAll('[dir="auto"], img, video, audio, a[href]')]
      .filter(relevant).filter((node) => !node.querySelector?.('[dir="auto"]'))
      .map((node) => [node.tagName, node.getAttribute?.('src') || '',
        node.getAttribute?.('href') || '', text(node)]);
    return JSON.stringify([ids, content]);
  }

  function messageIdentity(row) {
    for (const attribute of ['data-message-id', 'data-item-id']) {
      const value = row.getAttribute?.(attribute);
      if (value) return `${attribute}:${value}`;
    }
    return null;
  }

  function create({ document = globalThis.document, inspectContext, assertAuthorized,
    now = Date.now, timeoutMs = 3_000, stableMs = 200 } = {}) {
    if (!document || typeof inspectContext !== 'function' || typeof assertAuthorized !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000
      || !Number.isFinite(stableMs) || stableMs < 0 || stableMs > timeoutMs) {
      throw new Error('reaction-adapter-invalid');
    }
    const openDialogs = () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .filter((dialog) => visible(dialog) && [...dialog.querySelectorAll('h1, h2, h3, [role="heading"]')]
        .some((heading) => text(heading) === 'Reactions'));
    const emoji = (row) => [...row.querySelectorAll('span')].map(text).filter((value) => emojiOnly.test(value));
    const busy = (node) => node?.getAttribute?.('aria-busy') === 'true'
      || [...node?.querySelectorAll?.('[aria-busy="true"], [role="progressbar"], [aria-label="Loading"]') || []]
        .some(visible);
    function reactionRows(dialog, expectedEmoji = null) {
      return [...dialog.querySelectorAll('[role="button"]')].filter((row) => visible(row)
        && row.getAttribute('tabindex') === '0'
        && (expectedEmoji ? emoji(row).includes(expectedEmoji) : emoji(row).length));
    }
    function ownRows(dialog, expectedEmoji) {
      const isColumn = (node) => {
        const style = document.defaultView?.getComputedStyle?.(node);
        return node?.tagName === 'DIV' && ['flex', 'inline-flex'].includes(style?.display)
          && style.flexDirection === 'column';
      };
      return reactionRows(dialog, expectedEmoji).filter((row) => (
        [...row.querySelectorAll('span')].some((hint) => {
          if (text(hint) !== 'Select to remove' || hint.children?.length) return false;
          const secondary = hint.parentElement, column = secondary?.parentElement;
          const [name, detail] = [...column?.children || []];
          // Native ownership is the dedicated subtitle under a separate name,
          // not a participant's display name containing the same words.
          return isColumn(secondary) && secondary.children.length === 1
            && secondary.children[0] === hint && isColumn(column)
            && column.children.length === 2 && detail === secondary
            && name?.tagName === 'SPAN' && Boolean(text(name));
        })
      ));
    }
    function otherRows(dialog, expectedEmoji) {
      const mine = new Set(ownRows(dialog, expectedEmoji));
      return reactionRows(dialog).filter((row) => !mine.has(row)).map(text).sort();
    }
    function close(dialog, threadId, accountId, signal, dispatched = false) {
      guard(threadId, accountId, signal, dispatched);
      const controls = [...dialog.querySelectorAll('button, [role="button"]')]
        .filter((node) => visible(node) && (node.getAttribute('aria-label') || text(node)) === 'Close');
      if (controls.length !== 1) throw new Error('reaction-close-unavailable');
      controls[0].click();
    }
    function guard(threadId, accountId, signal, dispatched = false) {
      const context = inspectContext();
      if (context?.threadId !== threadId || context?.accountId !== accountId
        || context?.accountVerified !== true || context?.usable !== true
        || context?.restriction) throw new Error('reaction-context-changed');
      if (!dispatched) {
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        const authorized = assertAuthorized({ threadId, accountId, kind: 'reaction' });
        if (authorized !== true) {
          // Async grants cannot authorize a click that is about to happen.
          // Drain rejected promises without treating them as approval.
          if (authorized && typeof authorized.then === 'function') Promise.resolve(authorized).catch(() => {});
          throw new Error('reaction-authorization-required');
        }
      }
    }
    function wait(check, signal) {
      return new Promise((resolve, reject) => {
        const deadline = now() + timeoutMs;
        let timer, observer, settled = false;
        const finish = (error, value) => {
          if (settled) return; settled = true;
          clearTimeout(timer); observer?.disconnect();
          signal?.removeEventListener('abort', onAbort);
          error ? reject(error) : resolve(value);
        };
        const onAbort = () => finish(new DOMException('Stopped', 'AbortError'));
        const inspect = () => {
          if (settled) return;
          try {
            if (signal?.aborted) return onAbort();
            if (now() >= deadline) return finish(new Error('reaction-readiness-timeout'));
            const value = check();
            if (value) return finish(null, value);
            clearTimeout(timer); timer = setTimeout(inspect, Math.min(50, deadline - now()));
          } catch (error) { finish(error); }
        };
        try {
          inspect();
          if (settled) return;
          const Observer = document.defaultView?.MutationObserver;
          if (Observer) {
            observer = new Observer(inspect);
            observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
          }
          signal?.addEventListener('abort', onAbort, { once: true }); inspect();
        } catch (error) {
          finish(error);
        }
      });
    }
    return Object.freeze({
      badges,
      async remove({ row, badge, threadId, accountId, signal }) {
        guard(threadId, accountId, signal);
        if (!row?.isConnected || row.querySelectorAll('[aria-label="Message actions"]').length !== 1
          || !badges(row).includes(badge)) throw new Error('reaction-target-unavailable');
        const selectedEmoji = badgeEmoji(badge), signature = messageSignature(row);
        const attemptKey = JSON.stringify([accountId, threadId,
          messageIdentity(row) || fingerprint(signature), selectedEmoji]);
        if (unresolvedAttempts.has(attemptKey)) throw new Error('reaction-already-attempted');
        if (openDialogs().length) throw new Error('reaction-dialog-already-open');
        const unchanged = () => row.isConnected && messageSignature(row) === signature;
        let dialog, dispatched = false;
        try {
          guard(threadId, accountId, signal);
          badge.click();
          dialog = await wait(() => {
            guard(threadId, accountId, signal);
            if (!unchanged()) throw new Error('reaction-message-changed');
            const dialogs = openDialogs();
            if (dialogs.length > 1) throw new Error('reaction-dialog-ambiguous');
            return dialogs[0] || null;
          }, signal);
          let readySince = null, readySignature = null;
          await wait(() => {
            guard(threadId, accountId, signal);
            if (!unchanged() || !visible(dialog) || openDialogs().length !== 1) {
              throw new Error('reaction-message-changed');
            }
            const rows = reactionRows(dialog);
            if (busy(dialog) || !rows.length
              || reactionRows(dialog, selectedEmoji).length < badgeCount(badge)) {
              readySince = null; return false;
            }
            const current = JSON.stringify(rows.map(text).sort());
            if (current !== readySignature || readySince === null) {
              readySignature = current; readySince = now();
            }
            return now() - readySince >= stableMs;
          }, signal);
          const own = ownRows(dialog, selectedEmoji);
          if (own.length !== 1) {
            try {
              close(dialog, threadId, accountId, signal);
              await wait(() => {
                guard(threadId, accountId, signal);
                return !visible(dialog);
              }, signal);
            } catch (error) {
              if (signal?.aborted) throw error;
              throw Object.assign(new Error('reaction-dialog-close-unavailable'), { needsAttention: true });
            }
            return { verified: false, skipped: true, reason: own.length ? 'ownership-ambiguous' : 'not-my-reaction' };
          }
          const others = JSON.stringify(otherRows(dialog, selectedEmoji));
          guard(threadId, accountId, signal);
          if (!unchanged() || !visible(own[0])) throw new Error('reaction-message-changed');
          // Shared by every adapter in this isolated runtime. An uncertain
          // result cannot become a fresh attempt after native row remounting.
          if (unresolvedAttempts.has(attemptKey)) throw new Error('reaction-already-attempted');
          unresolvedAttempts.add(attemptKey);
          dispatched = true;
          own[0].click();
          let stableSince = null;
          let reopened = false;
          await wait(() => {
            // A dispatched removal must settle even after Stop. Stop cannot
            // turn an uncertain click into zero removals or a safe retry.
            guard(threadId, accountId, null, true);
            if (!unchanged()) throw uncertain('The message changed while checking its reaction.');
            const dialogs = openDialogs();
            if (dialogs.length > 1) throw uncertain('Reaction details became ambiguous.');
            const current = dialogs[0];
            const remainingBadges = reactionBadges(row);
            const matchingBadges = remainingBadges.filter((item) => badgeEmoji(item) === selectedEmoji);
            let removed = false;
            if (current) {
              if (busy(current)) { stableSince = null; return false; }
              removed = ownRows(current, selectedEmoji).length === 0
                && JSON.stringify(otherRows(current, selectedEmoji)) === others
                && (others !== '[]' || !matchingBadges.length);
            } else if (!remainingBadges.length && others === '[]') removed = true;
            else if (remainingBadges.length && !reopened) {
              // Grouped reactions keep the badge. Reopen details, not the
              // reaction toggle, to prove the other reactors are unchanged.
              reopened = true;
              remainingBadges[0].click();
              return false;
            }
            if (!removed) { stableSince = null; return false; }
            stableSince ??= now();
            return now() - stableSince >= stableMs;
          });
          const remainingDialog = openDialogs()[0];
          unresolvedAttempts.delete(attemptKey);
          if (remainingDialog) {
            try {
              close(remainingDialog, threadId, accountId, null, true);
              await wait(() => !visible(remainingDialog));
            }
            catch {
              // The removal is already proven. A stranded details dialog
              // needs attention, but must not erase that verified result.
              return { verified: true, skipped: false, removed: 1,
                needsAttention: true, reason: 'reaction-dialog-close-unavailable' };
            }
          }
          return { verified: true, skipped: false, removed: 1 };
        } catch (error) {
          if (dispatched) throw uncertain('Reaction removal could not be verified. Check this message before retrying.');
          if (dialog && visible(dialog) && error?.needsAttention !== true) {
            try { close(dialog, threadId, accountId, signal); } catch { /* Leave the native dialog for review. */ }
          }
          throw error;
        }
      },
    });
  }

  Object.defineProperty(globalThis, 'InstaToolboxOwnReactions', {
    configurable: false, writable: false,
    value: Object.freeze({ create, badges, createPlan, validatePlan, consumePlan }),
  });
})();
