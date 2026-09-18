import test from 'node:test';
import assert from 'node:assert/strict';
import { registerInboxRuntime } from '../extension/inbox-runtime.js';

function fixture(options = {}) {
  const listeners = new Set(); const stored = {}; const writes = [];
  const url = 'https://www.instagram.com/direct/inbox/';
  const currentTab = { id: 7, url };
  const chrome = {
    runtime: { id: 'extension_fixture', onMessage: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
    tabs: { get: async () => ({ ...currentTab }) },
    storage: { local: { get: async (key) => ({ [key]: structuredClone(stored[key]) }), set: async (patch) => { writes.push(structuredClone(patch)); Object.assign(stored, structuredClone(patch)); } } },
  };
  let evidence = { accountId: 'account_fixture', accountVerified: true, documentId: 'document_fixture', usable: true, threadIds: ['101', '102'], sections: ['primary'], discoveryComplete: false };
  const inspectContext = async () => structuredClone(evidence);
  const config = { chrome, inspectContext, now: () => 1_000, ...options };
  let registration = registerInboxRuntime(config);
  const sender = { id: chrome.runtime.id, frameId: 0, documentId: 'document_fixture', tab: { id: 7 }, url };
  const request = (operation, patch = {}, senderPatch = {}) => new Promise((resolve) => {
    const listener = [...listeners][0];
    const accepted = listener({ kind: `insta-toolbox-inbox-${operation}`, ...patch }, { ...sender, ...senderPatch }, resolve);
    if (!accepted) resolve({ unhandled: true });
  });
  return { chrome, listeners, stored, writes, config, registration, sender, currentTab, request,
    setEvidence: (value) => { evidence = { ...evidence, ...value }; },
    restart: async () => { registration.dispose(); await new Promise((r) => setTimeout(r, 0)); registration = registerInboxRuntime(config); return registration; },
  };
}
const review = { options: { threadIds: ['102', '101'], scope: 'all', speed: 'standard', workerCount: 1 } };

test('registers one namespace handler and accurately reports missing native integration', async () => {
  const f = fixture({ inspectContext: null });
  assert.throws(() => registerInboxRuntime(f.config), /already-registered/);
  const capabilities = await f.request('capabilities');
  assert.equal(capabilities.executionAvailable, false); assert.equal(capabilities.contextAdapterAvailable, false);
  assert.equal((await f.request('review', review)).error, 'inbox-context-adapter-unavailable');
  const listener = [...f.listeners][0];
  assert.equal(listener({ kind: 'unrelated' }, f.sender, () => {}), false);
});

test('rejects untrusted extension, frame, document, tab, and origin senders', async () => {
  const f = fixture();
  for (const sender of [{ id: 'page' }, { frameId: 1 }, { documentId: '' }, { tab: { id: -1 } }, { url: 'https://evil.example/' }]) {
    assert.equal((await f.request('capabilities', {}, sender)).error, 'inbox-sender-rejected');
  }
  assert.equal(f.writes.length, 0);
});

test('metadata review binds trusted discovered inventory and ignores client account or complete claims', async () => {
  const f = fixture();
  const response = await f.request('review', { options: { ...review.options, accountId: 'fake', discovery: { complete: true }, expiresAt: Infinity } });
  assert.equal(response.checkpoint.review.accountId, 'account_fixture');
  assert.equal(response.checkpoint.review.discovery.complete, false);
  assert.deepEqual(response.checkpoint.review.threadIds, ['102', '101']);
  assert.equal(response.checkpoint.status, 'review'); assert.equal(response.executionAvailable, false);
  assert.equal((await f.request('review', { options: { ...review.options, threadIds: ['999'] } })).error, 'thread-not-discovered');
  assert.equal(f.writes.length, 1);
});

test('read checkpoint pause and stop persist metadata without granting execution authority', async () => {
  const f = fixture(); await f.request('review', review);
  assert.equal((await f.request('read')).checkpoint.status, 'review');
  assert.equal((await f.request('pause')).checkpoint.status, 'paused');
  assert.equal((await f.request('checkpoint')).checkpoint.status, 'paused');
  assert.equal((await f.request('stop')).checkpoint.status, 'stopped');
  for (const operation of ['start', 'resume', 'mutate', 'open-workers', 'approve']) assert.equal((await f.request(operation)).error, 'inbox-operation-unavailable');
  assert.equal(JSON.stringify(f.stored).includes('capability'), false);
});

test('service restart restores paused metadata only and never silently replaces an interrupted review', async () => {
  const f = fixture(); await f.request('review', review); await f.restart();
  const restored = await f.request('read');
  assert.equal(restored.checkpoint.status, 'paused'); assert.equal(restored.executionAvailable, false);
  assert.equal((await f.request('review', review)).error, 'existing-review-needs-attention');
  await f.request('stop');
  assert.equal((await f.request('review', review)).checkpoint.status, 'review');
});

test('account switching cannot expose or overwrite the previous account checkpoint', async () => {
  const f = fixture(); await f.request('review', review); f.setEvidence({ accountId: 'other_account' });
  for (const operation of ['read', 'pause', 'stop', 'checkpoint', 'review']) assert.equal((await f.request(operation, review)).error, 'inbox-account-changed');
  assert.equal(f.writes.length, 1);
});

test('current browser URL, document and evidence are revalidated without trusting sender tab payload', async () => {
  const f = fixture(); f.currentTab.url = 'https://www.instagram.com/direct/t/999/';
  assert.equal((await f.request('read')).error, 'inbox-page-unavailable');
  f.currentTab.url = f.sender.url; f.setEvidence({ documentId: 'different-document' });
  assert.equal((await f.request('read')).error, 'inbox-context-unverified');
  f.setEvidence({ documentId: 'document_fixture', rateLimited: true });
  assert.equal((await f.request('read')).error, 'inbox-context-unverified');
});

test('storage failure preserves the previous review and disables further writes for that runtime', async () => {
  const f = fixture(); await f.request('review', review);
  f.chrome.storage.local.set = async () => { throw new Error('disk full'); };
  assert.equal((await f.request('checkpoint')).error, 'inbox-storage-unavailable');
  assert.equal((await f.request('review', review)).error, 'inbox-storage-unavailable');
  assert.equal(f.writes.length, 1);
});

test('hung context inspection times out without writing or opening workers', async () => {
  const f = fixture({ timeoutMs: 5, inspectContext: () => new Promise(() => {}) });
  assert.equal((await f.request('review', review)).error, 'inbox-operation-timeout');
  assert.equal(f.writes.length, 0);
});

test('non-Error adapter failures receive a sanitized response instead of losing the response channel', async () => {
  const f = fixture({ inspectContext: async () => { throw 'private page detail'; } });
  assert.equal((await f.request('read')).error, 'inbox-operation-failed');
  const prefixed = fixture({ inspectContext: async () => { throw new Error('inbox-private-page-detail'); } });
  assert.equal((await prefixed.request('read')).error, 'inbox-operation-failed');
});

test('returned checkpoints are copies and persisted authority cannot be injected through a checkpoint request', async () => {
  const f = fixture(); const response = await f.request('review', review);
  response.checkpoint.review.accountId = 'fake'; response.checkpoint.tasks[0].messageRemovals = 500;
  const saved = await f.request('checkpoint', { checkpoint: response.checkpoint, authority: true });
  assert.equal(saved.checkpoint.review.accountId, 'account_fixture');
  assert.equal(saved.checkpoint.tasks[0].messageRemovals, 0);
});
