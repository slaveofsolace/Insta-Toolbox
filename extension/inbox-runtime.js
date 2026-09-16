import { createInboxCoordinator, createInboxReview } from './inbox-coordinator.js';

const registrations = new WeakMap();
const STORAGE_KEY = 'instaToolboxInboxReviewV1';
const PREFIX = 'insta-toolbox-inbox-';
const OPERATIONS = new Set(['capabilities', 'read', 'review', 'pause', 'stop', 'checkpoint']);
const PUBLIC_ERRORS = new Set([
  'inbox-runtime-disposed', 'inbox-operation-timeout', 'inbox-storage-unavailable',
  'inbox-checkpoint-invalid', 'inbox-context-adapter-unavailable', 'inbox-page-unavailable',
  'inbox-page-changed', 'inbox-context-unverified', 'inbox-sender-rejected',
  'inbox-operation-unavailable', 'inbox-account-changed', 'inbox-review-invalid',
  'thread-not-discovered', 'existing-review-needs-attention',
]);
const copy = (value) => structuredClone(value);
const plain = (value) => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function validSender(sender, extensionId) {
  try {
    return sender?.id === extensionId && Number.isInteger(sender.tab?.id) && sender.tab.id >= 0
      && sender.frameId === 0 && typeof sender.documentId === 'string' && sender.documentId.length > 0
      && new URL(sender.url).origin === 'https://www.instagram.com';
  } catch { return false; }
}

