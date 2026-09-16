import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createUserscriptInboxDiscovery } from '../extension/inbox-userscript-discovery.js';

const viewerSource = await readFile(new URL('../extension/instagram-viewer.js', import.meta.url), 'utf8');
const viewerContext = vm.createContext({ URL }); vm.runInContext(viewerSource, viewerContext);
const accountKey = viewerContext.InstaToolboxInstagramViewer.accountKey;

function fixture({ noRoute = false, onNavigate = null, unsupportedSection = false } = {}) {
  let url = new URL('https://www.instagram.com/direct/inbox/'), account = 'fixture.owner', clicks = 0, pane = null;
  const listeners = new Map();
  const window = { get location() { return url; }, getComputedStyle: () => ({ overflowY: 'visible' }),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); } };
  const node = (extra) => ({ isConnected: true, getClientRects: () => [{}], closest: () => null, ...extra });
  const replacePane = (mounted) => {
    if (pane) pane.isConnected = false;
    const actions = [node({})];
    pane = mounted ? node({ getAttribute: () => null, contains: (target) => actions.includes(target),
      querySelectorAll: (selector) => selector === '[aria-label="Message actions"]' ? actions : [] }) : null;
  };
  const section = node({ textContent: 'Primary', getAttribute: (name) => name === 'aria-selected' ? 'true' : null });
  const row = node({ tagName: 'DIV', inRoot: true, parentElement: { closest: () => null },
    textContent: 'Synthetic conversation preview',
    getAttribute: () => null, querySelector: () => ({}), click() {
      clicks += 1; if (!noRoute) { url = new URL('https://www.instagram.com/direct/t/12345/'); replacePane(true); } onNavigate?.(api);
    } });
  const root = node({ clientHeight: 100, scrollHeight: 100, scrollTop: 0,
    contains: (element) => element.inRoot === true,
    querySelectorAll: (selector) => selector === '*' ? []
      : selector === '[role="tab"][aria-selected="true"]' ? unsupportedSection ? [] : [section] : [row] });
  const back = node({ getAttribute: () => '/direct/inbox/', click: () => { url = new URL('https://www.instagram.com/direct/inbox/'); replacePane(false); } });
  const document = { documentElement: {}, querySelectorAll: (selector) => selector === '[aria-label="Thread list"]' ? [root]
    : selector === '[role="tab"]' ? unsupportedSection ? [] : [section] : selector === 'a[href]' ? [back]
      : selector === '[data-pagelet="IGDMessagesList"]' ? pane ? [pane] : [] : [],
    addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const viewer = { accountKey, inspect: () => ({ accountId: account, accountVerified: true,
    accountKey: accountKey(account), identityKind: 'verified-viewer-username', restriction: false }) };
  const progress = [];
  const adapter = createUserscriptInboxDiscovery({ document, window, viewer, routeTimeoutMs: 75,
    settleMs: 1, onProgress: (value) => progress.push(value) });
  const api = { adapter, viewer, progress, listeners, row, get clicks() { return clicks; },
    route: (value) => { url = new URL(value, 'https://www.instagram.com'); },
    rename: () => { account = 'another.owner'; }, fire: (name) => listeners.get(name)?.() };
  return api;
}

test('native same-tab discovery feeds a frozen selected-ID review without execution', async () => {
  const f = fixture();
  const result = await f.adapter.discover({ navigationAcknowledged: true });
  assert.equal(result.status, 'ready'); assert.equal(result.executionAvailable, false);
  assert.equal(result.inventory.complete, false);
  assert.equal(result.inventory.conversations[0].threadId, '12345');
  assert.equal(result.inventory.accountId, accountKey('fixture.owner'));
  const review = f.adapter.review({ threadIds: ['12345'] });
  assert.equal(Object.isFrozen(review), true); assert.equal(Object.isFrozen(review.threadIds), true);
  assert.equal(review.discovery.complete, false); assert.equal(review.workerCount, 1);
  assert.equal(review.speed, 'standard'); assert.equal(review.removeOwnReactions, false);
  assert.deepEqual(review.threadIds, ['12345']);
  assert.ok(f.progress.some((state) => state.inventory?.conversations.length === 1));
  assert.equal(f.listeners.size, 0);
  assert.equal(Object.hasOwn(f.adapter, 'start'), false);
  result.inventory.conversations.length = 0;
  assert.equal(f.adapter.snapshot().inventory.conversations.length, 1);
});

test('discovery requires read-receipt acknowledgment before navigation', async () => {
  const f = fixture();
  await assert.rejects(f.adapter.discover(), /acknowledgment/);
  assert.equal(f.clicks, 0);
});

test('unsupported native sections stay explicit and never default silently to Primary', async () => {
  const f = fixture({ unsupportedSection: true });
  const result = await f.adapter.discover({ navigationAcknowledged: true });
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.reason, 'section-control-unavailable'); assert.equal(f.clicks, 0);
});

test('review cannot introduce an undiscovered thread or survive an account rename', async () => {
  const f = fixture(); await f.adapter.discover({ navigationAcknowledged: true });
  assert.throws(() => f.adapter.review({ threadIds: ['99999'] }), /not-discovered/);
  f.rename(); assert.throws(() => f.adapter.review({ threadIds: ['12345'] }), /account-changed/);
  assert.equal(f.adapter.snapshot().inventory, null);
});

