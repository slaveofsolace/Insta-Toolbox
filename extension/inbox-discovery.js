const ORIGIN = 'https://www.instagram.com';
const SECTIONS = ['primary', 'general', 'requests'];
const validAccount = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function inboxThreadId(href) {
  if (typeof href !== 'string' || href.length > 2_048) return null;
  try {
    const url = new URL(href, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password) return null;
    return /^\/direct\/t\/([0-9]{1,128})\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

// Collects already rendered links. Navigation/scrolling and terminal evidence
// belong to a separately reviewed native-inbox adapter, not this collector.
export function createInboxDiscovery({ accountId, sections = ['primary'], maxThreads = 1_000, maxSamples = 250, proveTerminal = null }) {
  if (!validAccount(accountId)) throw new Error('account-identity-required');
  if (!Array.isArray(sections) || !sections.length || !sections.every((section) => SECTIONS.includes(section))) throw new Error('inbox-section-invalid');
  if (!Number.isSafeInteger(maxThreads) || maxThreads < 1 || maxThreads > 10_000
    || !Number.isSafeInteger(maxSamples) || maxSamples < 1 || maxSamples > 1_000) throw new Error('discovery-bound-invalid');
  if (proveTerminal !== null && typeof proveTerminal !== 'function') throw new Error('terminal-adapter-invalid');
  const sectionNames = [...new Set(sections)];
  const inventory = new Map();
  const sectionState = new Map(sectionNames.map((section) => [section, { section, samples: 0, complete: false, reason: 'not-scanned' }]));
  let stopped = false;
  let stopReason = null;
  const snapshot = () => ({
    version: 1, accountId, complete: !stopped && [...sectionState.values()].every((section) => section.complete),
    stopped, reason: stopReason,
    sections: [...sectionState.values()].map((section) => ({ ...section })),
    conversations: [...inventory.values()].map((conversation) => ({ threadId: conversation.threadId, sections: [...conversation.sections] })),
  });
  function stop(reason) { stopped = true; stopReason = reason; return snapshot(); }
  return Object.freeze({
    snapshot,
    stop: () => stop('stopped'),
    observe({ root, section, observedAccountId, loading = false, signal } = {}) {
      if (stopped) return snapshot();
      if (signal?.aborted) return stop('cancelled');
      if (observedAccountId !== accountId) return stop('account-changed');
      const state = sectionState.get(section);
      if (!state) throw new Error('section-not-requested');
      if (!root || typeof root.querySelectorAll !== 'function' || root.isConnected === false) {
        state.complete = false; state.reason = 'inbox-container-unavailable'; return snapshot();
      }
      if (state.samples >= maxSamples) return stop('sample-limit');
      state.samples += 1;
      state.complete = false;
      state.reason = loading ? 'loading' : 'partial';
      for (const anchor of root.querySelectorAll('a[href]')) {
        if (signal?.aborted) return stop('cancelled');
        if (anchor.isConnected === false || anchor.closest?.('[aria-hidden="true"], [hidden]')) continue;
        const threadId = inboxThreadId(anchor.getAttribute('href'));
        if (!threadId) continue;
        let conversation = inventory.get(threadId);
        if (!conversation) {
          if (inventory.size >= maxThreads) return stop('thread-limit');
          conversation = { threadId, sections: new Set() }; inventory.set(threadId, conversation);
        }
        conversation.sections.add(section);
      }
      // A quiet viewport or repeated last row alone is not exhaustion evidence.
      // No native proof adapter ships with this module, so default is partial.
      if (!loading && proveTerminal) {
        try {
          const proof = proveTerminal({ root, section, accountId, samples: state.samples });
          state.complete = proof?.kind === 'native-terminal-marker'
            && proof.accountId === accountId && proof.section === section
            && proof.noPendingLoad === true && proof.stable === true;
          if (state.complete) state.reason = null;
        } catch { state.reason = 'terminal-proof-unavailable'; }
      }
      if (signal?.aborted) return stop('cancelled');
      return snapshot();
    },
  });
}
