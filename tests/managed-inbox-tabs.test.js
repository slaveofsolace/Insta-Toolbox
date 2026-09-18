import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxReview } from '../extension/inbox-coordinator.js';
import { createManagedInboxTabs } from '../extension/managed-inbox-tabs.js';

function fixture(patch = {}) {
  const accountId = 'account_fixture';
  let time = 1_000, id = 100, nonce = 0;
  const current = new Map([[9, { id: 9, url: 'https://www.instagram.com/direct/t/999/', active: true }]]);
  const calls = [];
  const tabs = {
    create: async (options) => { const tab = { id: ++id, ...options }; current.set(tab.id, tab); calls.push(['create', options]); return tab; },
    get: async (tabId) => { if (!current.has(tabId)) throw new Error('closed'); return current.get(tabId); },
    update: async (tabId, options) => { if (!current.has(tabId)) throw new Error('closed'); Object.assign(current.get(tabId), options); calls.push(['update', tabId, options]); return current.get(tabId); },
    remove: async (tabId) => { calls.push(['remove', tabId]); current.delete(tabId); },
  };
  const review = createInboxReview({ accountId, threadIds: ['101', '102', '103', '104'], workerCount: 2 }, time);
  const inspectWorker = async ({ documentId, threadId }) => ({ accountId, documentId, threadId, usable: true });
  const pool = createManagedInboxTabs({ review, tabs, extensionId: 'extension_fixture', inspectWorker, now: () => time, nonce: () => `memory-challenge-${++nonce}`, ...patch });
  const sender = (prepared, extra = {}) => ({ id: 'extension_fixture', frameId: 0, documentId: `document-${prepared.tabId}`, tab: { id: prepared.tabId }, url: `https://www.instagram.com/direct/t/${prepared.threadId}/`, ...extra });
  return { pool, calls, current, tabs, review, sender, advance: (ms) => { time += ms; } };
}

test('bounded worker pool creates inactive tabs and reuses only assigned conversations', async () => {
  const f = fixture(); const a = await f.pool.prepare(0, '101'); const b = await f.pool.prepare(1, '103');
  assert.equal(f.calls.filter(([method]) => method === 'create').length, 2);
  assert.equal(f.current.get(a.tabId).active, false); assert.equal(f.current.get(b.tabId).active, false);
  await assert.rejects(f.pool.prepare(0, '103'), /thread-not-assigned/);
  await assert.rejects(f.pool.prepare(2, '104'), /thread-not-assigned/);
  await assert.rejects(f.pool.prepare(0, '102'), /worker-not-released/);
  const handle = await f.pool.handshake(f.sender(a), a.challenge); await f.pool.release(handle);
  const next = await f.pool.prepare(0, '102'); assert.equal(next.tabId, a.tabId);
  assert.deepEqual(f.calls.find(([method]) => method === 'update')[2], { url: 'https://www.instagram.com/direct/t/102/' });
  assert.ok(f.calls.every(([, options]) => options?.active !== true));
});

test('handshake uses browser sender identity and rejects copied, wrong-document, iframe and page claims', async () => {
  const f = fixture(); const a = await f.pool.prepare(0, '101');
  for (const patch of [{ id: 'other' }, { frameId: 1 }, { documentId: '' }, { tab: { id: 9 } }, { url: 'https://www.instagram.com/direct/t/102/' }]) {
    await assert.rejects(f.pool.handshake(f.sender(a, patch), a.challenge), /handshake-rejected/);
  }
  await assert.rejects(f.pool.handshake(f.sender(a), 'wrong-challenge'), /handshake-rejected/);
  const handle = await f.pool.handshake(f.sender(a), a.challenge);
  await assert.rejects(f.pool.handshake(f.sender(a), a.challenge), /handshake-rejected/);
  await assert.rejects(f.pool.check({ ...handle }), /stale-worker/);
  assert.equal((await f.pool.check(handle)).ready, true);
});

test('account proof comes from trusted inspection rather than handshake payload', async () => {
  const f = fixture({ inspectWorker: async ({ documentId, threadId }) => ({ accountId: 'different', documentId, threadId, usable: true }) });
  const a = await f.pool.prepare(0, '101');
  await assert.rejects(f.pool.handshake(f.sender(a, { accountId: 'account_fixture' }), a.challenge), /account-changed/);
  assert.equal(f.pool.snapshot().status, 'paused');
});

test('inactive workers remain ready but discarded, frozen, closed, or navigated workers pause', async () => {
  for (const [change, reason] of [[{ discarded: true }, 'discarded'], [{ frozen: true }, 'frozen'], [null, 'closed'], [{ url: 'https://www.instagram.com/direct/t/555/' }, 'thread-changed']]) {
    const f = fixture(); const a = await f.pool.prepare(0, '101'); const handle = await f.pool.handshake(f.sender(a), a.challenge);
    assert.equal((await f.pool.check(handle)).ready, true);
    if (change) Object.assign(f.current.get(a.tabId), change); else f.current.delete(a.tabId);
    await assert.rejects(f.pool.check(handle), new RegExp(reason));
    assert.equal(f.pool.snapshot().status, 'paused');
  }
});