test('account drift during navigation clears collected inventory and stops further clicks', async () => {
  const f = fixture({ onNavigate: (api) => api.rename() });
  await assert.rejects(f.adapter.discover({ navigationAcknowledged: true }), /account-changed/);
  assert.equal(f.clicks, 1); assert.equal(f.adapter.snapshot().inventory, null);
  assert.equal(f.listeners.size, 0);
});

test('concurrent discovery and review are rejected; Stop cancels pending navigation', async () => {
  const f = fixture({ noRoute: true });
  const pending = f.adapter.discover({ navigationAcknowledged: true });
  await assert.rejects(f.adapter.discover({ navigationAcknowledged: true }), /active/);
  assert.throws(() => f.adapter.review({ threadIds: ['12345'] }), /active/);
  assert.equal(f.adapter.stop(), true);
  const result = await pending;
  assert.equal(result.inventory.stopped, true); assert.equal(result.inventory.complete, false);
  assert.equal(f.adapter.stop(), false); assert.equal(f.listeners.size, 0);
});

test('freeze and pagehide revoke discovery without automatic return navigation', async () => {
  for (const event of ['freeze', 'pagehide']) {
    const f = fixture({ onNavigate: (api) => api.fire(event) });
    const result = await f.adapter.discover({ navigationAcknowledged: true });
    assert.equal(result.inventory.stopped, true, event);
    assert.equal(result.inventory.needsInboxReturn, true, event);
    assert.equal(f.clicks, 1, event); assert.equal(f.listeners.size, 0, event);
  }
});

test('copied or mismatched viewer metadata cannot stand in for verified native account proof', async () => {
  for (const field of ['accountVerified', 'accountKey', 'identityKind', 'restriction']) {
    const f = fixture(), original = f.viewer.inspect;
    f.viewer.inspect = () => ({ ...original(), [field]: field === 'restriction' ? true : false });
    await assert.rejects(f.adapter.discover({ navigationAcknowledged: true }), /viewer-unverified|account-restricted/);
    assert.equal(f.clicks, 0, field);
  }
});

test('wrapper exposes captured same-tab navigation separately from cleanup approval', async () => {
  const f = fixture();
  assert.throws(() => f.adapter.createNavigator({ expiresAt: Date.now() + 1_000 }), /discovery-required/);
  await f.adapter.discover({ navigationAcknowledged: true });
  assert.throws(() => f.adapter.createNavigator(), /navigation-expired/);
  const navigator = f.adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const before = f.clicks;
  const result = await navigator.navigate('12345');
  assert.deepEqual(result, { accountId: accountKey('fixture.owner'), threadId: '12345', verified: true });
  assert.equal(f.clicks, before + 1);
  await navigator.navigate('12345');
  assert.equal(f.clicks, before + 1, 'already-current route does not click again');
  assert.equal(f.adapter.snapshot().executionAvailable, false);
  assert.deepEqual(Object.keys(navigator), ['stop', 'navigate']);
  assert.equal(f.adapter.stop(), true); assert.equal(f.listeners.size, 0);
});

test('changed captured row produces needs-attention without disclosing private matching text', async () => {
  const f = fixture(); await f.adapter.discover({ navigationAcknowledged: true });
  const navigator = f.adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const before = f.clicks;
  f.row.textContent = 'Changed private preview';
  await assert.rejects(navigator.navigate('12345'), /conversation-row-changed/);
  assert.equal(f.clicks, before);
  const state = f.adapter.snapshot();
  assert.equal(state.status, 'needs-attention');
  assert.equal(JSON.stringify({ state, progress: f.progress }).includes('private preview'), false);
  assert.equal(f.listeners.size, 0);
});

test('account drift after navigator creation clears inventory and prevents navigation', async () => {
  const f = fixture(); await f.adapter.discover({ navigationAcknowledged: true });
  const navigator = f.adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const before = f.clicks; f.rename();
  await assert.rejects(navigator.navigate('12345'), /account-changed/);
  assert.equal(f.clicks, before); assert.equal(f.adapter.snapshot().inventory, null);
  assert.equal(f.listeners.size, 0);
  assert.throws(() => f.adapter.createNavigator({ expiresAt: Date.now() + 10_000 }), /discovery-required/);
});

test('wrapper navigator is revoked by lifecycle interruption or pre-aborted signal', async () => {
  for (const event of ['freeze', 'pagehide', 'abort']) {
    const f = fixture(); await f.adapter.discover({ navigationAcknowledged: true });
    const navigator = f.adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
    const before = f.clicks, controller = new AbortController();
    if (event === 'abort') controller.abort(); else f.fire(event);
    await assert.rejects(navigator.navigate('12345', { signal: controller.signal }), /page-interrupted|cancelled/);
    assert.equal(f.clicks, before, event); assert.equal(f.listeners.size, 0, event);
  }
});

test('a failed review revokes an existing navigator instead of letting restored metadata revive it', async () => {
  const f = fixture(); await f.adapter.discover({ navigationAcknowledged: true });
  const navigator = f.adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const original = f.viewer.inspect;
  f.viewer.inspect = () => ({ ...original(), restriction: true });
  assert.throws(() => f.adapter.review({ threadIds: ['12345'] }), /account-restricted/);
  f.viewer.inspect = original;
  const before = f.clicks;
  await assert.rejects(navigator.navigate('12345'), /cancelled/);
  assert.equal(f.clicks, before); assert.equal(f.adapter.snapshot().inventory, null);
  assert.equal(f.listeners.size, 0);
});
