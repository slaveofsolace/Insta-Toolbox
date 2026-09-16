import { createInboxReview } from './inbox-coordinator.js';

const origin = 'https://www.instagram.com';
const urlFor = (threadId) => `${origin}/direct/t/${threadId}/`;
function exactThread(url, threadId) {
  try {
    const value = new URL(url);
    return value.origin === origin && !value.username && !value.password
      && value.pathname.replace(/\/$/, '') === `/direct/t/${threadId}`;
  } catch { return false; }
}

// Readiness and tab ownership only. A ready worker still needs a separate,
// short-lived coordinator grant immediately before each native mutation.
export function createManagedInboxTabs({ review, tabs, extensionId, inspectWorker, now = Date.now, nonce = () => crypto.randomUUID(), timeoutMs = 15_000 }) {
  const plan = createInboxReview(review, review.reviewedAt ?? now());
  if (!plan.threadIds.every((id) => /^[0-9]{1,128}$/.test(id))) throw new Error('native-thread-identity-required');
  if (!extensionId || typeof inspectWorker !== 'function' || typeof nonce !== 'function'
    || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000
    || ['create', 'get', 'update', 'remove'].some((method) => typeof tabs?.[method] !== 'function')) throw new Error('tab-adapter-invalid');
  const owned = new Set();
  const slots = Array.from({ length: plan.workerCount }, (_, index) => ({ index, tabId: null, threadId: null, generation: 0, challenge: null, handle: null, phase: 'idle' }));
  let status = 'idle';
  let reason = null;
  let stopped = false;
  let tail = Promise.resolve();
  const serial = (callback) => {
    const result = tail.then(callback); tail = result.catch(() => {}); return result;
  };
  const snapshot = () => ({ status, reason, workers: slots.map(({ index, tabId, threadId, phase }) => ({ index, tabId, threadId, phase })) });
  const bounded = (operation) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker-response-timeout')), timeoutMs);
    Promise.resolve().then(operation).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
  function pause(why) {
    if (!stopped) status = 'paused';
    reason = why;
    for (const slot of slots) { slot.generation += 1; slot.challenge = null; slot.handle = null; if (slot.tabId !== null) slot.phase = 'needs-attention'; }
    throw new Error(why);
  }
  function runnable() {
    if (stopped) throw new Error('pool-stopped');
    if (now() >= plan.expiresAt) pause('approval-expired');
    if (status === 'paused') throw new Error(reason || 'pool-paused');
  }
  async function existing(slot) {
    let tab;
    try { tab = await bounded(() => tabs.get(slot.tabId)); }
    catch (error) { pause(error.message === 'worker-response-timeout' ? error.message : 'worker-closed'); }
    if (!tab || tab.id !== slot.tabId || !owned.has(tab.id)) pause('worker-ownership-lost');
    if (tab.discarded) pause('worker-discarded');
    if (tab.frozen) pause('worker-frozen');
    if (!exactThread(tab.url, slot.threadId) || (tab.pendingUrl && !exactThread(tab.pendingUrl, slot.threadId))) pause('worker-thread-changed');
    return tab;
  }
  async function inspect(slot, documentId) {
    let evidence;
    try { evidence = await bounded(() => inspectWorker({ tabId: slot.tabId, documentId, threadId: slot.threadId })); }
    catch { pause('worker-evidence-unavailable'); }
    runnable();
    if (evidence?.accountId !== plan.accountId) pause('account-changed');
    if (evidence.threadId !== slot.threadId || evidence.documentId !== documentId
      || evidence.usable !== true || evidence.sessionExpired || evidence.challenge
      || evidence.rateLimited || evidence.actionBlocked) pause('worker-evidence-unavailable');
    return evidence;
  }
  return Object.freeze({
    snapshot,
    prepare: (workerIndex, threadId) => serial(async () => {
      runnable();
      const slot = slots[workerIndex];
      const position = plan.threadIds.indexOf(threadId);
      const group = Math.min(plan.workerCount - 1, Math.floor(position / Math.ceil(plan.threadIds.length / plan.workerCount)));
      if (!Number.isInteger(workerIndex) || !slot || position < 0 || group !== workerIndex) throw new Error('thread-not-assigned');
      if (!['idle', 'released'].includes(slot.phase)) throw new Error('worker-not-released');
      if (slots.some((other) => other !== slot && other.threadId === threadId)) throw new Error('duplicate-thread');
      slot.threadId = threadId; slot.generation += 1; slot.handle = null; slot.challenge = nonce(); slot.phase = 'opening';
      if (typeof slot.challenge !== 'string' || slot.challenge.length < 16) pause('worker-challenge-invalid');
      try {
        if (slot.tabId === null) {
          await bounded(async () => {
            const tab = await tabs.create({ url: urlFor(threadId), active: false });
            if (!Number.isInteger(tab?.id) || owned.has(tab.id)) throw new Error('created-tab-invalid');
            slot.tabId = tab.id; owned.add(tab.id);
            // A timed-out browser request can still create its tab later.
            // Retain ownership and close that exact late result, not other tabs.
            if (stopped || status === 'paused') {
              try { await tabs.remove(tab.id); owned.delete(tab.id); slot.phase = 'closed'; }
              catch { slot.phase = 'close-failed'; reason = 'worker-close-failed'; }
            }
          });
        } else {
          if (!owned.has(slot.tabId)) pause('worker-ownership-lost');
          await bounded(() => tabs.update(slot.tabId, { url: urlFor(threadId) }));
        }
      } catch (error) {
        if (status === 'paused') throw error;
        pause('worker-navigation-failed');
      }
      runnable(); status = 'running'; slot.phase = 'awaiting-handshake';
      return Object.freeze({ workerIndex, tabId: slot.tabId, threadId, challenge: slot.challenge });
    }),
    handshake: (sender, challenge) => serial(async () => {
      runnable();
      const slot = slots.find((candidate) => candidate.tabId === sender?.tab?.id);
      if (!slot || !owned.has(slot.tabId) || sender.id !== extensionId || sender.frameId !== 0
        || typeof sender.documentId !== 'string' || !sender.documentId
        || slot.phase !== 'awaiting-handshake' || challenge !== slot.challenge
        || !exactThread(sender.url, slot.threadId)) throw new Error('worker-handshake-rejected');
      await existing(slot); await inspect(slot, sender.documentId); await existing(slot); runnable();
      slot.challenge = null; slot.phase = 'ready';
      slot.handle = Object.freeze({ workerIndex: slot.index, tabId: slot.tabId, threadId: slot.threadId, documentId: sender.documentId, generation: slot.generation });
      return slot.handle;
    }),
    check: (handle) => serial(async () => {
      runnable();
      const slot = slots[handle?.workerIndex];
      if (!slot || slot.handle !== handle || slot.generation !== handle.generation) throw new Error('stale-worker');
      await existing(slot); await inspect(slot, handle.documentId); await existing(slot); runnable();
      return { ready: true, threadId: slot.threadId };
    }),
    release: (handle) => serial(async () => {
      runnable();
      const slot = slots[handle?.workerIndex];
      if (!slot || slot.handle !== handle) throw new Error('stale-worker');
      slot.handle = null; slot.threadId = null; slot.phase = 'released'; slot.generation += 1;
      return snapshot();
    }),
    close: () => {
      stopped = true; status = 'stopped'; reason = 'stopped';
      for (const slot of slots) { slot.challenge = null; slot.handle = null; slot.generation += 1; }
      return serial(async () => {
        for (const tabId of [...owned]) {
          try { await bounded(() => tabs.remove(tabId)); owned.delete(tabId); }
          catch {
            try { await bounded(() => tabs.get(tabId)); }
            catch (error) { if (error.message !== 'worker-response-timeout') owned.delete(tabId); }
          }
        }
        for (const slot of slots) slot.phase = owned.has(slot.tabId) ? 'close-failed' : 'closed';
        if (owned.size) reason = 'worker-close-failed';
        return snapshot();
      });
    },
  });
}