test('document mismatch and restriction evidence pause readiness', async () => {
  for (const extra of [{ documentId: 'replaced-document' }, { usable: false }, { rateLimited: true }, { challenge: true }, { actionBlocked: true }, { sessionExpired: true }]) {
    const f = fixture({ inspectWorker: async ({ documentId, threadId }) => ({ accountId: 'account_fixture', documentId, threadId, usable: true, ...extra }) });
    const a = await f.pool.prepare(0, '101');
    await assert.rejects(f.pool.handshake(f.sender(a), a.challenge), /evidence-unavailable/);
  }
});

test('only created tabs are closed and shutdown never implies cleanup completion', async () => {
  const f = fixture(); const a = await f.pool.prepare(0, '101'); await f.pool.prepare(1, '103');
  const state = await f.pool.close();
  assert.equal(f.current.has(9), true); assert.equal(f.current.has(a.tabId), false);
  assert.equal(state.status, 'stopped'); assert.equal(state.workers.every((slot) => slot.phase === 'closed'), true);
  assert.ok(f.calls.filter(([method]) => method === 'remove').every(([, tabId]) => tabId !== 9));
  await assert.rejects(f.pool.prepare(0, '102'), /pool-stopped/);
});

test('close failure is visible and snapshots cannot mutate the owned set or readiness', async () => {
  const f = fixture(); const a = await f.pool.prepare(0, '101');
  const state = f.pool.snapshot(); state.workers[0].tabId = 9; state.status = 'completed';
  f.tabs.remove = async () => { throw new Error('busy'); };
  const stopped = await f.pool.close();
  assert.equal(stopped.reason, 'worker-close-failed'); assert.equal(stopped.workers[0].phase, 'close-failed');
  assert.equal(f.current.has(a.tabId), true); assert.equal(f.current.has(9), true);
});

test('expiry after background delay invalidates a ready handle', async () => {
  const f = fixture(); const a = await f.pool.prepare(0, '101'); const handle = await f.pool.handshake(f.sender(a), a.challenge);
  f.advance(20 * 60 * 1_000);
  await assert.rejects(f.pool.check(handle), /approval-expired/);
  assert.equal(f.pool.snapshot().status, 'paused');
});

test('hung worker inspection is bounded and pauses instead of manufacturing readiness', async () => {
  const f = fixture({ timeoutMs: 5, inspectWorker: () => new Promise(() => {}) });
  const a = await f.pool.prepare(0, '101');
  await assert.rejects(f.pool.handshake(f.sender(a), a.challenge), /evidence-unavailable/);
  assert.equal(f.pool.snapshot().status, 'paused');
});

test('late tab creation after a timeout closes only the newly created tab', async () => {
  const f = fixture({ timeoutMs: 5 }); let resolve;
  f.tabs.create = () => new Promise((finish) => { resolve = finish; });
  await assert.rejects(f.pool.prepare(0, '101'), /navigation-failed/);
  f.current.set(200, { id: 200, url: 'https://www.instagram.com/direct/t/101/' });
  resolve({ id: 200 });
  await new Promise((finish) => setTimeout(finish, 0));
  assert.equal(f.current.has(200), false); assert.equal(f.current.has(9), true);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'remove'), [['remove', 200]]);
});

test('batch assignment uses reviewed thread positions rather than contiguous groups', async () => {
  const review = createInboxReview({ accountId: 'account_fixture', threadIds: ['104', '102', '101', '103'],
    workerCount: 2, assignmentMode: 'batches' }, 1_000);
  const f = fixture({ review });
  const first = await f.pool.prepare(0, '104');
  const second = await f.pool.prepare(1, '102');
  await assert.rejects(f.pool.prepare(0, '102'), /thread-not-assigned/);
  await assert.rejects(f.pool.prepare(1, '101'), /thread-not-assigned/);
  await f.pool.release(await f.pool.handshake(f.sender(first), first.challenge));
  await f.pool.release(await f.pool.handshake(f.sender(second), second.challenge));
  assert.equal((await f.pool.prepare(0, '101')).tabId, first.tabId);
  assert.equal((await f.pool.prepare(1, '103')).tabId, second.tabId);
  assert.equal(f.calls.filter(([method]) => method === 'create').length, 2);
});

test('elapsed readiness deadline rejects a late result even before a throttled timeout callback runs', async () => {
  let f;
  f = fixture({ timeoutMs: 10, inspectWorker: async ({ documentId, threadId }) => {
    f.advance(10);
    return { accountId: 'account_fixture', documentId, threadId, usable: true };
  } });
  const prepared = await f.pool.prepare(0, '101');
  await assert.rejects(f.pool.handshake(f.sender(prepared), prepared.challenge), /worker-evidence-unavailable/);
  assert.equal(f.pool.snapshot().status, 'paused');
  assert.equal(f.pool.snapshot().workers[0].phase, 'needs-attention');
  await assert.rejects(f.pool.handshake(f.sender(prepared), prepared.challenge), /worker-evidence-unavailable/);
});

test('late timed-out inspection acknowledgment cannot restore a worker handle', async () => {
  let resolveInspection;
  const f = fixture({ timeoutMs: 5, inspectWorker: ({ documentId, threadId }) => new Promise((resolve) => {
    resolveInspection = () => resolve({ accountId: 'account_fixture', documentId, threadId, usable: true });
  }) });
  const prepared = await f.pool.prepare(0, '101');
  await assert.rejects(f.pool.handshake(f.sender(prepared), prepared.challenge), /worker-evidence-unavailable/);
  resolveInspection(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.pool.snapshot().status, 'paused');
  assert.equal(f.pool.snapshot().workers[0].phase, 'needs-attention');
});
