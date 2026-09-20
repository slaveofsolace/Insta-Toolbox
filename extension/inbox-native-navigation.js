import { inboxThreadId } from './inbox-discovery.js';

const ORIGIN = 'https://www.instagram.com';
const SECTION_LABELS = { primary: 'Primary', general: 'General', requests: 'Requests' };
export function nativeInboxSection(value) {
  const label = String(value || '').trim();
  if (/^Requests?(?:\s*\(\d+\))?$/.test(label)) return 'requests';
  return Object.keys(SECTION_LABELS).find((section) => SECTION_LABELS[section] === label) || null;
}
const visible = (node) => node?.isConnected !== false && !node?.closest?.('[hidden], [aria-hidden="true"]')
  && (!node?.getClientRects || node.getClientRects().length > 0);
const inboxUrl = (href) => {
  try { const url = new URL(href, ORIGIN); return url.origin === ORIGIN && !url.username && !url.password && /^\/direct\/inbox\/?$/.test(url.pathname); }
  catch { return false; }
};

// Navigation can mark a conversation read. It never starts a cleanup runner.
export function createNativeInboxDiscovery({
  accountId, resolveAccount, navigationAcknowledged = false,
  document = globalThis.document, window = globalThis.window,
  sections = ['primary'], expiresAt, now = Date.now, signal,
  maxThreads = 1_000, maxSamples = 1_000, maxVisits = 20_000,
  routeTimeoutMs = 8_000, settleMs = 400, paginationTimeoutMs = routeTimeoutMs,
  proveTerminal = null, resolveSection = null, onProgress = null,
} = {}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId || '') || typeof resolveAccount !== 'function') throw new Error('account-identity-required');
  if (!Array.isArray(sections) || !sections.length || sections.some((name) => !Object.hasOwn(SECTION_LABELS, name))) throw new Error('inbox-section-invalid');
  for (const [value, ceiling] of [[maxThreads, 10_000], [maxSamples, 1_000], [maxVisits, 20_000], [routeTimeoutMs, 30_000], [paginationTimeoutMs, 30_000], [settleMs, 5_000]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error('discovery-bound-invalid');
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error('discovery-expired');
  if (proveTerminal !== null && typeof proveTerminal !== 'function') throw new Error('terminal-adapter-invalid');
  if (resolveSection !== null && typeof resolveSection !== 'function') throw new Error('section-adapter-invalid');
  if (onProgress !== null && typeof onProgress !== 'function') throw new Error('progress-adapter-invalid');
  const sectionState = [...new Set(sections)].map((section) => ({ section, samples: 0, complete: false, reason: 'not-scanned' }));
  const inventory = new Map();
  // Native row evidence is private to this instance; snapshots never retain it.
  const navigationEvidence = new Map();
  const displayLabels = new Map();
  const controller = new AbortController();
  const discoveryContext = { expiresAt, signal, controller, expiryReason: 'discovery-expired' };
  let started = false, finished = false, stopped = false, reason = null, visits = 0;
  let navigator = null;
  const href = () => String(window.location.href);
  const inboxSurface = () => (inboxUrl(href()) || Boolean(inboxThreadId(href())))
    && [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible).length === 1;
  const snapshot = () => ({
    version: 1, accountId, complete: !stopped && sectionState.every((state) => state.complete),
    stopped, reason, visits, needsInboxReturn: !inboxSurface(),
    sections: sectionState.map((state) => ({ ...state })),
    conversations: [...inventory].map(([threadId, names]) => ({ threadId, sections: [...names] })),
  });
  const publish = () => { try { onProgress?.(snapshot()); } catch {} };
  function guard(context = discoveryContext) {
    if (context.controller.signal.aborted || context.signal?.aborted) throw new Error(context.stopReason || 'cancelled');
    if (now() >= context.expiresAt) throw new Error(context.expiryReason);
    if (new URL(href()).origin !== ORIGIN) { displayLabels.clear(); throw new Error('origin-changed'); }
    // A synchronous isolated-world resolver prevents a hung identity lookup
    // from retaining navigation authority. Page storage is not an authority.
    const identity = resolveAccount();
    if (identity?.then || identity?.verified !== true || identity.accountId !== accountId) {
      displayLabels.clear(); throw new Error('account-changed');
    }
    if (identity.restriction) throw new Error('account-restricted');
  }
  function waitFor(check, timeout = routeTimeoutMs, context = discoveryContext) {
    return new Promise((resolve, reject) => {
      let timer, poll, observer, settled = false;
      const timeoutDeadline = now() + timeout;
      const deadline = Math.min(timeoutDeadline, context.expiresAt);
      const deadlineReason = context.expiresAt <= timeoutDeadline
        ? context.expiryReason
        : 'navigation-timeout';
      const finish = (error, value) => {
        if (settled) return; settled = true;
        clearTimeout(timer); clearInterval(poll); observer?.disconnect();
        window.removeEventListener?.('popstate', inspect); window.removeEventListener?.('hashchange', inspect);
        context.signal?.removeEventListener('abort', inspect); context.controller.signal.removeEventListener('abort', inspect);
        error ? reject(error) : resolve(value);
      };
      function inspect() {
        if (settled) return;
        try {
          guard(context);
          if (now() >= deadline) return finish(new Error(deadlineReason));
          const result = check(); if (result) finish(null, result);
        }
        catch (error) { finish(error); }
      }
      try {
        inspect(); if (settled) return;
        if (window.MutationObserver) { observer = new window.MutationObserver(inspect); observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true }); }
        window.addEventListener?.('popstate', inspect); window.addEventListener?.('hashchange', inspect);
        context.signal?.addEventListener('abort', inspect, { once: true }); context.controller.signal.addEventListener('abort', inspect, { once: true });
        poll = setInterval(inspect, Math.min(50, Math.max(1, Math.floor(timeout / 4))));
        timer = setTimeout(() => { inspect(); if (!settled) finish(new Error(deadlineReason)); }, Math.max(0, deadline - now()));
        inspect();
      } catch (error) { finish(error); }
    });
  }
  const settle = async (context = discoveryContext) => {
    const until = now() + settleMs;
    await waitFor(() => now() >= until, settleMs + 100, context);
  };
  function listRoot() {
    const roots = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
    if (roots.length !== 1) throw new Error('inbox-container-unavailable');
    return roots[0];
  }
  function messagePanes() {
    return [...document.querySelectorAll('[data-pagelet="IGDMessagesList"]')];
  }
  function readyMessagePane() {
    const panes = messagePanes().filter(visible);
    if (panes.length !== 1) return null;
    const pane = panes[0];
    if (pane.getAttribute?.('aria-busy') === 'true'
      || pane.closest?.('[aria-busy="true"]')
      || [...pane.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible)) return null;
    const actions = [...pane.querySelectorAll('[aria-label="Message actions"]')].filter(visible);
    // No observed native empty-state marker binds an empty pane to a thread.
    // A shell or skeleton alone cannot authorize the message runner.
    return actions.length ? { pane, actions } : null;
  }
  async function freshMessagePane(threadId, priorPanes, priorActions, context = discoveryContext, timeout = routeTimeoutMs) {
    let candidate = null, stableSince = null;
    return waitFor(() => {
      const actual = inboxThreadId(href());
      if (actual && actual !== threadId) throw new Error('conversation-changed');
      if (!actual && !inboxUrl(href())) throw new Error('unexpected-route');
      const ready = actual === threadId ? readyMessagePane() : null;
      if (!ready || priorPanes.includes(ready.pane)
        || priorPanes.some((pane) => pane.isConnected !== false)
        || priorActions.some((action) => ready.pane.contains(action))) {
        candidate = null; stableSince = null; return false;
      }
      if (candidate?.pane !== ready.pane || candidate.actions.length !== ready.actions.length
        || candidate.actions.some((action, index) => action !== ready.actions[index])) {
        candidate = ready; stableSince = now(); return false;
      }
      return now() - stableSince >= settleMs ? ready : false;
    }, timeout, context);
  }
  function nativeDisplayLabel(pane, priorHeaders) {
    // The observed header and composer are sibling branches of one chat.
    // A heading elsewhere in main, the inbox rail or a message is not a title.
    for (let parent = pane.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth += 1) {
      const branches = [...(parent.children || [])];
      if (branches.length !== 2) continue;
      const header = branches.find((node) => node.getAttribute?.('data-pagelet') === 'IGDInboxHeaderOffMsys');
      const content = branches.find((node) => node !== header && node.contains?.(pane));
      if (!header || !content || !visible(header)) continue;
      if (priorHeaders.includes(header) || header.closest?.('[aria-busy="true"]')
        || header.getAttribute?.('aria-busy') === 'true'
        || [...header.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible)) return null;
      if (parent.querySelectorAll('[data-pagelet="IGDMessagesList"]').length !== 1
        || parent.querySelectorAll('[aria-label="Thread list"]').length
        || [...content.querySelectorAll('[data-pagelet="IGDComposerForCannes"]')].filter(visible).length !== 1) return null;
      const headings = [...header.querySelectorAll('h2')].filter(visible);
      if (headings.length !== 1) return null;
      const title = String(headings[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length > 160 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(title)) return null;
      const links = [...header.querySelectorAll('a[role="link"][href]')].filter((node) => visible(node)
        && String(node.getAttribute('aria-label') || '').startsWith('Open the profile page of '));
      let username = null;
      if (links.length === 1 && links[0].contains(headings[0])) {
        try {
          const url = new URL(links[0].getAttribute('href'), ORIGIN);
          const match = /^\/([a-zA-Z0-9._]{1,30})\/?$/.exec(url.pathname);
          if (url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && match
            && !['accounts', 'direct', 'explore', 'reels', 'stories', 'p', 'reel', 'about', 'legal'].includes(match[1].toLowerCase())) {
            username = match[1].toLowerCase();
          }
        } catch {}
      }
      return Object.freeze({ title, username, kind: username ? 'profile' : 'chat-title', source: 'native-conversation-header' });
    }
    return null;
  }
  function auxiliaryCollection(node, root) {
    // Notes occupy a separate native role=list inside Thread list. Avatar
    // images alone do not distinguish those profile buttons from threads.
    for (let current = node; current && current !== root; current = current.parentElement) {
      if (current.getAttribute?.('role') === 'list'
        || current.getAttribute?.('aria-roledescription')?.trim().toLowerCase() === 'carousel') return true;
    }
    return false;
  }
  function rows(root) {
    return [...root.querySelectorAll('[role="button"], a[href]')].filter((row) => {
      if (!visible(row) || auxiliaryCollection(row, root)) return false;
      if (row.getAttribute?.('aria-disabled') === 'true' || row.disabled) return false;
      if (row.tagName === 'A' && !inboxThreadId(row.getAttribute('href'))) return false;
      if (row.tagName !== 'A' && !row.querySelector?.('img')) return false;
      const parentRow = row.parentElement?.closest?.('[role="button"], a[href]');
      return !parentRow || !root.contains(parentRow);
    });
  }
  function scroller(root) {
    const candidates = [root, ...root.querySelectorAll('*')].filter((node) => {
      if (!visible(node) || auxiliaryCollection(node, root) || node.clientHeight <= 0 || node.scrollHeight <= node.clientHeight + 1) return false;
      const overflow = window.getComputedStyle?.(node)?.overflowY;
      return /^(auto|scroll|overlay)$/.test(overflow || '');
    });
    // Multiple scroll owners cannot be selected safely by size alone.
    if (candidates.length > 1) throw new Error('inbox-scroller-ambiguous');
    if (candidates.length) return candidates[0];
    if (root.scrollHeight > root.clientHeight + 1) throw new Error('inbox-scroller-unavailable');
    return root;
  }
  function fingerprint(row) {
    const text = String(row.textContent || '').replace(/\s+/g, ' ').trim();
    const label = String(row.getAttribute?.('aria-label') || '').trim();
    const images = [...(row.querySelectorAll?.('img[alt]') || [])].map((image) => image.getAttribute('alt') || '');
    if (!text && !label && !images.some(Boolean)) return null;
    const value = JSON.stringify([text, label, images]);
    return value.length <= 8_192 ? value : null;
  }
  async function selectSection(section, context = discoveryContext) {
    guard(context);
    const tabs = [...document.querySelectorAll('[role="tab"]')].filter(visible);
    const matches = tabs.filter((tab) => nativeInboxSection(tab.getAttribute('aria-label') || tab.textContent) === section);
    if (!matches.length && resolveSection?.() === section) return;
    if (matches.length !== 1) throw new Error('section-control-unavailable');
    if (matches[0].getAttribute('aria-selected') !== 'true') {
      matches[0].click();
      await waitFor(() => [...document.querySelectorAll('[role="tab"]')].some((tab) => visible(tab)
        && nativeInboxSection(tab.getAttribute('aria-label') || tab.textContent) === section
        && tab.getAttribute('aria-selected') === 'true'), routeTimeoutMs, context);
    }
    await settle(context);
  }
  async function returnToInbox(threadId, position, section, context = discoveryContext, retainList = false) {
    guard(context);
    if (inboxThreadId(href()) !== threadId) throw new Error('conversation-changed');
    const links = [...document.querySelectorAll('a[href]')].filter((node) => visible(node) && inboxUrl(node.getAttribute('href')));
    if (!links.length) {
      if (!retainList || !inboxSurface()) throw new Error('inbox-return-unavailable');
    } else {
      links[0].click();
      await waitFor(() => inboxUrl(href()) && [...document.querySelectorAll('[aria-label="Thread list"]')].some(visible), routeTimeoutMs, context);
    }
    await selectSection(section, context);
    const scroll = scroller(listRoot()); scroll.scrollTop = position;
    await settle(context);
  }
  async function scan(state) {
    await selectSection(state.section);
    let priorWindow = null;
    for (; state.samples < maxSamples;) {
      guard(); if (!inboxSurface()) throw new Error('inbox-route-changed');
      state.samples += 1; state.reason = 'partial';
      const root = listRoot(), scroll = scroller(root), position = scroll.scrollTop || 0;
      const count = rows(root).length, windowIds = [], deferredRows = [];
      for (let turn = 0; turn < count + deferredRows.length; turn += 1) {
        const index = turn < count ? turn : deferredRows[turn - count];
        guard(); if (!inboxSurface()) throw new Error('inbox-route-changed');
        if (visits >= maxVisits) throw new Error('visit-limit');
        const currentRoot = listRoot(), row = rows(currentRoot)[index];
        if (!row || !currentRoot.contains(row)) throw new Error('inbox-window-changed');
        const previous = row.tagName === 'A' ? inboxThreadId(row.getAttribute('href')) : null;
        if (previous && inventory.has(previous)) { windowIds.push(previous); continue; }
        // The position is only used to observe a row. Resulting route IDs,
        // never row positions or preview text, identify conversations.
        const evidence = { row, fingerprint: fingerprint(row), href: row.tagName === 'A' ? row.getAttribute('href') : null,
          section: state.section, position };
        const priorPanes = messagePanes();
        const priorActions = priorPanes.flatMap((pane) => [...pane.querySelectorAll('[aria-label="Message actions"]')]);
        const priorHeaders = [...document.querySelectorAll('[data-pagelet="IGDInboxHeaderOffMsys"]')];
        const priorThread = inboxThreadId(href());
        // The desktop inbox remains visible alongside an open conversation.
        // A selected row may not change the URL. Revisit it after another row
        // instead of attributing the previous URL to the row just clicked.
        visits += 1; row.click();
        let threadId;
        try {
          threadId = await waitFor(() => {
            const id = inboxThreadId(href());
            if (!id && !inboxUrl(href())) throw new Error('unexpected-route');
            return id && id !== priorThread ? id : false;
          });
        } catch (error) {
          if (error.message !== 'navigation-timeout' || !priorThread || !inboxSurface()) throw error;
          if (turn < count && count > 1) deferredRows.push(index);
          if (inventory.has(priorThread)) windowIds.push(priorThread);
          continue;
        }
        if (evidence.href && inboxThreadId(evidence.href) !== threadId) throw new Error('conversation-changed');
        if (!inventory.has(threadId)) {
          if (inventory.size >= maxThreads) throw new Error('thread-limit');
          inventory.set(threadId, new Set());
        }
        inventory.get(threadId).add(state.section);
        const captures = navigationEvidence.get(threadId) || new Map();
        captures.set(state.section, evidence); navigationEvidence.set(threadId, captures);
        try {
          const ready = await freshMessagePane(threadId, priorPanes, priorActions, discoveryContext, Math.min(routeTimeoutMs, 1_500));
          const label = nativeDisplayLabel(ready.pane, priorHeaders);
          if (label) displayLabels.set(threadId, label); else displayLabels.delete(threadId);
        } catch (error) {
          displayLabels.delete(threadId);
          if (error.message !== 'navigation-timeout') throw error;
        }
        windowIds.push(threadId); publish();
        await returnToInbox(threadId, position, state.section, discoveryContext, true);
      }
      guard();
      const nextRoot = listRoot();
      if (proveTerminal) {
        const proof = proveTerminal({ root: nextRoot, accountId, section: state.section, samples: state.samples });
        if (proof?.kind === 'native-terminal-marker' && proof.accountId === accountId && proof.section === state.section && proof.noPendingLoad === true && proof.stable === true) {
          state.complete = true; state.reason = null; return;
        }
      }
      const signature = windowIds.join(',');
      const repeated = signature === priorWindow;
      priorWindow = signature;
      const next = scroller(nextRoot), end = Math.max(0, next.scrollHeight - next.clientHeight);
      const destination = Math.min(end, (next.scrollTop || 0) + Math.max(1, Math.floor(next.clientHeight * 0.8)));
      if (destination <= (next.scrollTop || 0)) {
        const height = next.scrollHeight;
        const mounted = rows(nextRoot).map(fingerprint).join('\n');
        // Reaching the bottom triggers pagination; it is not itself the end.
        // Keep the rail there while its next page loads and reacquire recycled
        // containers. Only stop after a bounded quiet wait with no new window.
        try {
          await waitFor(() => {
            const root = listRoot(), scroll = scroller(root);
            return scroll.scrollHeight !== height || rows(root).map(fingerprint).join('\n') !== mounted;
          }, paginationTimeoutMs);
          priorWindow = null;
          continue;
        } catch (error) {
          if (error.message !== 'navigation-timeout') throw error;
          state.reason = repeated ? 'repeated-window-unverified' : 'end-unverified';
          return;
        }
      }
      next.scrollTop = destination; await settle();
    }
    state.reason = 'sample-limit';
  }
  function createNavigator({ expiresAt: navigationExpiresAt } = {}) {
    if (!finished || !inventory.size) throw new Error('inbox-discovery-required');
    if (!Number.isFinite(navigationExpiresAt) || navigationExpiresAt <= now()
      || navigationExpiresAt > now() + 20 * 60_000) throw new Error('navigation-expired');
    navigator?.stop();
    const context = { expiresAt: navigationExpiresAt, controller: new AbortController(),
      expiryReason: 'navigation-expired', signal: null, stopReason: null };
    guard(context);
    let active = false, verifiedPane = null, paneObserver = null;
    const invalidatePane = () => {
      if (!verifiedPane) return;
      const current = messagePanes().filter(visible);
      if (inboxThreadId(href()) !== verifiedPane.threadId || current.length !== 1
        || current[0] !== verifiedPane.pane) verifiedPane = null;
    };
    const stop = (stopReason = 'cancelled') => {
      context.stopReason = stopReason; context.controller.abort();
      verifiedPane = null; paneObserver?.disconnect();
      clearTimeout(expiryTimer);
      document.removeEventListener?.('freeze', interrupted);
      window.removeEventListener?.('pagehide', interrupted);
      window.removeEventListener?.('popstate', invalidatePane);
      window.removeEventListener?.('hashchange', invalidatePane);
    };
    const interrupted = () => stop('page-interrupted');
    const expiryTimer = setTimeout(() => stop('navigation-expired'), Math.max(0, navigationExpiresAt - now()));
    expiryTimer.unref?.();
    document.addEventListener?.('freeze', interrupted);
    window.addEventListener?.('pagehide', interrupted);
    window.addEventListener?.('popstate', invalidatePane);
    window.addEventListener?.('hashchange', invalidatePane);
    try {
      if (window.MutationObserver) {
        paneObserver = new window.MutationObserver(invalidatePane);
        paneObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      }
    } catch (error) { stop('conversation-pane-observer-unavailable'); throw error; }
    navigator = Object.freeze({
      stop: () => stop(),
      async navigate(threadId, { signal: navigationSignal } = {}) {
        if (active) throw new Error('inbox-navigation-active');
        if (!inventory.has(threadId)) throw new Error('thread-not-discovered');
        active = true; context.signal = navigationSignal;
        try {
          guard(context);
          invalidatePane();
          const currentPane = readyMessagePane();
          const reusablePane = verifiedPane?.threadId === threadId
            && currentPane?.pane === verifiedPane.pane && inboxThreadId(href()) === threadId;
          if (!reusablePane) {
            // A fresh reviewed run cannot inherit an older navigator's pane
            // proof. Re-enter through the native inbox even if its URL is open.
            verifiedPane = null;
            const evidence = [...navigationEvidence.get(threadId).values()][0];
            const current = inboxThreadId(href());
            if (current) await returnToInbox(current, evidence.position, evidence.section, context);
            else if (!inboxUrl(href())) throw new Error('inbox-route-changed');
            else {
              await selectSection(evidence.section, context);
              scroller(listRoot()).scrollTop = evidence.position;
              await settle(context);
            }
            guard(context);
            if (!inboxUrl(href())) throw new Error('inbox-route-changed');
            const currentRows = rows(listRoot());
            const exactLinks = currentRows.filter((row) => row.tagName === 'A'
              && inboxThreadId(row.getAttribute('href')) === threadId);
            if (!exactLinks.length && evidence.fingerprint) {
              const capturedIds = [...navigationEvidence].filter(([, captures]) => [...captures.values()]
                .some((capture) => capture.fingerprint === evidence.fingerprint)).map(([id]) => id);
              if (capturedIds.length !== 1 || capturedIds[0] !== threadId) throw new Error('conversation-row-ambiguous');
            }
            const matches = exactLinks.length ? exactLinks : currentRows.filter((row) => evidence.fingerprint
              && fingerprint(row) === evidence.fingerprint);
            if (matches.length !== 1) throw new Error(matches.length ? 'conversation-row-ambiguous' : 'conversation-row-changed');
            const row = matches[0];
            if (row.tagName === 'A' && inboxThreadId(row.getAttribute('href')) !== threadId) throw new Error('conversation-row-changed');
            // Capture every mounted pane, including hidden cached ones. A URL
            // transition can precede React replacing the previous chat.
            const priorPanes = messagePanes();
            const priorActions = priorPanes.flatMap((pane) => [...pane.querySelectorAll('[aria-label="Message actions"]')]);
            guard(context); row.click();
            try {
              const ready = await freshMessagePane(threadId, priorPanes, priorActions, context);
              verifiedPane = { pane: ready.pane, threadId };
            } catch (error) {
              if (error.message === 'navigation-timeout' && inboxThreadId(href()) === threadId) {
                throw new Error('conversation-pane-unverified');
              }
              throw error;
            }
          }
          guard(context);
          if (inboxThreadId(href()) !== threadId) throw new Error('conversation-changed');
          invalidatePane();
          const ready = readyMessagePane();
          if (!verifiedPane || verifiedPane.threadId !== threadId || ready?.pane !== verifiedPane.pane) {
            throw new Error('conversation-pane-unverified');
          }
          return Object.freeze({ accountId, threadId, verified: true });
        } catch (error) {
          stop(error.message);
          throw error;
        } finally { active = false; context.signal = null; }
      },
    });
    return navigator;
  }
  return Object.freeze({
    snapshot, createNavigator,
    reviewLabels() {
      try {
        const identity = resolveAccount();
        if (controller.signal.aborted || new URL(href()).origin !== ORIGIN || identity?.then
          || identity?.verified !== true || identity.accountId !== accountId) displayLabels.clear();
      } catch { displayLabels.clear(); }
      return [...displayLabels].map(([threadId, label]) => ({ threadId, ...label }));
    },
    stop() { stopped = true; reason = 'cancelled'; displayLabels.clear(); controller.abort(); navigator?.stop(); return snapshot(); },
    async run() {
      if (started) throw new Error('discovery-already-started');
      started = true;
      if (navigationAcknowledged !== true) throw new Error('navigation-acknowledgment-required');
      try {
        guard(); if (!inboxSurface()) throw new Error('inbox-route-required');
        for (const state of sectionState) {
          try { await scan(state); }
          catch (error) { state.reason = error.message; throw error; }
          publish();
        }
      } catch (error) { stopped = true; reason = error.message; }
      finished = true;
      publish(); return snapshot();
    },
  });
}
