(() => {
  'use strict';

  const namespace = '__instaToolboxActionLabels';
  if (globalThis[namespace]) return;

  const relationshipEntries = Object.freeze([
    Object.freeze(['follow', 'not-following']),
    Object.freeze(['follow back', 'not-following']),
    Object.freeze(['following', 'following']),
    Object.freeze(['requested', 'requested']),
  ]);
  const dmUnsendLabels = Object.freeze([
    'annulla invio',
    'deshacer',
    'retirar',
    'retirer',
    'unsend',
    'zurücknehmen',
  ]);
  const dmActionSelectors = Object.freeze([
    "[aria-label^='See more options for message']",
    "[aria-label*='more options']",
    "[aria-label*='More']",
    "[aria-label*='Altre opzioni']",
    "[aria-label*='opzioni']",
    "[aria-label*='opciones']",
    "[aria-label*='options']",
    "[role='button'][aria-haspopup='menu']",
    "[role='button']",
  ]);
  const relationshipByLabel = new Map(relationshipEntries);
  const dmUnsendLabelSet = new Set(dmUnsendLabels);

  function normalizeActionLabel(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLowerCase();
  }

  function isDmMessageOptionsLabel(value) {
    const label = normalizeActionLabel(value);
    return label.startsWith('see more options for message')
      || label.startsWith('more options')
      || label.startsWith('altre opzioni')
      || label.startsWith('opzioni')
      || label.startsWith('opciones')
      || label.startsWith('options')
      || label === 'more';
  }

  const api = Object.freeze({
    dmActionSelectors,
    dmUnsendLabels,
    relationshipLabels: Object.freeze(relationshipEntries.map(([label]) => label)),
    isDmUnsendLabel(value) {
      return dmUnsendLabelSet.has(normalizeActionLabel(value));
    },
    isDmMessageOptionsLabel,
    normalizeActionLabel,
    relationshipForLabel(value) {
      return relationshipByLabel.get(normalizeActionLabel(value)) || null;
    },
  });

  Object.defineProperty(globalThis, namespace, {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();

(() => {
  'use strict';

  if (globalThis.InstaToolboxDmThreadUnsender) return;
  const actionLabels = globalThis.__instaToolboxActionLabels;
  if (!actionLabels) return;

  const ACTIVE_ATTRIBUTE = 'data-insta-toolbox-unsend-active';
  const DONE_ATTRIBUTE = 'data-insta-toolbox-unsent';
  const DEFAULT_MIN_DELAY_MS = 1_000;
  const DEFAULT_MAX_DELAY_MS = 2_000;
  const DEFAULT_MAX_FAILURES = 5;
  const MIN_USABLE_VISIBLE_PX = 24;
  const MAX_HOVER_DEPTH = 8;
  const MAX_HISTORY_CHECK_MS = 90_000;
  const MAX_SCAN_PASSES = 3;
  const MAX_PLAN_MESSAGES = 5_000;
  const MAX_EMPTY_GROWTH_ROUNDS = 600;
  const MAX_SCROLL_STEPS_PER_SEARCH = 2_000;
  const OLDEST_BOUNDARY_POLL_MS = 120;
  const OLDEST_BOUNDARY_STABLE_MS = 2_000;
  const STABLE_EMPTY_PASSES = 3;
  const PLAN_VERSION = 3;
  const SPEED_PROFILES = Object.freeze({
    standard: Object.freeze({ minDelayMs: 1_000, maxDelayMs: 2_000 }),
    fast: Object.freeze({ minDelayMs: 1_000, maxDelayMs: 2_000 }),
  });
  const PLAN_SCOPES = new Set(['all', 'newest', 'oldest']);
  const listeners = new Set();
  const consumedPlanDigests = new Map();

  let activeController = null;
  let activeMessageWalker = null;
  const readOnlyTraversals = new WeakMap();
  let activeExecution = null;
  let currentState = Object.freeze({
    status: 'idle',
    operation: null,
    processed: 0,
    failed: 0,
    retryAttempts: 0,
    consecutiveFailures: 0,
    current: null,
    message: 'Ready',
    startedAt: null,
    finishedAt: null,
    canStop: false,
    needsAttention: false,
    interruptionReason: null,
    uncertain: 0,
  });

  function snapshot() {
    return { ...currentState, phaseTimings: { ...(activeExecution?.phaseTimings || currentState.phaseTimings || {}) } };
  }

  function publish(patch) {
    currentState = Object.freeze({
      ...currentState,
      ...patch,
      phaseTimings: Object.freeze({ ...(activeExecution?.phaseTimings || currentState.phaseTimings || {}) }),
    });
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {
        // A view listener must not be able to interrupt the thread workflow.
      }
    }
    return snapshot();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function phaseClock() {
    return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
  }

  function recordPhase(phase, startedAt, excludedMs = 0) {
    if (!activeExecution) return;
    const durationMs = Math.max(0, phaseClock() - startedAt - excludedMs);
    activeExecution.phaseTimings[phase] = (activeExecution.phaseTimings[phase] || 0) + durationMs;
    try { activeExecution.onPhaseTiming?.(Object.freeze({ phase, durationMs })); } catch {}
  }

  async function measurePhase(phase, operation) {
    const startedAt = phaseClock();
    const resolutionBefore = activeExecution?.phaseTimings.messageResolution || 0;
    try { return await operation(); } finally {
      const excludedMs = phase === 'historyLoading'
        ? (activeExecution?.phaseTimings.messageResolution || 0) - resolutionBefore : 0;
      recordPhase(phase, startedAt, excludedMs);
    }
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      let timer;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(new DOMException('The operation was stopped.', 'AbortError'));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer = setTimeout(() => finish(), Math.max(0, ms));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  function randomDelay(minimum, maximum) {
    const min = Math.max(1_000, Number(minimum) || DEFAULT_MIN_DELAY_MS);
    const max = Math.max(min, Number(maximum) || DEFAULT_MAX_DELAY_MS);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function digestText(value) {
    let hash = 0x811c9dc5;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function planDigest({ version, threadId, scope, limit, detectedCount, expiresAt, speed }) {
    return digestText(JSON.stringify({
      version: Number(version),
      threadId: String(threadId || ''),
      scope: String(scope || ''),
      limit: limit === null ? null : Number(limit),
      detectedCount: detectedCount === null ? null : Number(detectedCount),
      expiresAt: Number(expiresAt),
      ...(Number(version) >= 3 ? { speed: String(speed || 'standard') } : {}),
    }));
  }

  function createPlan(value = {}) {
    const threadId = String(value.threadId || '').trim();
    const requestedScope = value.scope === null || value.scope === undefined || value.scope === ''
      ? 'all'
      : String(value.scope);
    if (!PLAN_SCOPES.has(requestedScope)) return null;
    const scope = requestedScope;
    const speed = value.speed === undefined ? 'standard' : String(value.speed);
    if (!Object.hasOwn(SPEED_PROFILES, speed)) return null;
    const requestedLimit = Math.floor(Number(value.limit));
    const limit = scope === 'all'
      ? null
      : Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(MAX_PLAN_MESSAGES, requestedLimit)
        : null;
    const hasDetectedCount = value.detectedCount !== null
      && value.detectedCount !== undefined
      && value.detectedCount !== '';
    const requestedDetectedCount = hasDetectedCount ? Number(value.detectedCount) : Number.NaN;
    const detectedCount = Number.isFinite(requestedDetectedCount) && requestedDetectedCount >= 0
      ? Math.min(MAX_PLAN_MESSAGES, Math.floor(requestedDetectedCount))
      : null;
    const expiresAt = Math.floor(Number(value.expiresAt) || 0);
    if (!threadId || (scope !== 'all' && !(limit > 0)) || expiresAt <= Date.now()) return null;
    const plan = {
      version: PLAN_VERSION,
      threadId,
      scope,
      limit,
      detectedCount,
      expiresAt,
      speed,
    };
    return Object.freeze({ ...plan, reviewedDigest: planDigest(plan) });
  }

  function validatePlan(value) {
    const version = Number(value?.version);
    if (![2, PLAN_VERSION].includes(version)) return null;
    if (version === 2 && value.speed !== undefined && value.speed !== 'standard') return null;
    const normalized = createPlan(value);
    if (!normalized) return null;
    const compatible = version === 2 ? { ...normalized, version: 2 } : normalized;
    const reviewedDigest = planDigest(compatible);
    return reviewedDigest === String(value?.reviewedDigest || '')
      ? Object.freeze({ ...compatible, reviewedDigest }) : null;
  }

  function visibleText(element) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return '';
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') return '';
    const rectangle = element.getBoundingClientRect?.();
    if (rectangle && rectangle.width === 0 && rectangle.height === 0) return '';
    return String(element.textContent || element.getAttribute?.('aria-label') || '').trim();
  }

  function overflowClips(value) {
    return /^(auto|scroll|hidden|clip)$/i.test(String(value || '').trim());
  }

  function hasUsableIntersection(start, end, clipStart, clipEnd) {
    const size = Math.max(0, Number(end) - Number(start));
    const visible = Math.max(
      0,
      Math.min(Number(end), Number(clipEnd)) - Math.max(Number(start), Number(clipStart)),
    );
    return visible >= Math.min(MIN_USABLE_VISIBLE_PX, size);
  }

  function clippedByAncestor(element, rectangle) {
    const documentElement = element.ownerDocument?.documentElement;
    const view = element.ownerDocument?.defaultView;

    for (let ancestor = element.parentElement;
      ancestor && ancestor !== documentElement;
      ancestor = ancestor.parentElement) {
      const style = view?.getComputedStyle?.(ancestor);
      const shorthand = String(style?.overflow || '').trim().split(/\s+/).filter(Boolean);
      const overflowX = style?.overflowX || shorthand[0] || '';
      const overflowY = style?.overflowY || shorthand[1] || shorthand[0] || '';
      const clipsX = overflowClips(overflowX);
      const clipsY = overflowClips(overflowY);
      if (!clipsX && !clipsY) continue;

      const bounds = ancestor.getBoundingClientRect?.();
      if (!bounds) continue;
      if (clipsX
        && !hasUsableIntersection(rectangle.left, rectangle.right, bounds.left, bounds.right)) return true;
      if (clipsY
        && !hasUsableIntersection(rectangle.top, rectangle.bottom, bounds.top, bounds.bottom)) return true;
    }

    return false;
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    if (typeof element.checkVisibility === 'function') {
      try {
        if (!element.checkVisibility({
          visibilityProperty: true,
          contentVisibilityAuto: true,
          opacityProperty: true,
        })) return false;
      } catch {
        // Older Chromium versions may not accept the options object.
      }
    }
    const rectangle = element.getBoundingClientRect?.();
    const viewportHeight = Number(element.ownerDocument?.defaultView?.innerHeight || globalThis.innerHeight || 0);
    const viewportWidth = Number(element.ownerDocument?.defaultView?.innerWidth || globalThis.innerWidth || 0);
    if (!rectangle || rectangle.height <= 0 || rectangle.width <= 0) return false;
    if (viewportHeight > 0
      && !hasUsableIntersection(rectangle.top, rectangle.bottom, 0, viewportHeight)) return false;
    if (viewportWidth > 0
      && !hasUsableIntersection(rectangle.left, rectangle.right, 0, viewportWidth)) return false;
    return !clippedByAncestor(element, rectangle);
  }

  function currentThreadId() {
    const match = String(location.pathname || '').match(/^\/direct\/t\/([^/?#]+)\/?$/i);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return '';
      }
    }
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(isVisible);
    if (roots.length !== 1) return '';
    const links = [...document.querySelectorAll("a[href*='/direct/t/']")].filter(isVisible);
    if (links.length !== 1) return '';
    const linkMatch = String(links[0].getAttribute?.('href') || '').match(/\/direct\/t\/([^/?#]+)/i);
    if (!linkMatch) return '';
    try {
      return decodeURIComponent(linkMatch[1]);
    } catch {
      return '';
    }
  }

  function sessionStop(expectedThreadId = '') {
    const observation = globalThis.InstaToolboxInstagramInspector?.inspectSession?.() || {};
    if (observation.sessionExpired) return 'Instagram signed you out';
    if (observation.challenge) return 'Instagram opened a security check';
    if (observation.actionBlocked) return 'Instagram blocked the action';
    if (observation.rateLimited) return 'Instagram asked you to slow down';
    const threadId = currentThreadId();
    if (!threadId) return 'The conversation is no longer open';
    if (expectedThreadId && threadId !== expectedThreadId) return 'The reviewed conversation changed';
    return null;
  }

  function lifecycleReason(signal) {
    return signal?.reason?.code === 'DM_LIFECYCLE_INTERRUPTED' ? signal.reason.reason : null;
  }

  function interruptionState(signal, processed, failed, uncertain = false) {
    const reason = lifecycleReason(signal);
    return {
      status: reason ? 'needs-attention' : 'stopped',
      needsAttention: Boolean(reason),
      interruptionReason: reason,
      uncertain: uncertain ? 1 : 0,
      message: reason
        ? `${reason === 'page-frozen' ? 'Tab suspended' : 'Page interrupted'}. ${uncertain ? 'The last Unsend outcome is uncertain. ' : ''}Review the conversation before starting again. ${processed} message${processed === 1 ? '' : 's'} unsent.`
        : `Stopped. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
      processed,
      failed,
      current: null,
      canStop: false,
      finishedAt: new Date().toISOString(),
    };
  }

  function watchThread(controller, expectedThreadId) {
    let timer;
    let observer;
    const check = () => {
      if (!controller.signal.aborted && currentThreadId() !== expectedThreadId) {
        controller.abort('Conversation changed. Unsend stopped.');
      }
    };
    const poll = () => {
      check();
      if (!controller.signal.aborted) timer = setTimeout(poll, 200);
    };
    const interrupt = (reason) => {
      if (controller.signal.aborted) return;
      if (activeController === controller) publish({
        status: 'stopping', canStop: false, needsAttention: true,
        interruptionReason: reason,
        message: 'Page interrupted. Settling the current action…',
      });
      controller.abort(Object.freeze({ code: 'DM_LIFECYCLE_INTERRUPTED', reason }));
    };
    const onFreeze = () => interrupt('page-frozen');
    const onPageHide = (event) => interrupt(event?.persisted ? 'page-cached' : 'page-left');
    const cleanup = () => {
      clearTimeout(timer);
      observer?.disconnect();
      globalThis.removeEventListener?.('popstate', check);
      globalThis.navigation?.removeEventListener?.('currententrychange', check);
      document.removeEventListener?.('freeze', onFreeze);
      globalThis.removeEventListener?.('pagehide', onPageHide);
      controller.signal.removeEventListener('abort', cleanup);
    };
    if (globalThis.MutationObserver && document.documentElement) {
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    globalThis.addEventListener?.('popstate', check);
    globalThis.navigation?.addEventListener?.('currententrychange', check);
    document.addEventListener?.('freeze', onFreeze);
    globalThis.addEventListener?.('pagehide', onPageHide);
    controller.signal.addEventListener('abort', cleanup, { once: true });
    if (controller.signal.aborted) { cleanup(); return cleanup; }
    poll();
    return cleanup;
  }

  function findScrollableChild(parent, view = globalThis) {
    if (!parent) return null;
    let best = null;
    const queue = [{ element: parent, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (depth > 10) continue;
      const style = view.getComputedStyle?.(element);
      const slack = Number(element.scrollHeight) - Number(element.clientHeight);
      if ((style?.overflowY === 'auto' || style?.overflowY === 'scroll') && slack > 8) {
        if (!best || slack > best.slack) best = { element, slack };
      }
      for (const child of element.children || []) queue.push({ element: child, depth: depth + 1 });
    }
    return best?.element || null;
  }

  function threadContext() {
    const threadId = currentThreadId();
    if (!threadId) {
      return { ok: false, reason: 'Open an Instagram conversation first.' };
    }
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(isVisible);
    const root = roots.length === 1 ? roots[0] : null;
    if (!root) {
      return { ok: false, reason: 'The message list is still loading. Keep the conversation open and try again.' };
    }
    const scroller = findScrollableChild(root, root.ownerDocument.defaultView);
    if (!scroller) {
      // Short conversations can fit without producing a scrollable descendant.
      return { ok: true, root, scroller: root, threadId };
    }
    return { ok: true, root, scroller, threadId };
  }

  function deepestMessageContainer(scroller) {
    let best = scroller;
    let bestCount = scroller?.children?.length || 0;
    let messageContainer = null;
    let messageCount = 0;
    const isMessageRow = (element) => ['row', 'listitem'].includes(element?.getAttribute?.('role'))
      || Boolean(element?.getAttribute?.('data-message-id') || element?.getAttribute?.('data-item-id'));
    const queue = [{ element: scroller, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (depth > 4) continue;
      const count = element?.children?.length || 0;
      const directMessages = [...element?.children || []].filter(isMessageRow).length;
      if (directMessages > messageCount) {
        messageContainer = element;
        messageCount = directMessages;
      }
      if (count > bestCount) {
        best = element;
        bestCount = count;
      }
      for (const child of element?.children || []) {
        if (!isMessageRow(child)) queue.push({ element: child, depth: depth + 1 });
      }
    }
    // Real rows outrank header/card child counts, including after a removal
    // leaves fewer rows than the surrounding layout has children.
    return messageContainer || best;
  }

  function hasMessageContent(row) {
    return Boolean(
      row?.querySelector?.('[role="none"], [role="presentation"], [dir="auto"], img, video, audio'),
    );
  }

  function sentByCurrentUser(row, view = globalThis) {
    const explicit = String(row?.getAttribute?.('data-sent-by-me') || '').toLowerCase();
    if (explicit === 'false') return false;
    if ([...row?.querySelectorAll?.('[data-sent-by-me]') || []].some((element) => (
      String(element.getAttribute?.('data-sent-by-me')).toLowerCase() === 'false'
    ))) return false;
    // Alignment belongs to the horizontal message wrapper, never a nested
    // reaction/menu or a column's vertical placement. Empty hidden spacers do
    // not split that wrapper chain; real content branches still do.
    // Native message groups keep their body and action controls together even
    // when a timestamp or reply heading is a sibling outside that group.
    // Accept only one outer message group; never search arbitrary descendants
    // for a right-aligned control or combine evidence from multiple messages.
    const groups = [...row?.querySelectorAll?.('[role="group"]') || []]
      .filter((group) => group.getAttribute?.('aria-label') !== 'Message actions'
        && group.querySelectorAll?.('[aria-label="Message actions"]').length === 1);
    const outerGroups = groups.filter((group) => !groups.some((other) => (
      other !== group && other.contains?.(group)
    )));
    if (outerGroups.length > 1) return false;
    if (outerGroups.length === 1) {
      for (let ancestor = outerGroups[0].parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = view.getComputedStyle?.(ancestor);
        if (['flex', 'inline-flex'].includes(style?.display)
          && style.flexDirection === 'row' && style.justifyContent === 'flex-start') return false;
        if (ancestor === row) break;
      }
      const group = outerGroups[0];
      const actions = group.querySelectorAll('[aria-label="Message actions"]')[0];
      let nativeAligned = false;
      // Replies and story shares add siblings above the message body. Follow
      // the one native action group's ancestry instead of treating those
      // siblings as the end of the message's ownership evidence.
      for (let lane = actions.parentElement; lane; lane = lane.parentElement) {
        const style = view.getComputedStyle?.(lane);
        const payload = [...lane.querySelectorAll?.('[dir="auto"], img, video, audio') || []]
          .some((element) => !actions.contains?.(element));
        if (payload && ['flex', 'inline-flex'].includes(style?.display)
          && style.flexDirection === 'row' && style.direction !== 'rtl') {
          if (style.justifyContent === 'flex-start') return false;
          if (style.justifyContent === 'flex-end') nativeAligned = true;
        }
        if (lane === group) break;
      }
      if (nativeAligned) return true;
    }
    let element = outerGroups.length === 1 ? outerGroups[0] : row;
    let aligned = false;
    for (let depth = 0; element && depth <= MAX_HOVER_DEPTH; depth += 1) {
      if (depth > 0 && element.matches?.('[dir="auto"], img, video, audio, button, [role="button"]')) break;
      const style = view.getComputedStyle?.(element);
      const horizontal = !style?.flexDirection || style.flexDirection === 'row';
      const flexLayout = !style?.display || ['flex', 'inline-flex'].includes(style.display);
      if (horizontal && flexLayout && style?.direction !== 'rtl') {
        if (style?.justifyContent === 'flex-start') return false;
        if (style?.justifyContent === 'flex-end') aligned = true;
      }
      const children = [...element.children || []].filter((child) => !(
        child.getAttribute?.('aria-hidden') === 'true'
        && !hasMessageContent(child) && !visibleText(child)
      ));
      if (children.length !== 1) break;
      element = children[0];
    }
    return explicit === 'true' || aligned;
  }

  function stableMessageKey(row) {
    // Only identifiers whose attribute names explicitly describe a message are
    // safe across Instagram's recycled virtual-list nodes. Generic `id` and
    // `data-id` values often identify the physical slot, not the logical DM.
    for (const attribute of ['data-message-id', 'data-item-id']) {
      const value = String(row?.getAttribute?.(attribute) || '').trim();
      if (value) return `${attribute}:${value}`;
    }
    for (const element of row?.querySelectorAll?.('[data-message-id], [data-item-id]') || []) {
      for (const attribute of ['data-message-id', 'data-item-id']) {
        const value = String(element?.getAttribute?.(attribute) || '').trim();
        if (value) return `${attribute}:${value}`;
      }
    }
    return null;
  }

  function messagePositionFingerprint(row, traversal = null) {
    const scroller = traversal?.scroller || row?.parentElement;
    const rowRect = row?.getBoundingClientRect?.();
    const scrollerRect = scroller?.getBoundingClientRect?.();
    const siblings = [...(row?.parentElement?.children || [])];
    const ordinal = siblings.indexOf(row);
    const scrollTop = Number(scroller?.scrollTop);
    const relativeTop = Number(rowRect?.top) - Number(scrollerRect?.top);
    return [
      Number.isFinite(scrollTop) ? Math.round(scrollTop) : '',
      Number.isFinite(relativeTop) ? Math.round(relativeTop) : '',
      ordinal >= 0 ? ordinal : '',
    ].join(':');
  }

  function genericMessageHint(row) {
    for (const attribute of ['data-id', 'id']) {
      const value = String(row?.getAttribute?.(attribute) || '').trim();
      if (value) return `${attribute}:${value}`;
    }
    return '';
  }

  function messageFingerprint(row, traversal = null) {
    const timestamp = String(
      row?.querySelector?.('time[datetime]')?.getAttribute?.('datetime')
      || row?.querySelector?.('[data-timestamp]')?.getAttribute?.('data-timestamp')
      || '',
    );
    return digestText(JSON.stringify({
      key: stableMessageKey(row),
      genericHint: genericMessageHint(row),
      position: messagePositionFingerprint(row, traversal),
      timestamp,
      text: preview(row),
    }));
  }

  function processedMarkerMatches(row, traversal = null) {
    const key = stableMessageKey(row);
    if (key && traversal?.processedKeys?.has(key)) return true;
    if (!row?.hasAttribute?.(DONE_ATTRIBUTE)) return false;
    const marker = String(row.getAttribute?.(DONE_ATTRIBUTE) || '');
    if (marker && marker === messageFingerprint(row, traversal)) return true;
    // Instagram can recycle a virtualized row node for another message. A
    // marker tied to the old content must not hide the newly mounted message.
    row.removeAttribute?.(DONE_ATTRIBUTE);
    return false;
  }

  function candidateRows(scroller, traversal = null) {
    const startedAt = phaseClock();
    const container = deepestMessageContainer(scroller);
    let rows = [...(container?.children || [])];
    if (!rows.length) {
      rows = [...(scroller?.querySelectorAll?.('[role="row"], [role="listitem"]') || [])];
    }
    const reader = traversal && readOnlyTraversals.get(traversal);
    const candidates = rows
      .filter((row) => reader ? !reader.visited(row, scroller) : !processedMarkerMatches(row, traversal))
      .filter((row) => !row.hasAttribute?.(ACTIVE_ATTRIBUTE))
      .filter(hasMessageContent)
      .filter((row) => reader
        ? Boolean(stableMessageKey(row)
          || ['row', 'listitem'].includes(row.getAttribute?.('role'))
          || ['true', 'false'].includes(row.getAttribute?.('data-sent-by-me'))
          || row.querySelectorAll?.('[aria-label="Message actions"]').length === 1)
        : sentByCurrentUser(row, row.ownerDocument.defaultView));
    recordPhase('messageResolution', startedAt);
    return candidates;
  }

  function orderedCandidates(scroller, order = 'oldest', traversal = null) {
    const rows = candidateRows(scroller, traversal);
    const positioned = rows.map((row, index) => {
      const rect = row?.getBoundingClientRect?.();
      const top = Number(rect?.top);
      const bottom = Number(rect?.bottom);
      return {
        index,
        position: Number.isFinite(top) && Number.isFinite(bottom)
          ? (top + bottom) / 2
          : Number.NaN,
        row,
      };
    });
    const distinctPositions = new Set(
      positioned.filter(({ position }) => Number.isFinite(position)).map(({ position }) => position),
    );
    if (distinctPositions.size > 1) {
      const direction = order === 'newest' ? -1 : 1;
      return positioned
        .sort((left, right) => {
          if (!Number.isFinite(left.position)) return 1;
          if (!Number.isFinite(right.position)) return -1;
          return ((left.position - right.position) * direction) || (left.index - right.index);
        })
        .map(({ row }) => row);
    }
    // Geometry can be unavailable in detached/unit-test DOM. Fall back to the
    // visual ordering implied by the container's flex direction.
    const newestFirst = reversedLayout(scroller) ? rows : [...rows].reverse();
    return order === 'newest' ? newestFirst : newestFirst.reverse();
  }

  function firstVisibleCandidate(scroller, order = 'oldest', traversal = null) {
    const rows = orderedCandidates(scroller, order, traversal);
    return rows.find(isVisible) || null;
  }

  async function waitForElement(target, getter, signal, timeoutMs = 3_000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      let timer;
      let observer;
      let settled = false;
      const cleanup = () => {
        observer?.disconnect();
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
      };
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(null, new DOMException('The operation was stopped.', 'AbortError'));
      const check = () => {
        if (settled) return;
        if (signal?.aborted) { onAbort(); return; }
        if (Date.now() >= deadline) { finish(null); return; }
        try {
          const value = getter();
          if (signal?.aborted) onAbort();
          else if (Date.now() >= deadline) finish(null);
          else if (value) finish(value);
        } catch (error) { finish(null, error); }
      };
      const expire = () => {
        if (settled) return;
        const remaining = deadline - Date.now();
        if (remaining > 0) timer = setTimeout(expire, remaining);
        else finish(null);
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      check();
      if (settled) return;
      try {
        observer = new MutationObserver(check);
        observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
        if (settled) return;
        timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
        check();
      } catch (error) { finish(null, error); }
    });
  }

  function dispatch(target, event) {
    EventTarget.prototype.dispatchEvent.call(target, event);
  }

  function hoverOptions(target) {
    const rectangle = target.getBoundingClientRect?.() || { x: 0, y: 0, width: 0, height: 0 };
    return {
      bubbles: true,
      cancelable: true,
      clientX: rectangle.x + (rectangle.width / 2),
      clientY: rectangle.y + (rectangle.height / 2),
      pointerId: 1,
      pointerType: 'mouse',
    };
  }

  function hoverIn(target) {
    const options = hoverOptions(target);
    if (typeof PointerEvent === 'function') {
      dispatch(target, new PointerEvent('pointerenter', { ...options, bubbles: false }));
      dispatch(target, new PointerEvent('pointerover', options));
      dispatch(target, new PointerEvent('pointermove', options));
    }
    dispatch(target, new MouseEvent('mouseenter', { ...options, bubbles: false }));
    dispatch(target, new MouseEvent('mouseover', options));
    dispatch(target, new MouseEvent('mousemove', options));
  }

  function hoverOut(target) {
    const options = hoverOptions(target);
    if (typeof PointerEvent === 'function') {
      dispatch(target, new PointerEvent('pointerout', options));
      dispatch(target, new PointerEvent('pointerleave', { ...options, bubbles: false }));
    }
    dispatch(target, new MouseEvent('mouseout', options));
    dispatch(target, new MouseEvent('mouseleave', { ...options, bubbles: false }));
  }

  function hoverTargets(row) {
    const targets = [];
    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      targets.push(element);
      if (depth < MAX_HOVER_DEPTH) {
        for (const child of element.children || []) queue.push({ element: child, depth: depth + 1 });
      }
    }
    return targets;
  }

  function clickable(element, scope = document) {
    const control = element?.closest?.('button, [role="button"], [role="menuitem"]');
    return control && scope.contains(control) ? control : null;
  }

  function isDmMessageOptionsControl(control) {
    const ownLabel = actionLabels.normalizeActionLabel(control?.getAttribute?.('aria-label'));
    const text = actionLabels.normalizeActionLabel(visibleText(control));
    const iconLabels = [...control?.querySelectorAll?.('[aria-label]') || []]
      .map((element) => actionLabels.normalizeActionLabel(element.getAttribute?.('aria-label')))
      .filter(Boolean);
    // An explicit accessible name is authoritative. A generic "More" caption
    // or decorative ellipsis cannot override Reply, Share, or another action.
    if (ownLabel && !actionLabels.isDmMessageOptionsLabel(ownLabel)) return false;
    if (text && !actionLabels.isDmMessageOptionsLabel(text) && !/^[.\u2026\u22ef\u22ee]+$/u.test(text)) return false;
    if (iconLabels.some((label) => !actionLabels.isDmMessageOptionsLabel(label))) return false;
    return Boolean(ownLabel || actionLabels.isDmMessageOptionsLabel(text) || iconLabels.length);
  }

  function actionButton(row) {
    const matches = [];
    for (const selector of actionLabels.dmActionSelectors) {
      for (const element of row.querySelectorAll?.(selector) || []) {
        const control = clickable(element, row) || (element.matches?.('button, [role="button"]') ? element : null);
        if (control) matches.push(control);
      }
    }
    const controls = [...new Set(matches)]
      .filter(isDmMessageOptionsControl)
      .filter(isVisible);
    return controls.length === 1 ? controls[0] : null;
  }

  function activateControl(control) {
    HTMLElement.prototype.click.call(control);
  }

  function visibleSurfaces(selector) {
    return [...document.querySelectorAll(selector)].filter((element) => visibleText(element));
  }

  // Instagram renders the message menu in a portal near the end of <body>, and
  // that container does not reliably carry role="menu". Scoping the search to
  // newly added menu surfaces therefore finds nothing and every message times
  // out, so the search runs over the whole document.
  //
  // Only leaf elements are considered — ones whose own first child is a text
  // node. An ancestor's textContent also reads "Unsend", and matching those
  // produced several candidates for one item.
  function unsendCandidates(scope = document) {
    const found = [];
    for (const element of scope?.querySelectorAll?.('span, div, button, [role="button"], [role="menuitem"]') || []) {
      if (element.firstChild?.nodeType !== 3) continue;
      if (!actionLabels.isDmUnsendLabel(visibleText(element))) continue;
      if (!isVisible(element)) continue;
      found.push(clickable(element, document) || element);
    }
    return [...new Set(found)];
  }

  async function dismissStaleSurfaces(signal) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!visibleSurfaces('[role="dialog"], [role="menu"], [role="listbox"]').length) return;
      dispatch(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(160, signal);
    }
  }

  async function revealActionButton(row, signal) {
    await dismissStaleSurfaces(signal);
    const targets = hoverTargets(row);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const target of targets) hoverIn(target);
      const fast = activeExecution?.speed === 'fast';
      const control = fast
        ? await waitForElement(row, () => actionButton(row), signal, 110)
        : (await delay(110, signal), actionButton(row));
      if (control) return control;
      for (const target of targets) hoverOut(target);
      if (!fast) await delay(60, signal);
    }
    for (const target of targets) hoverIn(target);
    return waitForElement(row, () => actionButton(row), signal, 3_000);
  }

  function authorizationFailure(expectedThreadId, authorizationExpiresAt) {
    if (!(Number(authorizationExpiresAt) > Date.now())) return 'Live authorization expired before the next Instagram control.';
    return sessionStop(expectedThreadId);
  }

  function requireAuthorization(expectedThreadId, authorizationExpiresAt, actionGrant = false) {
    if (activeController?.signal.aborted) {
      throw new DOMException('The operation was stopped.', 'AbortError');
    }
    const reason = authorizationFailure(expectedThreadId, authorizationExpiresAt);
    if (reason) throw new Error(reason);
    const adapter = activeExecution?.workerAdapter;
    const authorized = !adapter || (actionGrant
      ? adapter.assertAction({ threadId: expectedThreadId, candidate: workerCandidate(activeExecution.workerRow) })
      : adapter.assertContext({ threadId: expectedThreadId })) === true;
    if (!authorized) {
      const error = new Error('The reviewed worker no longer owns this action.');
      error.code = 'DM_WORKER_STOP';
      throw error;
    }
  }

  function workerCandidate(row) {
    const timestamps = new Set();
    const nodes = [row, ...row?.querySelectorAll?.('[data-timestamp-ms], [data-timestamp], time[datetime]') || []];
    for (const element of nodes) {
      for (const attribute of ['data-timestamp-ms', 'data-timestamp', 'datetime']) {
        const raw = element?.getAttribute?.(attribute);
        if (!raw) continue;
        const numeric = Number(raw);
        const timestamp = Number.isFinite(numeric)
          ? (attribute === 'data-timestamp' && numeric < 100_000_000_000 ? numeric * 1_000 : numeric)
          : Date.parse(raw);
        if (Number.isFinite(timestamp) && timestamp > 0) timestamps.add(timestamp);
      }
    }
    return Object.freeze({
      key: stableMessageKey(row),
      timestamp: timestamps.size === 1 ? [...timestamps][0] : null,
      ownershipVerified: Boolean(row?.isConnected && sentByCurrentUser(row)),
    });
  }

  async function openUnsendMenu(control, signal, expectedThreadId, authorizationExpiresAt) {
    const existing = new Set(unsendCandidates(document));
    const pending = waitForElement(document.body, () => {
      const candidates = unsendCandidates(document).filter((candidate) => !existing.has(candidate));
      if (candidates.length > 1) return { ambiguous: true };
      return candidates.length === 1 ? { control: candidates[0] } : null;
    }, signal, 3_000);
    pending.catch(() => {});
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    activateControl(control);
    const result = await measurePhase('menuReadiness', () => pending);
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    if (result?.ambiguous) throw new Error('Instagram showed more than one new Unsend option.');
    return result;
  }

  function dialogControlHasUnsendLabel(control) {
    if (actionLabels.isDmUnsendLabel(visibleText(control))) return true;
    return [...control.querySelectorAll?.('span, div') || []].some((element) => (
      element.firstChild?.nodeType === 3
      && actionLabels.isDmUnsendLabel(visibleText(element))
    ));
  }

  function dialogUnsendCandidates(existing = new Set()) {
    return [...document.querySelectorAll(
      '[role="dialog"] button, [role="dialog"] [role="button"]',
    )]
      .filter(isVisible)
      .filter((candidate) => !existing.has(candidate))
      .filter(dialogControlHasUnsendLabel);
  }

  async function confirmUnsend(menuControl, row, signal, expectedThreadId, authorizationExpiresAt) {
    // A normal confirmation dialog may contain both Cancel and Unsend. Accept
    // exactly one newly surfaced, localized Unsend control while ignoring
    // unrelated dialog buttons and every control that pre-dated this step.
    const existing = new Set(
      [...document.querySelectorAll(
        '[role="dialog"] button, [role="dialog"] [role="button"]',
      )].filter(isVisible),
    );
    const pending = waitForElement(
      document.body,
      () => {
        const candidates = dialogUnsendCandidates(existing);
        if (candidates.length > 1) return { ambiguous: true };
        return candidates.length === 1 ? { control: candidates[0] } : null;
      },
      signal,
      3_000,
    );
    pending.catch(() => {});
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    activateControl(menuControl);
    const result = await measurePhase('confirmationReadiness', () => pending);
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    if (result?.ambiguous) throw new Error('Instagram showed more than one new Unsend confirmation.');
    const dialogButton = result?.control;
    if (!dialogButton) return false;

    const before = removalEvidence(row);
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    try {
      activateControl(dialogButton);
      // Stop prevents the next click, but a dispatched mutation still needs
      // bounded settlement. Never retry an outcome that could have succeeded.
      const verified = await measurePhase('verification', () => waitForRemoval(row, before, {
        dialogButton,
        contextValid: () => currentThreadId() === expectedThreadId,
      }));
      if (!verified) throw new Error('Removal could not be verified.');
      return true;
    } catch {
      const error = new Error('The last Unsend outcome is uncertain. Check the conversation before starting again.');
      error.code = 'DM_OUTCOME_UNCERTAIN';
      throw error;
    }
  }

  async function unsendRow(row, signal, expectedThreadId, authorizationExpiresAt) {
    row.setAttribute(ACTIVE_ATTRIBUTE, '');
    let success = false;
    try {
      const control = await measurePhase('menuReadiness', () => revealActionButton(row, signal));
      if (!control) throw new Error('The message menu did not appear.');
      const menu = await openUnsendMenu(
        control,
        signal,
        expectedThreadId,
        authorizationExpiresAt,
      );
      if (!menu?.control) throw new Error('Instagram did not show an Unsend option.');
      success = await confirmUnsend(
        menu.control,
        row,
        signal,
        expectedThreadId,
        authorizationExpiresAt,
      );
      if (!success) throw new Error('The message was not confirmed as removed.');
      return true;
    } finally {
      row.removeAttribute(ACTIVE_ATTRIBUTE);
      if (!success && !signal.aborted) await dismissStaleSurfaces(signal).catch(() => {});
    }
  }

  function reversedLayout(scroller) {
    return scroller?.ownerDocument?.defaultView?.getComputedStyle?.(scroller)?.flexDirection === 'column-reverse'
      || Number(scroller?.scrollTop) < 0;
  }

  function oldestOffset(scroller, reversed) {
    return reversed ? -(scroller.scrollHeight - scroller.clientHeight) : 0;
  }

  function newestOffset(scroller, reversed) {
    return reversed ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function visibleLoader(root) {
    return [...root.querySelectorAll?.('[role="progressbar"], svg[aria-label*="Loading" i]') || []]
      .find(isVisible) || null;
  }

  async function waitForLoader(root, signal) {
    if (!visibleLoader(root)) return;
    await Promise.race([
      waitForElement(root, () => visibleLoader(root) === null, signal, 5_000),
      delay(5_000, signal),
    ]).catch(() => {});
  }

  function advanceHistoryProgress(progress, height, rowCount) {
    const nextHeight = Math.max(0, Number(height) || 0);
    const nextRows = Math.max(0, Math.floor(Number(rowCount) || 0));
    return {
      grew: nextHeight > progress.maxHeight || nextRows > progress.maxRows,
      maxHeight: Math.max(progress.maxHeight, nextHeight),
      maxRows: Math.max(progress.maxRows, nextRows),
    };
  }

  async function loadAllHistory(context, signal) {
    const { root, scroller } = context;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 50) {
      return { complete: true, detectedCount: candidateRows(scroller || root).length, pagesChecked: 0 };
    }
    const reversed = reversedLayout(scroller);
    const startedAt = Date.now();
    let quietRounds = 0;
    let topNudgeUsed = false;
    let pagesChecked = 0;
    let progress = advanceHistoryProgress(
      { maxHeight: 0, maxRows: 0 },
      scroller.scrollHeight,
      candidateRows(scroller).length,
    );
    // Instagram pauses between pages on a long thread, so a few quiet rounds
    // does not mean the history ended. Giving up after three left most of a
    // long conversation unloaded, which is the same impatience the follower
    // scan had.
    for (let page = 0;
      page < 600 && quietRounds < 10 && Date.now() - startedAt < MAX_HISTORY_CHECK_MS;
      page += 1) {
      pagesChecked = page + 1;
      const stop = sessionStop(context.threadId);
      if (stop) throw new Error(stop);
      const target = oldestOffset(scroller, reversed);
      if (Math.abs(scroller.scrollTop - target) > 5) {
        scroller.scrollTop = target;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
      } else if (!topNudgeUsed && quietRounds >= 2) {
        // Some Instagram builds only restart lazy history loading after real
        // movement at the oldest edge. Wake that loader once per loaded page,
        // not on every quiet poll: repeated nudges made the conversation look
        // as though the run was permanently fighting manual scrolling.
        scroller.scrollTop = target + (reversed ? 1 : -1) * Math.max(80, Math.floor(scroller.clientHeight / 2));
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        await delay(80, signal);
        scroller.scrollTop = target;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        topNudgeUsed = true;
      } else {
        // A synthetic edge notification is enough while waiting for a loader
        // that is already in flight and does not visibly move the thread.
        dispatch(scroller, new Event('scroll', { bubbles: true }));
      }
      await delay(500, signal);
      await waitForLoader(root, signal);
      progress = advanceHistoryProgress(
        progress,
        scroller.scrollHeight,
        candidateRows(scroller).length,
      );
      const { grew } = progress;
      quietRounds = grew ? 0 : quietRounds + 1;
      if (grew) topNudgeUsed = false;
      publish({
        status: 'preparing',
        message: grew ? 'Loading older messages…' : 'Checking for older messages…',
        canStop: true,
      });
    }
    // Stay at the oldest end. Jumping back to the newest message made the run
    // start from the bottom and work upward, which is slower and re-renders
    // the thread constantly. Loading to the top and then working down from
    // there is both faster and easier to watch.
    scroller.scrollTop = oldestOffset(scroller, reversed);
    dispatch(scroller, new Event('scroll', { bubbles: true }));
    await delay(100, signal);
    progress = advanceHistoryProgress(
      progress,
      scroller.scrollHeight,
      candidateRows(scroller).length,
    );
    return {
      complete: quietRounds >= 10,
      // Instagram virtualizes long conversations. This is only the largest
      // simultaneously mounted sent-message window, never a proven total.
      detectedCount: progress.maxRows,
      pagesChecked,
    };
  }

  function rowNeedsReposition(row, scroller) {
    if (!isVisible(row)) return true;
    const rowRect = row.getBoundingClientRect?.();
    const scrollerRect = scroller?.getBoundingClientRect?.();
    if (!rowRect || !scrollerRect) return false;
    const inset = Math.min(16, Math.max(4, Math.floor(scrollerRect.height * 0.04)));
    return rowRect.top < scrollerRect.top + inset
      || rowRect.bottom > scrollerRect.bottom - inset;
  }

  async function exposeRow(row, scroller, signal, traversal = null) {
    if (!rowNeedsReposition(row, scroller)) return isVisible(row);
    traversal && readOnlyTraversals.get(traversal)?.check(true);
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    dispatch(scroller, new Event('scroll', { bubbles: true }));
    await delay(60, signal);
    traversal && readOnlyTraversals.get(traversal)?.check();
    return isVisible(row);
  }

  function createTraversal(order = 'newest') {
    return {
      order: order === 'oldest' ? 'oldest' : 'newest',
      scroller: null,
      lastScrollTop: null,
      lastScrollHeight: 0,
      lastSearchGrew: false,
      lastSearchIncomplete: false,
      lastSearchSteps: 0,
      oldestBoundaryProven: order !== 'oldest',
      processedKeys: new Set(),
    };
  }

  function traversalContext(context, traversal) {
    readOnlyTraversals.get(traversal)?.check();
    let current = context;
    if (context?.threadId) {
      current = threadContext();
      if (!current.ok || current.threadId !== context.threadId) {
        throw new Error(current.reason || 'The reviewed conversation changed.');
      }
    }
    if (traversal.scroller !== current?.scroller) {
      if (traversal.order === 'oldest' && traversal.scroller) {
        traversal.oldestBoundaryProven = false;
      }
      traversal.scroller = current.scroller;
      traversal.lastScrollTop = null;
      traversal.lastScrollHeight = Number(current.scroller?.scrollHeight) || 0;
    }
    return current;
  }

  function traversalBounds(scroller, order) {
    const reversed = reversedLayout(scroller);
    const oldest = oldestOffset(scroller, reversed);
    const newest = newestOffset(scroller, reversed);
    const start = order === 'oldest' ? oldest : newest;
    const end = order === 'oldest' ? newest : oldest;
    return { start, end, direction: end >= start ? 1 : -1 };
  }

  function oldestBoundarySnapshot(context) {
    const scroller = context?.scroller;
    const rows = [...(deepestMessageContainer(scroller)?.children || [])];
    const rowEvidence = rows.map((row, index) => ({
      genericHint: genericMessageHint(row),
      index,
      key: stableMessageKey(row),
      text: visibleText(row).slice(0, 120),
      timestamp: String(
        row?.querySelector?.('time[datetime]')?.getAttribute?.('datetime')
        || row?.querySelector?.('[data-timestamp]')?.getAttribute?.('data-timestamp')
        || '',
      ),
    }));
    return {
      height: Number(scroller?.scrollHeight) || 0,
      loaderVisible: Boolean(visibleLoader(context?.root)),
      oldest: traversalBounds(scroller, 'oldest').start,
      rowCount: rows.length,
      rowSignature: digestText(JSON.stringify(rowEvidence)),
      scroller,
    };
  }

  async function proveStableOldestBoundary(
    context,
    traversal,
    signal,
    authorizationExpiresAt,
  ) {
    const startedAt = Date.now();
    let stableKey = '';
    let stableSince = 0;

    while (Date.now() - startedAt < MAX_HISTORY_CHECK_MS) {
      const reader = readOnlyTraversals.get(traversal);
      if (reader) reader.check(true);
      else requireAuthorization(context.threadId, authorizationExpiresAt);
      const current = traversalContext(context, traversal);
      const before = oldestBoundarySnapshot(current);
      current.scroller.scrollTop = before.oldest;
      dispatch(current.scroller, new Event('scroll', { bubbles: true }));
      await delay(OLDEST_BOUNDARY_POLL_MS, signal);

      if (reader) reader.check();
      else requireAuthorization(context.threadId, authorizationExpiresAt);
      const refreshed = traversalContext(context, traversal);
      const after = oldestBoundarySnapshot(refreshed);
      const atOldest = Math.abs(Number(after.scroller?.scrollTop) - after.oldest) <= 1;
      const replaced = before.scroller !== after.scroller;
      const changed = replaced
        || before.height !== after.height
        || before.rowCount !== after.rowCount
        || before.rowSignature !== after.rowSignature;
      const nextKey = [
        after.height,
        after.oldest,
        after.rowCount,
        after.rowSignature,
      ].join(':');

      if (!atOldest || after.loaderVisible || changed) {
        stableKey = '';
        stableSince = 0;
        continue;
      }
      if (stableKey !== nextKey) {
        stableKey = nextKey;
        stableSince = Date.now();
        continue;
      }
      if (Date.now() - stableSince >= OLDEST_BOUNDARY_STABLE_MS) {
        traversal.scroller = after.scroller;
        traversal.lastScrollTop = after.oldest;
        traversal.lastScrollHeight = after.height;
        traversal.lastSearchGrew = false;
        traversal.lastSearchIncomplete = false;
        traversal.lastSearchSteps = 0;
        traversal.oldestBoundaryProven = true;
        return refreshed;
      }
    }

    throw new Error('The oldest conversation boundary could not be proven before the safety timeout.');
  }

  function markProcessedRow(row, traversal, keyBeforeRemoval) {
    if (keyBeforeRemoval) traversal.processedKeys.add(keyBeforeRemoval);
    // Tie the marker to the postcondition DOM, not merely the physical node.
    // If Instagram recycles the node for a different message, the fingerprint
    // changes and candidateRows removes the stale marker.
    row.setAttribute?.(DONE_ATTRIBUTE, messageFingerprint(row, traversal));
  }

  function resetTraversalAfterRemoval(traversal, scroller, before = {}) {
    const scrollerChanged = Boolean(before.scroller && before.scroller !== scroller);
    const height = Number(scroller?.scrollHeight) || 0;
    const previousHeight = Number(before.scrollHeight);
    const shrank = Number.isFinite(previousHeight) && height + 1 < previousHeight;
    traversal.scroller = scroller;
    if (traversal.order === 'oldest' && (scrollerChanged || shrank)) {
      traversal.oldestBoundaryProven = false;
    }
    traversal.lastScrollTop = scrollerChanged || shrank
      ? null
      : Number.isFinite(Number(scroller?.scrollTop))
        ? Number(scroller.scrollTop)
        : traversal.lastScrollTop;
    traversal.lastScrollHeight = height;
    traversal.lastSearchGrew = false;
    traversal.lastSearchIncomplete = false;
    traversal.lastSearchSteps = 0;
  }

  async function reestablishTraversalEdge(context, traversal, signal) {
    for (let attempt = 0; attempt < MAX_SCAN_PASSES; attempt += 1) {
      if (signal.aborted) return null;
      const current = traversalContext(context, traversal);
      const scroller = current.scroller;
      const previousHeight = Number(traversal.lastScrollHeight) || 0;
      const { start } = traversalBounds(scroller, traversal.order);
      readOnlyTraversals.get(traversal)?.check(true);
      scroller.scrollTop = start;
      dispatch(scroller, new Event('scroll', { bubbles: true }));
      await delay(5, signal);

      const refreshed = traversalContext(context, traversal);
      if (refreshed.scroller !== scroller) continue;
      const refreshedStart = traversalBounds(scroller, traversal.order).start;
      const actualPosition = Number(scroller.scrollTop);
      const currentHeight = Number(scroller.scrollHeight) || 0;
      if (!Number.isFinite(actualPosition) || Math.abs(actualPosition - refreshedStart) > 1) {
        traversal.lastScrollTop = null;
        traversal.lastScrollHeight = currentHeight;
        continue;
      }
      if (currentHeight > previousHeight + 1) traversal.lastSearchGrew = true;
      traversal.lastScrollTop = actualPosition;
      traversal.lastScrollHeight = currentHeight;
      return refreshed;
    }
    traversal.lastSearchIncomplete = true;
    return null;
  }

  async function nextSentRow(
    context,
    signal,
    order = 'newest',
    traversal = createTraversal(order),
    authorizationExpiresAt = null,
  ) {
    traversal.order = order === 'oldest' ? 'oldest' : 'newest';
    traversal.lastSearchGrew = false;
    traversal.lastSearchIncomplete = false;
    traversal.lastSearchSteps = 0;

    let current = traversalContext(context, traversal);
    let scroller = current.scroller;
    const startingHeight = Number(scroller?.scrollHeight) || 0;
    if (traversal.lastScrollHeight && startingHeight + 1 < traversal.lastScrollHeight) {
      // A successful Unsend can shrink the scroll range. Resume from the
      // requested edge instead of retaining an offset outside the new range.
      traversal.lastScrollTop = null;
      if (traversal.order === 'oldest') traversal.oldestBoundaryProven = false;
    }
    traversal.lastScrollHeight = startingHeight;

    if (traversal.order === 'oldest' && !traversal.oldestBoundaryProven) {
      // Instagram can replace or shrink its virtual scroller after a removal.
      // Do not expose another oldest candidate until that new edge has remained
      // stable under the same bounded proof used before the first action.
      let provenContext = null;
      for (let attempt = 0; attempt < MAX_SCAN_PASSES; attempt += 1) {
        provenContext = await proveStableOldestBoundary(
          context,
          traversal,
          signal,
          authorizationExpiresAt,
        );
        const verifiedContext = traversalContext(provenContext, traversal);
        if (traversal.oldestBoundaryProven) {
          current = verifiedContext;
          scroller = verifiedContext.scroller;
          break;
        }
      }
      if (!traversal.oldestBoundaryProven || !provenContext) {
        throw new Error('The oldest conversation boundary changed before the next message could be selected.');
      }
    } else if (!Number.isFinite(traversal.lastScrollTop)) {
      current = await reestablishTraversalEdge(context, traversal, signal);
      if (!current) return null;
      scroller = current.scroller;
    }

    // Scope order outranks viewport convenience. An older visible message must
    // never replace a newer mounted message just because the latter is clipped.
    const [mounted] = orderedCandidates(scroller, traversal.order, traversal);
    if (mounted && await exposeRow(mounted, scroller, signal, traversal)) return mounted;
    if (mounted && readOnlyTraversals.has(traversal)
      && (!mounted.isConnected || traversalContext(context, traversal).scroller !== scroller)) {
      traversal.lastSearchIncomplete = true;
      return null;
    }
    if (mounted) throw new Error('The next message could not be brought into view. Nothing else was selected.');

    for (let pass = 0; pass < MAX_SCAN_PASSES; pass += 1) {
      if (signal.aborted) return null;
      const stop = context.threadId ? sessionStop(context.threadId) : null;
      if (stop) throw new Error(stop);
      current = traversalContext(context, traversal);
      scroller = current.scroller;
      const heightBeforePass = Number(scroller?.scrollHeight) || 0;
      const { start, end, direction } = traversalBounds(scroller, traversal.order);
      const range = Math.abs(end - start);
      // Never jump farther than one third of the mounted viewport. Instagram's
      // virtual list can recycle every row between scroll events; overlapping
      // windows prevent sparse sent messages from falling between coarse steps.
      const viewportStep = Math.floor((Number(scroller?.clientHeight) || 90) / 3);
      const step = range < 500 ? 30 : Math.max(30, Math.min(150, viewportStep));
      let position = pass === 0 && Number.isFinite(traversal.lastScrollTop)
        ? Math.max(Math.min(traversal.lastScrollTop, Math.max(start, end)), Math.min(start, end))
        : start;

      while (traversal.lastSearchSteps < MAX_SCROLL_STEPS_PER_SEARCH) {
        if (signal.aborted) return null;
        readOnlyTraversals.get(traversal)?.check(true);
        const stepStop = context.threadId ? sessionStop(context.threadId) : null;
        if (stepStop) throw new Error(stepStop);
        traversal.lastScrollTop = position;
        scroller.scrollTop = position;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        traversal.lastSearchSteps += 1;
        await delay(5, signal);

        if (readOnlyTraversals.has(traversal)) {
          const refreshed = traversalContext(context, traversal);
          if (refreshed.scroller !== scroller) {
            traversal.lastSearchIncomplete = true;
            return null;
          }
        }

        const [row] = orderedCandidates(scroller, traversal.order, traversal);
        if (row && await exposeRow(row, scroller, signal, traversal)) {
          traversal.lastScrollHeight = Number(scroller?.scrollHeight) || heightBeforePass;
          return row;
        }
        if (row && readOnlyTraversals.has(traversal)
          && (!row.isConnected || traversalContext(context, traversal).scroller !== scroller)) {
          traversal.lastSearchIncomplete = true;
          return null;
        }
        if (row) throw new Error('The next message could not be brought into view. Nothing else was selected.');
        if (position === end) break;
        position = direction > 0
          ? Math.min(end, position + step)
          : Math.max(end, position - step);
      }

      const heightAfterPass = Number(scroller?.scrollHeight) || 0;
      if (heightAfterPass > heightBeforePass + 1) traversal.lastSearchGrew = true;
      if (heightAfterPass + 1 < heightBeforePass) {
        traversal.lastScrollTop = null;
        if (traversal.order === 'oldest') traversal.oldestBoundaryProven = false;
      }
      traversal.lastScrollHeight = heightAfterPass;
      if (traversal.lastSearchSteps >= MAX_SCROLL_STEPS_PER_SEARCH && position !== end) {
        // Resume here on the next bounded search instead of repeatedly scanning
        // only the first 300k pixels of an unusually tall conversation.
        traversal.lastSearchIncomplete = true;
        return null;
      }
      // A new pass begins at the requested edge. This is intentional: the DOM
      // can shrink, grow, or swap nodes after any edge-triggered page load.
      traversal.lastScrollTop = null;
      await delay(30, signal);
    }
    return null;
  }

  function preview(row) {
    const text = [...row.querySelectorAll?.('[dir="auto"]') || []]
      .filter((element) => !element.querySelector?.('[dir="auto"]'))
      .map(visibleText)
      .find(Boolean);
    return (text || 'Sent message').slice(0, 90);
  }

  function retainedMessageSignature(row) {
    const content = [...row?.querySelectorAll?.(
      '[dir="auto"], img, video, audio, a[href], time[datetime], [data-timestamp]',
    ) || []].map((element) => [
      element.tagName || '',
      element.matches?.('[dir="auto"]') ? visibleText(element) : '',
      ...['href', 'src', 'datetime', 'data-timestamp'].map((name) => element.getAttribute?.(name) || ''),
    ]);
    return JSON.stringify([stableMessageKey(row), preview(row), content]);
  }

  function nativeMessageGroups(root) {
    const groups = [...root?.querySelectorAll?.('[role="group"]') || []]
      .filter((group) => group.getAttribute?.('aria-label') !== 'Message actions'
        && group.querySelectorAll?.('[aria-label="Message actions"]').length === 1);
    return groups.filter((group) => !groups.some((other) => (
      other !== group && other.contains?.(group)
    )));
  }

  function nativeRemovalNeighborhood(row, root) {
    const groups = nativeMessageGroups(root);
    const targets = groups.filter((group) => group === row || row?.contains?.(group));
    if (targets.length !== 1) return null;
    return {
      target: targets[0],
      row,
      entries: groups.map((element) => ({ element, signature: retainedMessageSignature(element) })),
    };
  }

  function removalScrollStayed(before) {
    return before.scrollers.every(({ element, top, height, client }) => {
      if (!element.isConnected) return false;
      const afterTop = Number(element.scrollTop) || 0;
      if (Math.abs(afterTop - top) <= 2) return true;
      // At the bottom of a normal list, native scroll anchoring follows a
      // shrinking range. This is not navigation to a different virtual window.
      const afterEnd = Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight));
      const beforeEnd = Math.max(0, height - client);
      return beforeEnd > 0 && Math.abs(top - beforeEnd) <= 2
        && Math.abs(afterTop - afterEnd) <= 2 && afterEnd < beforeEnd;
    });
  }

  function nativeRemovalProven(before) {
    const native = before.native;
    if (!native || native.row.isConnected || native.target.isConnected
      || !before.parent?.isConnected || !removalScrollStayed(before)) return false;
    const targetIndex = native.entries.findIndex(({ element }) => element === native.target);
    const left = native.entries.slice(Math.max(0, targetIndex - 2), targetIndex);
    const right = native.entries.slice(targetIndex + 1, targetIndex + 3);
    const retained = [...left, ...right];
    if (retained.length < 2) return false;
    const after = nativeMessageGroups(before.root);
    let previous = -1;
    for (const { element, signature } of retained) {
      const index = after.indexOf(element);
      if (index <= previous || !element.isConnected
        || retainedMessageSignature(element) !== signature) return false;
      // Backfill may append older history outside this anchored neighborhood,
      // but an inserted/recycled message inside it is not removal evidence.
      if (previous >= 0 && index !== previous + 1) return false;
      previous = index;
    }
    const signature = native.entries[targetIndex].signature;
    // A remount of the same payload inside the anchors is not a removal.
    const first = after.indexOf(retained[0].element);
    const last = after.indexOf(retained[retained.length - 1].element);
    const bounded = after.slice(first, last + 1);
    const countBefore = retained.filter((entry) => entry.signature === signature).length;
    return bounded.filter((element) => retainedMessageSignature(element) === signature).length === countBefore
      && !after.some((element) => !native.entries.some((entry) => entry.element === element)
        && retainedMessageSignature(element) === signature);
  }

  function removalEvidence(row) {
    const parent = row?.parentElement || null;
    const root = row?.closest?.("[data-pagelet='IGDMessagesList']") || parent;
    const scrollers = [];
    for (let element = parent; element; element = element.parentElement) {
      if (Number(element.scrollHeight) > Number(element.clientHeight)) {
        scrollers.push({ element, top: Number(element.scrollTop) || 0,
          height: Number(element.scrollHeight), client: Number(element.clientHeight) });
      }
      if (element === root) break;
    }
    const siblings = [...parent?.children || []].filter((element) => element !== row);
    return {
      key: stableMessageKey(row),
      text: preview(row),
      connected: Boolean(row?.isConnected),
      parent,
      root,
      scrollers,
      siblings,
      siblingSignatures: siblings.map(retainedMessageSignature),
      native: nativeRemovalNeighborhood(row, root),
    };
  }

  function removalProven(row, before) {
    if (!before?.connected) return false;
    const root = before.root;
    if (root && (!root.isConnected || visibleLoader(root) || root.getAttribute?.('aria-busy') === 'true')) return false;
    // Instagram may remove the message and its timestamp together, backfill
    // older rows, and unmount far-off content. Use the exact detached message
    // row and its retained native neighbors, not every layout child.
    const isPlaceholder = (candidate) => {
      const text = normalizePlaceholder(preview(candidate));
      if (normalizePlaceholder(before.text) === text) return false;
      return ['you unsent a message', 'you unsent this message', 'message unsent'].includes(text)
        && !candidate.querySelector?.('img, video, audio, [aria-haspopup="menu"]')
        && !actionButton(candidate);
    };
    if (row?.isConnected) {
      if (stableMessageKey(row) !== before.key) return false;
      return isPlaceholder(row);
    }
    if (!before.key && before.native) return nativeRemovalProven(before);
    if (before.key) {
      const matches = [...root?.querySelectorAll?.('[data-message-id], [data-item-id]') || []]
        .filter((candidate) => stableMessageKey(candidate) === before.key);
      if (matches.length) return matches.length === 1 && isPlaceholder(matches[0]);
    }
    if (!before.parent?.isConnected) return false;
    if (before.scrollers.some(({ element, top }) => (
      !element.isConnected || Math.abs((Number(element.scrollTop) || 0) - top) > 2
    ))) return false;
    if (before.key) return true;
    // Without a logical ID, prove the exact row disappeared while every
    // neighboring message stayed unchanged and in order. Duplicate text and
    // media-only previews do not make a surviving neighbor the removed row.
    const remaining = [...before.parent.children || []];
    return remaining.length === before.siblings.length
      && before.siblings.every((element, index) => element === remaining[index]
        && element.isConnected && element.parentElement === before.parent
        && retainedMessageSignature(element) === before.siblingSignatures?.[index]);
  }

  function normalizePlaceholder(text) {
    return actionLabels.normalizeActionLabel(text).replace(/[.!]$/u, '');
  }

  async function waitForRemoval(row, before, {
    dialogButton = null,
    contextValid = () => true,
    timeoutMs = 5_000,
    stableMs = 350,
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    let stableSince = null;
    while (Date.now() < deadline) {
      if (!contextValid()) return false;
      const dialogClosed = !dialogButton || !dialogButton.isConnected || !isVisible(dialogButton);
      if (dialogClosed && removalProven(row, before)) {
        if (stableSince === null) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return true;
      } else stableSince = null;
      await delay(Math.min(75, Math.max(0, deadline - Date.now())));
    }
    return false;
  }

  function createMessageWalker({
    threadId,
    expiresAt,
    signal = null,
    order = 'newest',
    maxSteps = 18_000,
    timeoutMs = 20 * 60_000,
    holdUntilClosed = false,
  } = {}) {
    const error = (code, message) => Object.assign(new Error(message), { code });
    if (activeController || activeMessageWalker) {
      throw error('DM_WALKER_BUSY', 'Another conversation operation is already active.');
    }
    const startedAt = Date.now();
    if (typeof threadId !== 'string' || !threadId || !['newest', 'oldest'].includes(order)
      || !Number.isFinite(expiresAt) || expiresAt <= startedAt
      || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 250_000
      || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 20 * 60_000
      || typeof holdUntilClosed !== 'boolean'
      || (signal && (typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) {
      throw error('DM_WALKER_INVALID', 'A bounded, exact-conversation message pass is required.');
    }
    if (signal?.aborted) throw error('DM_WALKER_ABORTED', 'The message pass was stopped.');
    const initial = threadContext();
    if (!initial.ok || initial.threadId !== threadId) {
      throw error('DM_WALKER_CONTEXT', initial.reason || 'The conversation changed.');
    }
    const deadline = Math.min(expiresAt, startedAt + timeoutMs);
    const controller = new AbortController();
    const traversal = createTraversal(order);
    const seenKeys = new Set();
    const seenPositions = new Map();
    const seenNodes = new WeakMap();
    let steps = 0, visited = 0, emptyPasses = 0, changingPasses = 0;
    let status = 'ready', reason = null, closed = false, pending = false;
    let deadlineTimer = null, unwatch = () => {};
    const state = () => ({ status, reason, visited, steps,
      coverage: status === 'completed' ? 'exhausted' : visited ? 'partial' : 'unknown' });
    const done = () => ({ done: true, value: undefined, ...state() });
    const finish = (nextStatus, nextReason) => {
      if (closed) return false;
      closed = true; status = nextStatus; reason = nextReason;
      clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', abortExternal);
      controller.signal.removeEventListener('abort', abortInternal);
      unwatch();
      if (!controller.signal.aborted) controller.abort(nextReason);
      if (activeMessageWalker === api && (!holdUntilClosed || nextStatus === 'completed')) activeMessageWalker = null;
      return true;
    };
    const abortExternal = () => controller.abort('DM_WALKER_ABORTED');
    const abortInternal = () => finish('stopped', Date.now() >= deadline
      ? (expiresAt <= Date.now() ? 'DM_WALKER_EXPIRED' : 'DM_WALKER_TIMEOUT')
      : currentThreadId() !== threadId ? 'DM_WALKER_CONTEXT'
        : lifecycleReason(controller.signal) || 'DM_WALKER_ABORTED');
    const check = (step = false) => {
      if (Date.now() >= deadline) {
        throw error(expiresAt <= Date.now() ? 'DM_WALKER_EXPIRED' : 'DM_WALKER_TIMEOUT', 'The message pass expired.');
      }
      const restriction = sessionStop(threadId);
      if (restriction) throw error('DM_WALKER_CONTEXT', restriction);
      if (closed || controller.signal.aborted || signal?.aborted) {
        throw error(reason || 'DM_WALKER_ABORTED', 'The message pass was stopped.');
      }
      if (step && ++steps > maxSteps) throw error('DM_WALKER_LIMIT', 'The bounded message pass reached its traversal limit.');
    };
    const position = (row, scroller) => {
      const top = Number(row.getBoundingClientRect?.()?.top);
      const origin = Number(scroller.getBoundingClientRect?.()?.top);
      const scroll = Number(scroller.scrollTop);
      return Number.isFinite(top) && Number.isFinite(origin) && Number.isFinite(scroll)
        ? Math.round(top - origin + scroll) : null;
    };
    const wasVisited = (row, scroller) => {
      const key = stableMessageKey(row);
      if (key) return seenKeys.has(key);
      const signature = retainedMessageSignature(row);
      const offset = position(row, scroller);
      return offset === null ? seenNodes.get(row) === signature
        : [...seenPositions.get(signature) || []].some((known) => Math.abs(known - offset) <= 2);
    };
    const remember = (row, scroller) => {
      const key = stableMessageKey(row);
      if (key) seenKeys.add(key);
      else {
        const signature = retainedMessageSignature(row), offset = position(row, scroller);
        seenNodes.set(row, signature);
        if (offset !== null) {
          if (!seenPositions.has(signature)) seenPositions.set(signature, new Set());
          seenPositions.get(signature).add(offset);
        }
      }
      visited += 1;
      return key;
    };
    readOnlyTraversals.set(traversal, { check, visited: wasVisited });
    const api = Object.freeze({
      snapshot: state,
      signal: controller.signal,
      assertCurrent: () => { check(); return true; },
      stop: () => {
        if (closed) return false;
        controller.abort('DM_WALKER_ABORTED');
        return true;
      },
      close: () => {
        const held = activeMessageWalker === api;
        const changed = finish('stopped', 'closed');
        if (held) activeMessageWalker = null;
        return held || changed;
      },
      async next() {
        if (pending) throw error('DM_WALKER_BUSY', 'The preceding message read has not settled.');
        if (closed) return done();
        pending = true; status = 'walking';
        try {
          for (;;) {
            check(true);
            const context = threadContext();
            if (!context.ok || context.threadId !== threadId) {
              throw error('DM_WALKER_CONTEXT', context.reason || 'The conversation changed.');
            }
            const row = await nextSentRow(context, controller.signal, order, traversal, deadline);
            check();
            const current = traversalContext(context, traversal);
            if (row && row.isConnected && current.scroller.contains?.(row)) {
              emptyPasses = 0; changingPasses = 0;
              if (wasVisited(row, current.scroller)) continue;
              const key = remember(row, current.scroller);
              status = 'ready';
              return { done: false, value: Object.freeze({ row, key, threadId }) };
            }
            if (row || traversal.lastSearchGrew || traversal.lastSearchIncomplete || visibleLoader(current.root)) {
              emptyPasses = 0;
              if (++changingPasses > MAX_EMPTY_GROWTH_ROUNDS) {
                throw error('DM_WALKER_UNSTABLE', 'The conversation did not reach a stable end.');
              }
            } else if (++emptyPasses >= STABLE_EMPTY_PASSES) {
              finish('completed', 'stable-exhaustion');
              return done();
            }
            await delay(160, controller.signal);
          }
        } catch (failure) {
          finish('error', failure.code || 'DM_WALKER_INTERRUPTED');
          throw failure;
        } finally {
          pending = false;
        }
      },
    });
    activeMessageWalker = api;
    controller.signal.addEventListener('abort', abortInternal, { once: true });
    signal?.addEventListener('abort', abortExternal, { once: true });
    try {
      unwatch = watchThread(controller, threadId);
      deadlineTimer = setTimeout(() => controller.abort('DM_WALKER_TIMEOUT'), Math.max(0, deadline - Date.now()));
      check();
    } catch (failure) {
      finish('error', failure.code || 'DM_WALKER_INTERRUPTED');
      api.close();
      throw failure;
    }
    return api;
  }

  async function inspectAll() {
    if (activeController || activeMessageWalker) {
      return { ready: false, reason: 'Another message check or run is already active.' };
    }
    const context = threadContext();
    if (!context.ok) return { ready: false, reason: context.reason };
    const controller = new AbortController();
    activeController = controller;
    const unwatch = watchThread(controller, context.threadId);
    publish({
      status: 'preparing',
      operation: 'check',
      needsAttention: false,
      interruptionReason: null,
      uncertain: 0,
      processed: 0,
      failed: 0,
      message: 'Checking the full conversation without opening a message menu…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });
    try {
      const history = await loadAllHistory(context, controller.signal);
      const detectedCount = Math.min(MAX_PLAN_MESSAGES, history.detectedCount);
      const result = Object.freeze({
        ready: true,
        threadId: context.threadId,
        detectedCount,
        countExact: false,
        complete: history.complete,
        pagesChecked: history.pagesChecked,
        reason: history.complete
          ? `At least ${detectedCount} sent message${detectedCount === 1 ? '' : 's'} detected. Instagram may keep other messages outside the mounted window.`
          : 'The bounded read-only check ended before the oldest history boundary was proven.',
        checkedAt: new Date().toISOString(),
      });
      publish({
        status: 'reviewed',
        message: result.reason,
        current: null,
        canStop: false,
        finishedAt: result.checkedAt,
      });
      return result;
    } catch (error) {
      const interrupted = lifecycleReason(controller.signal);
      const reason = interrupted
        ? 'Page interrupted. Run Check conversation again when the tab is ready.'
        : error?.name === 'AbortError' || controller.signal.aborted
        ? 'Conversation check stopped.'
        : error.message || 'The conversation could not be checked.';
      publish({
        status: interrupted ? 'needs-attention' : error?.name === 'AbortError' || controller.signal.aborted ? 'stopped' : 'error',
        needsAttention: Boolean(interrupted),
        interruptionReason: interrupted,
        message: reason,
        current: null,
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return { ready: false, reason };
    } finally {
      unwatch();
      if (activeController === controller) activeController = null;
    }
  }

  async function start(options = {}) {
    if (activeMessageWalker) throw Object.assign(new Error('A read-only message pass is already active.'), { code: 'DM_WALKER_BUSY' });
    if (activeController) return snapshot();
    const workerAdapter = options.workerAdapter;
    if (workerAdapter !== undefined && (!workerAdapter
      || typeof workerAdapter.execute !== 'function' || typeof workerAdapter.assertAction !== 'function'
      || typeof workerAdapter.assertContext !== 'function'
      || !workerAdapter.signal || typeof workerAdapter.signal.aborted !== 'boolean'
      || typeof workerAdapter.signal.addEventListener !== 'function'
      || typeof workerAdapter.signal.removeEventListener !== 'function')) {
      publish({ status: 'error', message: 'The reviewed worker adapter is unavailable.', canStop: false });
      return snapshot();
    }
    const plan = validatePlan(options.plan);
    if (!plan) {
      publish({
        status: 'error',
        message: 'A fresh, thread-specific reviewed plan is required before Unsend can start.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }
    if (options.speed !== undefined && options.speed !== plan.speed) {
      publish({ status: 'error', message: 'Refresh the review before changing speed.', canStop: false });
      return snapshot();
    }
    const context = threadContext();
    if (!context.ok) {
      publish({ status: 'error', message: context.reason, canStop: false, finishedAt: new Date().toISOString() });
      return snapshot();
    }
    const expectedThreadId = plan.threadId;
    if (!expectedThreadId || context.threadId !== expectedThreadId) {
      publish({
        status: 'error',
        message: 'Thread-specific live authorization is required before Unsend can start.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }

    const now = Date.now();
    for (const [digest, expiresAt] of consumedPlanDigests) {
      if (expiresAt <= now) consumedPlanDigests.delete(digest);
    }
    if (consumedPlanDigests.has(plan.reviewedDigest)) {
      publish({
        status: 'error',
        message: 'This reviewed Unsend plan was already used.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }
    consumedPlanDigests.set(plan.reviewedDigest, plan.expiresAt);
    while (consumedPlanDigests.size > 128) {
      consumedPlanDigests.delete(consumedPlanDigests.keys().next().value);
    }

    const controller = new AbortController();
    activeController = controller;
    activeExecution = {
      workerAdapter,
      workerRow: null,
      speed: plan.speed,
      onPhaseTiming: typeof options.onPhaseTiming === 'function' ? options.onPhaseTiming : null,
      phaseTimings: {
        historyLoading: 0, messageResolution: 0, menuReadiness: 0,
        confirmationReadiness: 0, verification: 0, pacing: 0, checkpoint: 0,
      },
    };
    const signal = controller.signal;
    const abortWorker = () => controller.abort(workerAdapter.signal.reason || 'Worker stopped');
    workerAdapter?.signal.addEventListener('abort', abortWorker, { once: true });
    if (workerAdapter?.signal.aborted) abortWorker();
    const unwatch = watchThread(controller, expectedThreadId);
    const maxFailures = Math.max(1, Math.min(10, Number(options.maxConsecutiveFailures) || DEFAULT_MAX_FAILURES));
    const authorizationExpiresAt = plan.expiresAt;
    // "all" is intentionally not bound to a virtual-DOM count. This ceiling
    // is only a catastrophic-loop guard, not a daily or user-facing quota.
    const maxMessages = plan.limit === null ? MAX_PLAN_MESSAGES : plan.limit;
    const order = plan.scope === 'oldest' ? 'oldest' : 'newest';
    const traversal = createTraversal(order);
    let processed = 0;
    let failed = 0;
    let retryAttempts = 0;
    let consecutiveFailures = 0;
    let lastUnsendAt = 0;
    let stableEmptyPasses = 0;
    let emptyGrowthRounds = 0;
    let exhausted = false;

    publish({
      status: 'preparing',
      operation: 'unsend',
      needsAttention: false,
      interruptionReason: null,
      uncertain: 0,
      processed: 0,
      failed: 0,
      retryAttempts: 0,
      consecutiveFailures: 0,
      current: null,
      message: 'Finding sent messages…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });

    try {
      let initialContext = traversalContext(context, traversal);
      if (plan.scope === 'oldest') {
        publish({
          status: 'preparing',
          current: null,
          message: 'Finding the oldest message boundary…',
        });
        initialContext = await proveStableOldestBoundary(
          context,
          traversal,
          signal,
          authorizationExpiresAt,
        );
      } else {
        const initialBounds = traversalBounds(initialContext.scroller, order);
        initialContext.scroller.scrollTop = initialBounds.start;
        dispatch(initialContext.scroller, new Event('scroll', { bubbles: true }));
        await delay(80, signal);
      }

      while (!signal.aborted && processed < maxMessages && consecutiveFailures < maxFailures) {
        if (authorizationExpiresAt <= Date.now()) {
          throw new Error('Live authorization expired before the next message.');
        }
        const stop = sessionStop(expectedThreadId);
        if (stop) throw new Error(stop);
        // Instagram can replace the virtualized message scroller while history
        // is loading or after an Unsend. Reacquire it before every message so a
        // detached container cannot turn a real plan into a false zero-item run.
        const currentContext = threadContext();
        if (!currentContext.ok || currentContext.threadId !== expectedThreadId) {
          throw new Error(currentContext.reason || 'The reviewed conversation changed.');
        }
        const row = await measurePhase('historyLoading', () => nextSentRow(
          currentContext,
          signal,
          order,
          traversal,
          authorizationExpiresAt,
        ));
        if (!row) {
          if (traversal.lastSearchGrew || traversal.lastSearchIncomplete) {
            emptyGrowthRounds += 1;
            if (emptyGrowthRounds > MAX_EMPTY_GROWTH_ROUNDS) {
              throw new Error('The conversation kept changing before a stable end could be reached.');
            }
            stableEmptyPasses = 0;
            publish({
              status: 'preparing',
              current: null,
              message: 'Checking newly loaded messages…',
            });
            await delay(120, signal);
            continue;
          }
          stableEmptyPasses += 1;
          if (stableEmptyPasses < STABLE_EMPTY_PASSES) {
            publish({
              status: 'preparing',
              current: null,
              message: 'Checking for more sent messages…',
            });
            await delay(160, signal);
            continue;
          }
          exhausted = true;
          break;
        }
        stableEmptyPasses = 0;
        emptyGrowthRounds = 0;
        const label = preview(row);
        const keyBeforeRemoval = stableMessageKey(row);
        const traversalBeforeRemoval = {
          scroller: currentContext.scroller,
          scrollHeight: Number(currentContext.scroller?.scrollHeight) || 0,
        };
        const elapsed = Date.now() - lastUnsendAt;
        const wait = lastUnsendAt
          ? Math.max(0, randomDelay(options.minDelayMs, options.maxDelayMs) - elapsed)
          : 0;
        if (wait) {
          publish({
            status: 'waiting',
            current: label,
            message: `Waiting ${(wait / 1_000).toFixed(1)}s before the next message…`,
          });
          await measurePhase('pacing', () => delay(wait, signal));
        }
        if (authorizationExpiresAt <= Date.now()) {
          throw new Error('Live authorization expired before the next message.');
        }

        publish({ status: 'running', current: label, message: `Unsending message ${processed + 1}…` });
        let removalVerified = false;
        let workerStopReason = null;
        try {
          // unsendRow already proves the removal: the confirmation dialog
          // closed and the row either went away or lost its content and menu.
          // Re-checking isConnected here rejected every success, because
          // Instagram leaves an "unsent" placeholder row in the thread.
          if (workerAdapter) {
            activeExecution.workerRow = row;
            const result = await workerAdapter.execute({
              candidate: workerCandidate(row),
              threadId: expectedThreadId,
              signal,
              execute: async () => {
                await unsendRow(row, signal, expectedThreadId, authorizationExpiresAt);
                return { verified: true };
              },
            });
            if (result?.verified !== true) {
              const error = new Error('The worker removal outcome is uncertain. Review this conversation.');
              error.code = 'DM_OUTCOME_UNCERTAIN';
              throw error;
            }
            workerStopReason = result.stopReason || null;
          } else {
            await unsendRow(row, signal, expectedThreadId, authorizationExpiresAt);
          }
          removalVerified = true;
        } catch (error) {
          if (workerAdapter || error?.code === 'DM_WORKER_STOP') throw error;
          if (error?.code === 'DM_OUTCOME_UNCERTAIN') throw error;
          if (signal.aborted) throw error;
          retryAttempts += 1;
          consecutiveFailures += 1;
          if (consecutiveFailures >= maxFailures) failed += 1;
          const backoff = Math.min(15_000, 1_000 * (2 ** (consecutiveFailures - 1)));
          publish({
            status: 'waiting',
            failed,
            retryAttempts,
            consecutiveFailures,
            current: label,
            message: consecutiveFailures >= maxFailures
              ? `Could not remove this message after ${consecutiveFailures} attempts.`
              : `Could not remove this message. Retrying in ${Math.round(backoff / 1_000)}s (${consecutiveFailures}/${maxFailures})…`,
          });
          if (consecutiveFailures >= maxFailures) break;
          await delay(backoff, signal);
          continue;
        }
        if (removalVerified) {
          processed += 1;
          consecutiveFailures = 0;
          lastUnsendAt = Date.now();
          markProcessedRow(row, traversal, keyBeforeRemoval);
          const afterRemovalContext = threadContext();
          if (!afterRemovalContext.ok || afterRemovalContext.threadId !== expectedThreadId) {
            throw new Error(afterRemovalContext.reason || 'The reviewed conversation changed.');
          }
          resetTraversalAfterRemoval(traversal, afterRemovalContext.scroller, traversalBeforeRemoval);
          if (typeof options.onVerifiedRemoval === 'function') {
            await measurePhase('checkpoint', () => options.onVerifiedRemoval(Object.freeze({
              processed,
              failed,
              retryAttempts,
              threadId: expectedThreadId,
              reviewedDigest: plan.reviewedDigest,
            })));
          }
          publish({
            status: signal.aborted ? 'stopping' : 'running',
            processed,
            failed,
            retryAttempts,
            consecutiveFailures,
            current: null,
            message: `${processed} message${processed === 1 ? '' : 's'} unsent`,
          });
          if (workerStopReason) controller.abort(workerStopReason);
        }
      }

      if (signal.aborted) {
        publish(interruptionState(signal, processed, failed));
      } else if (consecutiveFailures >= maxFailures) {
        publish({
          status: 'error',
          message: `Stopped after ${consecutiveFailures} consecutive failures. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else if (plan.limit === null && processed >= MAX_PLAN_MESSAGES && !exhausted) {
        publish({
          status: 'error',
          message: `Safety stop after ${processed} verified removals. Start a fresh run to continue.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else {
        const shortfall = plan.limit !== null && processed < plan.limit && exhausted;
        publish({
          status: 'completed',
          message: shortfall
            ? `Done. ${processed} message${processed === 1 ? '' : 's'} unsent; no more sent messages were found.`
            : `Done. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (lifecycleReason(signal)) {
        publish(interruptionState(signal, processed, failed, error?.code === 'DM_OUTCOME_UNCERTAIN'));
      } else if (error?.code !== 'DM_OUTCOME_UNCERTAIN' && (error?.name === 'AbortError' || signal.aborted)) {
        publish(interruptionState(signal, processed, failed));
      } else {
        publish({
          status: 'error',
          uncertain: error?.code === 'DM_OUTCOME_UNCERTAIN' ? 1 : 0,
          message: `${error.message || 'The conversation changed unexpectedly.'} ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      }
    } finally {
      workerAdapter?.signal.removeEventListener('abort', abortWorker);
      unwatch();
      if (activeController === controller) activeController = null;
      activeExecution = null;
      for (const row of document.querySelectorAll(`[${ACTIVE_ATTRIBUTE}]`)) row.removeAttribute(ACTIVE_ATTRIBUTE);
    }
    return snapshot();
  }

  function stop() {
    if (activeMessageWalker) return activeMessageWalker.stop();
    if (!activeController || activeController.signal.aborted) return false;
    publish({ status: 'stopping', message: 'Stopping after the current step…', canStop: false });
    activeController.abort('Stopped by user');
    return true;
  }

  function inspect() {
    const context = threadContext();
    if (!context.ok) return { ready: false, reason: context.reason, visibleSent: 0 };
    return {
      ready: true,
      reason: 'Conversation ready',
      threadId: context.threadId,
      visibleSent: candidateRows(context.scroller).filter(isVisible).length,
      scrollable: context.scroller.scrollHeight > context.scroller.clientHeight + 50,
    };
  }

  const messageProof = Object.freeze({ sentByCurrentUser, removalEvidence, removalProven, waitForRemoval });
  const publicApi = { createPlan, createMessageWalker, inspect, inspectAll, snapshot, start, stop, subscribe, SPEED_PROFILES, messageProof };
  if (globalThis.__instaToolboxTestHooks === true) {
    publicApi.__test = Object.freeze({
      candidateRows,
      createTraversal,
      deepestMessageContainer,
      advanceHistoryProgress,
      actionButton,
      isDmMessageOptionsControl,
      currentThreadId,
      hasMessageContent,
      isVisible,
      markProcessedRow,
      messageFingerprint,
      nextSentRow,
      oldestBoundarySnapshot,
      orderedCandidates,
      proveStableOldestBoundary,
      removalEvidence,
      removalProven,
      waitForRemoval,
      waitForElement,
      delay,
      reversedLayout,
      rowNeedsReposition,
      resetTraversalAfterRemoval,
      reestablishTraversalEdge,
      sentByCurrentUser,
      stableMessageKey,
      traversalBounds,
      validatePlan,
      watchThread,
      requireAuthorization,
      workerCandidate,
    });
  }
  Object.defineProperty(globalThis, 'InstaToolboxDmThreadUnsender', {
    configurable: false,
    enumerable: false,
    value: Object.freeze(publicApi),
    writable: false,
  });
})();