// Registers metadata-only operations. There is deliberately no execution,
// worker-opening, resume-authority, or mutation message in this service.
export function registerInboxRuntime({ chrome, inspectContext = null, now = Date.now, timeoutMs = 15_000 }) {
  if (!chrome?.runtime?.id || !chrome.runtime.onMessage?.addListener || !chrome.runtime.onMessage?.removeListener
    || !chrome.storage?.local?.get || !chrome.storage.local.set || !chrome.tabs?.get
    || (inspectContext !== null && typeof inspectContext !== 'function')
    || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('inbox-runtime-invalid');
  if (registrations.has(chrome.runtime)) throw new Error('inbox-runtime-already-registered');
  let job = null;
  let loaded = false;
  let disposed = false;
  let storageHealthy = true;
  let tail = Promise.resolve();
  const bounded = (work) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('inbox-operation-timeout')), timeoutMs);
    Promise.resolve().then(work).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
  const save = async (checkpoint) => {
    if (disposed) throw new Error('inbox-runtime-disposed');
    if (!storageHealthy) throw new Error('inbox-storage-unavailable');
    try { await bounded(() => chrome.storage.local.set({ [STORAGE_KEY]: { version: 1, checkpoint: copy(checkpoint) } })); }
    catch { storageHealthy = false; throw new Error('inbox-storage-unavailable'); }
  };
  async function load() {
    if (loaded) return;
    const stored = (await bounded(() => chrome.storage.local.get(STORAGE_KEY)))?.[STORAGE_KEY];
    if (stored) {
      if (!plain(stored) || stored.version !== 1 || !plain(stored.checkpoint) || !plain(stored.checkpoint.review)) throw new Error('inbox-checkpoint-invalid');
      job = createInboxCoordinator({ review: stored.checkpoint.review, restored: stored.checkpoint, save, now });
    }
    loaded = true;
  }
  async function context(sender) {
    if (!inspectContext) throw new Error('inbox-context-adapter-unavailable');
    const before = await bounded(() => chrome.tabs.get(sender.tab.id));
    if (before.discarded || before.frozen || before.url !== sender.url || (before.pendingUrl && before.pendingUrl !== sender.url)) throw new Error('inbox-page-unavailable');
    const evidence = await bounded(() => inspectContext({ tabId: sender.tab.id, documentId: sender.documentId, url: sender.url }));
    if (disposed) throw new Error('inbox-runtime-disposed');
    const after = await bounded(() => chrome.tabs.get(sender.tab.id));
    if (after.url !== sender.url || after.discarded || after.frozen
      || (after.pendingUrl && after.pendingUrl !== sender.url)) throw new Error('inbox-page-changed');
    if (!plain(evidence) || evidence.accountVerified !== true || !/^[A-Za-z0-9_-]{1,128}$/.test(evidence.accountId || '')
      || evidence.documentId !== sender.documentId || evidence.usable !== true
      || evidence.challenge || evidence.rateLimited || evidence.actionBlocked || evidence.sessionExpired) throw new Error('inbox-context-unverified');
    return evidence;
  }
  async function handle(request, sender) {
    if (disposed) throw new Error('inbox-runtime-disposed');
    if (!validSender(sender, chrome.runtime.id)) throw new Error('inbox-sender-rejected');
    const operation = request.kind.slice(PREFIX.length);
    if (!OPERATIONS.has(operation)) throw new Error('inbox-operation-unavailable');
    if (operation === 'capabilities') return {
      metadataOperations: ['read', 'review', 'pause', 'stop', 'checkpoint'],
      contextAdapterAvailable: Boolean(inspectContext), executionAvailable: false,
      managedTabsAvailable: false, reason: 'native-inbox-integration-pending',
    };
    if (!storageHealthy) throw new Error('inbox-storage-unavailable');
    const evidence = await context(sender);
    await load();
    if (job && job.snapshot().review.accountId !== evidence.accountId) throw new Error('inbox-account-changed');
    if (operation === 'review') {
      if (!plain(request.options) || !Array.isArray(request.options.threadIds)) throw new Error('inbox-review-invalid');
      const accessible = new Set(Array.isArray(evidence.threadIds) ? evidence.threadIds : []);
      if (!request.options.threadIds.every((threadId) => /^[0-9]{1,128}$/.test(threadId) && accessible.has(threadId))) throw new Error('thread-not-discovered');
      if (job && ['running', 'paused'].includes(job.snapshot().status)) throw new Error('existing-review-needs-attention');
      const review = createInboxReview({
        accountId: evidence.accountId, threadIds: request.options.threadIds,
        scope: request.options.scope, limit: request.options.limit, speed: request.options.speed,
        workerCount: request.options.workerCount, removeOwnReactions: request.options.removeOwnReactions,
        discovery: { sections: evidence.sections || [], complete: evidence.discoveryComplete === true },
      }, now());
      const candidate = createInboxCoordinator({ review, save, now });
      await save(candidate.snapshot()); job = candidate;
      return { checkpoint: job.snapshot(), executionAvailable: false };
    }
    if (!job) return { checkpoint: null, executionAvailable: false };
    if (operation === 'pause' || operation === 'stop') await job.interrupt(operation === 'stop' ? 'stopped' : 'paused', { stop: operation === 'stop' });
    if (operation === 'checkpoint') await save(job.snapshot());
    return { checkpoint: job.snapshot(), executionAvailable: false };
  }
  const listener = (request, sender, sendResponse) => {
    if (typeof request?.kind !== 'string' || !request.kind.startsWith(PREFIX)) return false;
    // Copy the message before awaiting; page-owned objects never enter storage.
    let message, source;
    try { message = copy(request); source = copy(sender); } catch { sendResponse({ error: 'inbox-request-invalid' }); return false; }
    const operation = tail.then(() => handle(message, source));
    tail = operation.catch(() => {});
    operation.then(sendResponse).catch((error) => {
      const message = typeof error?.message === 'string' ? error.message : '';
      sendResponse({ error: PUBLIC_ERRORS.has(message) ? message : 'inbox-operation-failed' });
    });
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  const registration = Object.freeze({
    dispose() {
      disposed = true;
      chrome.runtime.onMessage.removeListener(listener);
      void tail.then(() => { registrations.delete(chrome.runtime); });
    },
  });
  registrations.set(chrome.runtime, registration);
  return registration;
}
