import { createNativeInboxDiscovery, nativeInboxSection } from './inbox-native-navigation.js';
import { createInboxReview } from './inbox-coordinator.js';

const ORIGIN = 'https://www.instagram.com';
const visible = (node) => Boolean(node?.isConnected && !node.closest?.('[hidden], [aria-hidden="true"]')
  && node.getClientRects?.().length);
const copy = (value) => structuredClone(value);

// Inventory, review, and captured native navigation never approve cleanup.
export function createUserscriptInboxDiscovery({
  document = globalThis.document, window = globalThis.window,
  viewer = globalThis.InstaToolboxInstagramViewer, now = Date.now, onProgress = null,
  routeTimeoutMs = 8_000, settleMs = 400,
} = {}) {
  if (!document || !window?.location || typeof viewer?.inspect !== 'function'
    || typeof viewer.accountKey !== 'function' || typeof now !== 'function'
    || (onProgress !== null && typeof onProgress !== 'function')) throw new Error('inbox-discovery-unavailable');
  let active = null, inventory = null, captured = null, navigator = null, opening = null;
  let state = { status: 'idle', reason: null, inventory: null, executionAvailable: false };
  const snapshot = () => copy(state);
  const inboxReady = () => /^\/direct\/(?:inbox\/?|t\/\d+\/?)$/.test(window.location.pathname)
    && [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible).length === 1;
  const publish = (patch) => {
    state = { ...state, ...patch };
    try { onProgress?.(snapshot()); } catch {}
    return snapshot();
  };
  function rejectContext(reason) {
    navigator?.stop(); navigator = null; captured = null; inventory = null;
    publish({ status: 'needs-attention', reason, inventory: null });
    throw new Error(reason);
  }
  function context() {
    const evidence = viewer.inspect({ document, location: window.location });
    const key = viewer.accountKey(evidence?.accountId);
    if (evidence?.then || evidence?.accountVerified !== true || !key
      || evidence.accountKey !== key || evidence.identityKind !== 'verified-viewer-username'
      || window.location.origin !== ORIGIN) return rejectContext('inbox-viewer-unverified');
    if (evidence.restriction) return rejectContext('inbox-account-restricted');
    return { accountId: key, verified: true, restriction: null };
  }
  function section() {
    const roots = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
    if (roots.length !== 1) return null;
    const selected = [...roots[0].querySelectorAll('[role="tab"][aria-selected="true"]')].filter(visible);
    if (!selected.length && !roots[0].querySelectorAll('[role="tab"]').length) return 'primary';
    if (selected.length !== 1) return null;
    const label = (selected[0].getAttribute('aria-label') || selected[0].textContent || '').trim();
    return nativeInboxSection(label);
  }
  const stop = () => {
    if (opening) { opening.abort(); return true; }
    if (navigator) { navigator.stop(); navigator = null; return true; }
    if (!active) return false;
    active.stop(); publish({ status: 'stopping', reason: 'cancelled', inventory: active.snapshot() });
    return true;
  };
  return Object.freeze({
    snapshot, stop,
    availableSections() {
      const roots = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
      if (roots.length !== 1) return [];
      const sections = [...new Set([...roots[0].querySelectorAll('[role="tab"]')]
        .filter(visible)
        .map((tab) => nativeInboxSection(tab.getAttribute('aria-label') || tab.textContent))
        .filter(Boolean))];
      return sections.length ? sections : ['primary'];
    },
    reviewLabels() {
      const current = context();
      if (state.inventory && current.accountId !== state.inventory.accountId) return rejectContext('inbox-account-changed');
      return (active || captured)?.reviewLabels() || [];
    },
    async discover({ navigationAcknowledged = false, sections = null, expiresAt = now() + 20 * 60_000 } = {}) {
      if (active || opening) throw new Error('inbox-discovery-active');
      if (navigationAcknowledged !== true) throw new Error('navigation-acknowledgment-required');
      if (!Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt > now() + 20 * 60_000) throw new Error('discovery-expired');
      const identity = context();
      if (!inboxReady()) {
        const links = [...document.querySelectorAll('a[href]')].filter(node => {
          if (!visible(node)) return false;
          try { const target = new URL(node.getAttribute('href'), ORIGIN);
            if (target.origin !== ORIGIN) return false;
            if (/^\/direct\/inbox\/?$/.test(target.pathname)) return true;
            return /^\/direct\/t\/\d+\/?$/.test(target.pathname)
              && (node.getAttribute('aria-label') === 'Messages'
                || node.querySelector('[aria-label="Messages"]')); }
          catch { return false; }
        });
        if (!links.length) throw new Error('inbox-return-unavailable');
        opening = new AbortController();
        publish({ status: 'discovering', reason: null, inventory: null });
        const deadline = now() + routeTimeoutMs;
        try {
          links[0].click();
          while (true) {
            if (opening.signal.aborted) throw new Error('cancelled');
            const observed = viewer.inspect({ document, location: window.location });
            if (observed?.restriction) throw new Error('inbox-account-restricted');
            if (observed?.accountVerified && observed.accountKey !== identity.accountId) throw new Error('inbox-account-changed');
            if (inboxReady() && observed?.accountVerified && observed.accountKey === identity.accountId) break;
            if (now() >= deadline) throw new Error('navigation-timeout');
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (opening.signal.aborted) throw new Error('cancelled');
        } catch (error) {
          publish({ status: 'needs-attention', reason: error.message, inventory: null });
          throw error;
        } finally { opening = null; }
      }
      if (sections === null) sections = this.availableSections();
      navigator?.stop(); navigator = null; captured = null; inventory = null;
      const operation = createNativeInboxDiscovery({
        accountId: identity.accountId, resolveAccount: context,
        navigationAcknowledged, document, window, sections, expiresAt, now,
        routeTimeoutMs, settleMs, resolveSection: section,
        onProgress: (value) => publish({ inventory: value }),
      });
      active = operation;
      const interrupted = () => { operation.stop(); publish({ status: 'stopping', reason: 'page-interrupted' }); };
      document.addEventListener?.('freeze', interrupted);
      window.addEventListener?.('pagehide', interrupted);
      publish({ status: 'discovering', reason: null, inventory: operation.snapshot() });
      try {
        const result = await operation.run();
        const current = context();
        if (current.accountId !== identity.accountId) throw new Error('inbox-account-changed');
        inventory = copy(result);
        captured = operation;
        return publish({ status: result.stopped ? 'needs-attention' : 'ready',
          reason: result.reason, inventory: result });
      } catch (error) {
        captured = null; inventory = null;
        publish({ status: 'needs-attention', reason: error.message, inventory: null });
        throw error;
      } finally {
        document.removeEventListener?.('freeze', interrupted);
        window.removeEventListener?.('pagehide', interrupted);
        if (active === operation) active = null;
      }
    },
    createNavigator({ expiresAt } = {}) {
      if (active) throw new Error('inbox-discovery-active');
      if (!inventory || !captured) throw new Error('inbox-discovery-required');
      const current = context();
      if (current.accountId !== inventory.accountId) {
        navigator?.stop(); navigator = null; captured = null; inventory = null;
        publish({ status: 'needs-attention', reason: 'inbox-account-changed', inventory: null });
        throw new Error('inbox-account-changed');
      }
      const native = captured.createNavigator({ expiresAt });
      navigator?.stop();
      navigator = Object.freeze({
        stop: () => native.stop(),
        async navigate(threadId, options) {
          try { return await native.navigate(threadId, options); }
          catch (error) {
            if (/account-changed|viewer-unverified|origin-changed/.test(error.message)) {
              captured = null; inventory = null;
            }
            publish({ status: 'needs-attention', reason: error.message, inventory });
            throw error;
          }
        },
      });
      return navigator;
    },
    review({ threadIds, scope = 'all', limit = null } = {}) {
      if (active) throw new Error('inbox-discovery-active');
      if (!inventory) throw new Error('inbox-discovery-required');
      const current = context();
      if (current.accountId !== inventory.accountId) {
        return rejectContext('inbox-account-changed');
      }
      const available = new Set(inventory.conversations.map((entry) => entry.threadId));
      if (!Array.isArray(threadIds) || !threadIds.length
        || !threadIds.every((id) => available.has(id))) throw new Error('thread-not-discovered');
      return createInboxReview({ accountId: current.accountId, threadIds, scope, limit,
        speed: 'standard', workerCount: 1, removeOwnReactions: false,
        discovery: { sections: inventory.sections.filter((entry) => entry.samples > 0).map((entry) => entry.section),
          complete: inventory.complete === true },
      }, now());
    },
  });
}
