import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeInboxDiscovery, nativeInboxSection } from '../extension/inbox-native-navigation.js';

function fixture(options = {}) {
  let account = 'account-1', position = 0, rowClicks = 0, returnClicks = 0, restriction = null, panes = [];
  const events = new Map();
  const addEventListener = (name, callback) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); };
  const removeEventListener = (name, callback) => { events.get(name)?.delete(callback); if (!events.get(name)?.size) events.delete(name); };
  const pages = options.pages || [['101', '102'], ['102', '103']];
  const win = { location: { href: 'https://www.instagram.com/direct/inbox/' }, getComputedStyle: (element) => ({ overflowY: element.overflowY || 'visible' }), addEventListener, removeEventListener };
  const node = (extra) => ({ isConnected: true, closest: () => null, getClientRects: () => [{}], ...extra });
  const createPane = () => {
    const pane = node({ actions: [node({})], busy: false, progress: [],
      getAttribute: (name) => name === 'aria-busy' && pane.busy ? 'true' : null,
      contains: (element) => pane.actions.includes(element),
      querySelectorAll: (selector) => selector === '[aria-label="Message actions"]' ? pane.actions
        : selector === '[aria-busy="true"], [role="progressbar"]' ? pane.progress : [],
    });
    return pane;
  };
  const replacePane = (next = createPane()) => {
    for (const pane of panes) pane.isConnected = false;
    panes = next ? [next] : [];
    return next;
  };
  const scroll = node({ clientHeight: 100, scrollHeight: pages.length * 80 + 20, overflowY: 'auto' });
  Object.defineProperty(scroll, 'scrollTop', { get: () => position, set: (value) => { position = value; } });
  const root = node({ clientHeight: 100, scrollHeight: 100, scrollTop: 0, contains: (element) => Boolean(element?.inRoot), querySelectorAll: (selector) => {
    if (selector === '*') return [scroll];
    return pages[Math.min(pages.length - 1, Math.floor(position / 80))].map((id) => node({
      inRoot: true, tagName: options.linkRows ? 'A' : 'DIV', parentElement: { closest: () => null }, querySelector: () => ({}),
      textContent: options.preview?.(id) || `Conversation ${id} preview`,
      getAttribute: (name) => name === 'href' && options.linkRows ? `/direct/t/${id}/` : null,
      click() { rowClicks += 1; options.onClick?.(id, api); if (!options.noRoute) win.location.href = `https://www.instagram.com/direct/t/${id}/`;
        if (!options.noPane) replacePane(); },
    }));
  } });
  const back = node({ tagName: 'A', getAttribute: () => '/direct/inbox/', click() { returnClicks += 1; win.location.href = 'https://www.instagram.com/direct/inbox/'; position = 0;
    if (!options.keepPaneInInbox) replacePane(null); } });
  const doc = { documentElement: {}, addEventListener, removeEventListener, querySelectorAll(selector) {
    if (selector === '[aria-label="Thread list"]') return [root];
    if (selector === 'a[href]') return options.noReturn ? [] : [back];
    if (selector === '[data-pagelet="IGDMessagesList"]') return panes;
    return [];
  } };
  const api = {
    win, doc, root, scroll, events, createPane, replacePane, get panes() { return panes; },
    setPanes(next) { panes = next; }, changeAccount() { account = 'other'; }, restrict() { restriction = 'rate-limit'; },
    fire(name) { for (const callback of [...events.get(name) || []]) callback(); },
    get rowClicks() { return rowClicks; }, get returnClicks() { return returnClicks; },
    adapter(extra = {}) { return createNativeInboxDiscovery({ accountId: 'account-1', resolveAccount: () => ({ accountId: account, verified: true, restriction }),
      resolveSection: () => 'primary', navigationAcknowledged: true, document: doc, window: win,
      expiresAt: Date.now() + 10_000, routeTimeoutMs: 75, settleMs: 1, ...extra }); },
  };
  return api;
}

test('button rows resolve exact IDs, deduplicate recycled windows, return and remain partial', async () => {
  const f = fixture(), result = await f.adapter().run();
  assert.deepEqual(result.conversations.map((row) => row.threadId), ['101', '102', '103']);
  assert.equal(result.complete, false); assert.equal(result.sections[0].reason, 'end-unverified');
  assert.equal(f.rowClicks, 4); assert.equal(f.returnClicks, 4); assert.equal(result.needsInboxReturn, false);
  assert.deepEqual(Object.keys(result.conversations[0]), ['threadId', 'sections']);
});

test('opening unread conversations requires explicit navigation acknowledgment', async () => {
  const f = fixture(); await assert.rejects(f.adapter({ navigationAcknowledged: false }).run(), /acknowledgment/);
  assert.equal(f.rowClicks, 0);
});

test('unknown section is not silently called primary', async () => {
  const f = fixture(), result = await f.adapter({ resolveSection: null }).run();
  assert.equal(result.reason, 'section-control-unavailable'); assert.equal(f.rowClicks, 0);
});

test('account switch after navigation prevents further clicks and does not save wrong identity', async () => {
  const f = fixture({ onClick: (_id, api) => api.changeAccount() });
  const result = await f.adapter().run();
  assert.equal(result.reason, 'account-changed'); assert.equal(result.conversations.length, 0); assert.equal(f.returnClicks, 0);
});

test('route timeout stops boundedly without guessing IDs', async () => {
  const f = fixture({ noRoute: true }), result = await f.adapter().run();
  assert.equal(result.reason, 'navigation-timeout'); assert.equal(result.conversations.length, 0); assert.equal(f.rowClicks, 1);
});

test('Stop during route wait cancels without return navigation', async () => {
  const f = fixture({ noRoute: true }), adapter = f.adapter({ routeTimeoutMs: 100 });
  const running = adapter.run(); setTimeout(() => adapter.stop(), 5);
  assert.equal((await running).reason, 'cancelled'); assert.equal(f.returnClicks, 0);
});

test('expiry during route wait stops without another action', async () => {
  const f = fixture({ noRoute: true }), result = await f.adapter({ routeTimeoutMs: 100, expiresAt: Date.now() + 10 }).run();
  assert.equal(result.reason, 'discovery-expired'); assert.equal(f.returnClicks, 0);
});

test('missing observed inbox return link retains captured ID with needs-return status', async () => {
  const f = fixture({ noReturn: true }), result = await f.adapter().run();
  assert.equal(result.reason, 'inbox-return-unavailable'); assert.equal(result.needsInboxReturn, true);
  assert.deepEqual(result.conversations.map((row) => row.threadId), ['101']);
});

test('repeated virtualized window is partial, not complete', async () => {
  const f = fixture({ pages: [['101'], ['101'], ['102']] }), result = await f.adapter().run();
  assert.equal(result.sections[0].reason, 'repeated-window-unverified'); assert.equal(result.complete, false);
});

test('unavailable additional section is explicitly unscanned or incomplete', async () => {
  const f = fixture(), result = await f.adapter({ sections: ['primary', 'general', 'requests'] }).run();
  assert.equal(result.sections[1].reason, 'section-control-unavailable');
  assert.equal(result.sections[2].reason, 'not-scanned'); assert.equal(result.complete, false);
});

test('terminal proof must bind exact account and section', async () => {
  const f = fixture(), result = await f.adapter({ proveTerminal: () => ({ kind: 'native-terminal-marker', accountId: 'other', section: 'primary', noPendingLoad: true, stable: true }) }).run();
  assert.equal(result.complete, false);
  const accepted = fixture();
  assert.equal((await accepted.adapter({ proveTerminal: () => ({ kind: 'native-terminal-marker', accountId: 'account-1', section: 'primary', noPendingLoad: true, stable: true }) }).run()).complete, true);
});

test('visit limit preserves inventory and snapshot cannot modify it', async () => {
  const f = fixture(), adapter = f.adapter({ maxVisits: 1 }), result = await adapter.run();
  assert.equal(result.reason, 'visit-limit'); result.conversations[0].sections.push('requests');
  assert.deepEqual(adapter.snapshot().conversations[0].sections, ['primary']);
  await assert.rejects(adapter.run(), /already-started/);
});

test('nested controls, disabled buttons and non-conversation commands are never clicked', async () => {
  const f = fixture({ pages: [['101']] }), original = f.root.querySelectorAll;
  f.root.querySelectorAll = (selector) => selector === '*' ? original(selector) : [
    { isConnected: true, tagName: 'DIV', getAttribute: () => null, querySelector: () => null, click() { assert.fail('command clicked'); } },
    { isConnected: true, tagName: 'DIV', getAttribute: () => 'true', querySelector: () => ({}), click() { assert.fail('disabled clicked'); } },
    { isConnected: true, tagName: 'DIV', querySelector: () => ({}), parentElement: { closest: () => ({ inRoot: true }) }, click() { assert.fail('nested control clicked'); } },
    ...original(selector),
  ];
  const result = await f.adapter().run(); assert.equal(result.visits, 1);
});

test('replaced roots and scrollers are reacquired after every return', async () => {
  const f = fixture(), query = f.doc.querySelectorAll;
  let roots = 0;
  f.doc.querySelectorAll = (selector) => {
    if (selector !== '[aria-label="Thread list"]') return query(selector);
    roots += 1; return [{ ...f.root }];
  };
  const result = await f.adapter().run();
  assert.deepEqual(result.conversations.map((row) => row.threadId), ['101', '102', '103']); assert.ok(roots > 8);
});

test('unexpected navigation never produces an inferred conversation ID', async () => {
  const f = fixture({ noRoute: true, onClick: (_id, api) => { api.win.location.href = 'https://www.instagram.com/accounts/login/'; } });
  const result = await f.adapter().run(); assert.equal(result.reason, 'unexpected-route'); assert.equal(result.conversations.length, 0);
});

test('delayed native route resolves within its deadline without another row click', async () => {
  const f = fixture({ pages: [['101']], noRoute: true, onClick: (id, api) => {
    setTimeout(() => { api.win.location.href = `https://www.instagram.com/direct/t/${id}/`; }, 5);
  } });
  const result = await f.adapter({ routeTimeoutMs: 100 }).run();
  assert.deepEqual(result.conversations.map((row) => row.threadId), ['101']); assert.equal(f.rowClicks, 1);
});

test('external cancellation cleans listeners and performs no later navigation', async () => {
  const f = fixture({ noRoute: true }), controller = new AbortController();
  const active = new Map();
  f.win.addEventListener = (name, listener) => active.set(name, listener);
  f.win.removeEventListener = (name, listener) => { if (active.get(name) === listener) active.delete(name); };
  const running = f.adapter({ signal: controller.signal, routeTimeoutMs: 100 }).run();
  setTimeout(() => controller.abort(), 5);
  assert.equal((await running).reason, 'cancelled'); assert.equal(active.size, 0); assert.equal(f.returnClicks, 0);
});

test('restriction or unverified account rejects navigation before selecting a row', async () => {
  for (const context of [{ accountId: 'account-1', verified: true, restriction: 'rate-limit' }, { accountId: 'account-1', verified: false }]) {
    const f = fixture(), result = await f.adapter({ resolveAccount: () => context }).run();
    assert.equal(result.stopped, true); assert.equal(f.rowClicks, 0);
  }
});

test('Notes list and carousel profile buttons are excluded while sibling conversations resolve', async () => {
  const f = fixture({ pages: [['101']] }), original = f.root.querySelectorAll;
  const noteList = { parentElement: f.root, getAttribute: (name) => name === 'role' ? 'list' : null };
  const carousel = { parentElement: f.root, getAttribute: (name) => name === 'aria-roledescription' ? 'Carousel' : null };
  const note = (container) => ({ isConnected: true, tagName: 'DIV', parentElement: container, querySelector: () => ({}),
    getAttribute: () => null, click() { assert.fail('Notes/profile button clicked'); } });
  f.root.querySelectorAll = (selector) => selector === '*' ? original(selector) : [note(noteList), note(carousel), ...original(selector)];
  const result = await f.adapter().run();
  assert.deepEqual(result.conversations.map((row) => row.threadId), ['101']); assert.equal(result.visits, 1);
});

test('overflowing visible layout is not confused with a real scroll owner', async () => {
  const f = fixture(), original = f.root.querySelectorAll;
  const layout = { isConnected: true, clientHeight: 100, scrollHeight: 900, overflowY: 'visible' };
  f.root.querySelectorAll = (selector) => selector === '*' ? [layout, ...original(selector)] : original(selector);
  const result = await f.adapter().run();
  assert.deepEqual(result.conversations.map((row) => row.threadId), ['101', '102', '103']);
  assert.equal(result.stopped, false);
});

test('unproven overflowing root is not scrolled and reports a specific reason', async () => {
  const f = fixture(); f.root.scrollHeight = 500; f.scroll.overflowY = 'visible';
  const result = await f.adapter().run(); assert.equal(result.reason, 'inbox-scroller-unavailable'); assert.equal(f.rowClicks, 0);
});

test('genuinely multiple vertical scroll owners stay ambiguous', async () => {
  const f = fixture(), original = f.root.querySelectorAll;
  const second = { isConnected: true, clientHeight: 100, scrollHeight: 900, overflowY: 'scroll' };
  f.root.querySelectorAll = (selector) => selector === '*' ? [second, ...original(selector)] : original(selector);
  const result = await f.adapter().run(); assert.equal(result.reason, 'inbox-scroller-ambiguous'); assert.equal(f.rowClicks, 0);
});

test('section resolver must be a function or null', () => {
  const f = fixture();
  for (const resolveSection of ['primary', true, {}]) assert.throws(() => f.adapter({ resolveSection }), /section-adapter-invalid/);
});

test('observer setup failure disconnects the partial observer without another navigation', async () => {
  const f = fixture({ noRoute: true });
  let disconnected = 0;
  f.win.MutationObserver = class {
    observe() { throw new Error('observer-unavailable'); }
    disconnect() { disconnected += 1; }
  };
  const result = await f.adapter({ settleMs: 30 }).run();
  assert.equal(result.reason, 'observer-unavailable');
  assert.equal(disconnected, 1); assert.equal(f.rowClicks, 1); assert.equal(f.returnClicks, 0);
});

test('captured navigation requires a completed inventory and an explicit finite new expiry', async () => {
  const f = fixture(), adapter = f.adapter();
  assert.throws(() => adapter.createNavigator({ expiresAt: Date.now() + 1_000 }), /discovery-required/);
  await adapter.run();
  for (const expiresAt of [undefined, Infinity, NaN, Date.now() - 1, Date.now() + 21 * 60_000]) {
    assert.throws(() => adapter.createNavigator({ expiresAt }), /navigation-expired/);
  }
});

test('captured navigation restores the observed scroll window and verifies the exact resulting route', async () => {
  const f = fixture(), adapter = f.adapter();
  await adapter.run();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const before = f.rowClicks;
  const result = await navigator.navigate('101');
  assert.deepEqual(result, { accountId: 'account-1', threadId: '101', verified: true });
  assert.equal(f.scroll.scrollTop, 0); assert.equal(f.rowClicks, before + 1);
  await navigator.navigate('103');
  assert.equal(f.scroll.scrollTop, 80); assert.match(f.win.location.href, /\/t\/103\/$/);
  assert.equal(f.rowClicks, before + 2);
  const currentClicks = f.rowClicks, currentReturns = f.returnClicks;
  await navigator.navigate('103');
  assert.equal(f.rowClicks, currentClicks); assert.equal(f.returnClicks, currentReturns);
  await assert.rejects(navigator.navigate('999'), /not-discovered/);
  navigator.stop(); assert.equal(f.events.size, 0);
});

test('private row evidence never enters snapshots or progress metadata', async () => {
  const privatePreview = 'Synthetic private preview not for inventory';
  const f = fixture({ pages: [['101']], preview: () => privatePreview }), progress = [];
  const adapter = f.adapter({ onProgress: (value) => progress.push(value) });
  await adapter.run();
  const serialized = JSON.stringify({ snapshot: adapter.snapshot(), progress });
  assert.equal(serialized.includes(privatePreview), false);
  assert.deepEqual(Object.keys(adapter.snapshot().conversations[0]), ['threadId', 'sections']);
});

test('changed previews without an exact native link stop before clicking', async () => {
  const options = { pages: [['101']], preview: () => 'Captured original preview' };
  const f = fixture(options), adapter = f.adapter(); await adapter.run();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const before = f.rowClicks; options.preview = () => 'Newly received preview';
  await assert.rejects(navigator.navigate('101'), /conversation-row-changed/);
  assert.equal(f.rowClicks, before); assert.equal(f.events.size, 0);
});

test('identical captured rows across virtualized windows are ambiguous even when only one is mounted', async () => {
  const options = { pages: [['101'], ['102']], preview: () => 'Duplicate private preview' };
  const f = fixture(options), adapter = f.adapter(); await adapter.run();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const before = f.rowClicks;
  await assert.rejects(navigator.navigate('101'), /conversation-row-ambiguous/);
  assert.equal(f.rowClicks, before); assert.equal(f.events.size, 0);
});

test('observed exact thread links remain usable when their preview changes', async () => {
  const options = { pages: [['101']], linkRows: true, preview: () => 'Before' };
  const f = fixture(options), adapter = f.adapter(); await adapter.run();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  options.preview = () => 'After';
  assert.equal((await navigator.navigate('101')).verified, true);
  navigator.stop();
});

test('wrong resulting routes revoke navigation and never trigger a guessed correction', async () => {
  const options = { pages: [['101']] };
  const f = fixture(options), adapter = f.adapter(); await adapter.run();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  options.noRoute = true;
  options.onClick = (_id, api) => { api.win.location.href = 'https://www.instagram.com/direct/t/999/'; };
  const before = f.rowClicks;
  await assert.rejects(navigator.navigate('101'), /conversation-changed/);
  await assert.rejects(navigator.navigate('101'), /conversation-changed/);
  assert.equal(f.rowClicks, before + 1); assert.equal(f.events.size, 0);
});

test('navigation uses its own finite deadline rather than restoring expired discovery authority', async () => {
  let clock = Date.now();
  const f = fixture({ pages: [['101']] }), adapter = f.adapter({ now: () => clock, expiresAt: clock + 100 });
  // Settling uses elapsed time; discovery needs a moving clock until it completes.
  const ticking = setInterval(() => { clock += 2; }, 1);
  await adapter.run();
  clock += 1_000;
  const navigator = adapter.createNavigator({ expiresAt: clock + 100 });
  assert.equal((await navigator.navigate('101')).verified, true);
  clearInterval(ticking);
  clock += 101;
  const before = f.rowClicks;
  await assert.rejects(navigator.navigate('101'), /navigation-expired/);
  assert.equal(f.rowClicks, before); assert.equal(f.events.size, 0);
});

test('account drift and restriction stop captured navigation before any new click', async () => {
  for (const change of ['changeAccount', 'restrict']) {
    const f = fixture({ pages: [['101']] }), adapter = f.adapter(); await adapter.run();
    const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
    const before = f.rowClicks; f[change]();
    await assert.rejects(navigator.navigate('101'), /account-changed|account-restricted/);
    assert.equal(f.rowClicks, before); assert.equal(f.events.size, 0);
  }
});

test('freeze and pagehide revoke idle navigators; abort cancels a pending route without a second click', async () => {
  for (const event of ['freeze', 'pagehide']) {
    const f = fixture({ pages: [['101']] }), adapter = f.adapter(); await adapter.run();
    const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
    const before = f.rowClicks; f.fire(event);
    await assert.rejects(navigator.navigate('101'), /page-interrupted/);
    assert.equal(f.rowClicks, before); assert.equal(f.events.size, 0);
  }
  const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 100 });
  await adapter.run(); const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  options.noRoute = true;
  const controller = new AbortController();
  const pending = navigator.navigate('101', { signal: controller.signal });
  await assert.rejects(navigator.navigate('101'), /navigation-active/);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.events.size, 0);
});

test('new navigator creation revokes the old instance and leaves one lifecycle owner', async () => {
  const f = fixture({ pages: [['101']] }), adapter = f.adapter(); await adapter.run();
  const old = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const current = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  await assert.rejects(old.navigate('101'), /cancelled/);
  assert.equal((await current.navigate('101')).verified, true);
  current.stop(); assert.equal(f.events.size, 0);
});

test('observed request labels support the native count suffix without accepting arbitrary names', () => {
  for (const value of ['Requests', 'Requests (1)', 'Request (12)']) assert.equal(nativeInboxSection(value), 'requests');
  for (const value of ['Requests from friends', 'Primary (unknown)', 'Inbox']) assert.equal(nativeInboxSection(value), null);
});

test('route-before-pane transition never verifies the previous conversation pane', async () => {
  const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 150 });
  await adapter.run();
  const old = f.replacePane(), navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  options.noPane = true;
  let clicked;
  const nativeClick = new Promise((resolve) => { clicked = resolve; });
  options.onClick = () => clicked();
  let resolved = false;
  const pending = navigator.navigate('101').then((result) => { resolved = true; return result; });
  await nativeClick;
  assert.match(f.win.location.href, /\/t\/101\/$/);
  assert.equal(old.isConnected, true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(resolved, false);
  const replacement = f.replacePane();
  assert.notEqual(replacement, old);
  assert.equal((await pending).verified, true);
  navigator.stop(); assert.equal(f.events.size, 0);
});

test('same-pane recycling without exact native identity is not authorized by the route or new text', async () => {
  const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 40 });
  await adapter.run();
  const old = f.replacePane(); options.noPane = true;
  options.onClick = () => { old.textContent = 'A different conversation'; old.actions = [f.createPane().actions[0]]; };
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  await assert.rejects(navigator.navigate('101'), /conversation-pane-unverified/);
  assert.equal(f.events.size, 0);
});

test('an already-open unverified pane is deliberately re-entered through the native inbox', async () => {
  const f = fixture({ pages: [['101']] }), adapter = f.adapter();
  await adapter.run();
  f.win.location.href = 'https://www.instagram.com/direct/t/101/'; const old = f.replacePane();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 }), before = f.rowClicks, returns = f.returnClicks;
  assert.equal((await navigator.navigate('101')).verified, true);
  assert.equal(f.rowClicks, before + 1); assert.equal(f.returnClicks, returns + 1);
  assert.equal(old.isConnected, false); assert.notEqual(f.panes[0], old);
  navigator.stop(); assert.equal(f.events.size, 0);
});

test('already-open verified panes are reusable, but replacement requires a new native transition', async () => {
  const f = fixture({ pages: [['101']] }), adapter = f.adapter(); await adapter.run();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  await navigator.navigate('101');
  const before = f.rowClicks;
  assert.equal((await navigator.navigate('101')).verified, true);
  assert.equal(f.rowClicks, before);
  f.replacePane();
  assert.equal((await navigator.navigate('101')).verified, true);
  assert.equal(f.rowClicks, before + 1);
  navigator.stop(); assert.equal(f.events.size, 0);
});

test('leaving a verified route invalidates its pane even when the same root later reappears', async () => {
  const f = fixture({ pages: [['101']] }), adapter = f.adapter(); await adapter.run();
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  await navigator.navigate('101');
  f.win.location.href = 'https://www.instagram.com/direct/t/102/'; f.fire('popstate');
  f.win.location.href = 'https://www.instagram.com/direct/t/101/'; f.fire('popstate');
  const before = f.rowClicks;
  assert.equal((await navigator.navigate('101')).verified, true);
  assert.equal(f.rowClicks, before + 1);
  navigator.stop();
});

test('a newly reviewed navigator can resume the same open thread only after native re-entry', async () => {
  const f = fixture({ pages: [['101']] }), adapter = f.adapter(); await adapter.run();
  const previous = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  await previous.navigate('101'); const old = f.panes[0]; previous.stop();
  const resumed = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  const before = f.rowClicks, returns = f.returnClicks;
  assert.equal((await resumed.navigate('101')).verified, true);
  assert.equal(f.rowClicks, before + 1); assert.equal(f.returnClicks, returns + 1);
  assert.equal(old.isConnected, false); assert.notEqual(f.panes[0], old);
  resumed.stop(); assert.equal(f.events.size, 0);
});

test('same-page re-entry still refuses missing return controls and a reused native pane', async () => {
  for (const failure of ['return', 'pane']) {
    const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 75 });
    await adapter.run();
    f.win.location.href = 'https://www.instagram.com/direct/t/101/'; f.replacePane();
    if (failure === 'return') options.noReturn = true;
    else { options.keepPaneInInbox = true; options.noPane = true; }
    const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
    await assert.rejects(navigator.navigate('101'), /inbox-return-unavailable|conversation-pane-unverified/);
    assert.equal(f.events.size, 0);
  }
});

test('new panes must finish native loading before execution readiness resolves', async () => {
  const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 150 });
  await adapter.run(); options.noPane = true;
  const loading = f.createPane(); loading.busy = true;
  let clicked;
  const nativeClick = new Promise((resolve) => { clicked = resolve; });
  options.onClick = () => { f.replacePane(loading); clicked(); };
  const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
  let resolved = false;
  const pending = navigator.navigate('101').then((result) => { resolved = true; return result; });
  await nativeClick; await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(resolved, false);
  loading.busy = false;
  assert.equal((await pending).verified, true); navigator.stop();
});

test('fresh wrappers do not verify transplanted old message controls or still-connected old panes', async () => {
  for (const transplant of [true, false]) {
    const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 40 });
    await adapter.run(); options.noPane = true;
    const old = f.replacePane();
    options.onClick = () => {
      const replacement = f.createPane();
      if (transplant) { replacement.actions = old.actions; f.replacePane(replacement); }
      else { old.getClientRects = () => []; f.setPanes([old, replacement]); }
    };
    const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
    await assert.rejects(navigator.navigate('101'), /conversation-pane-unverified/);
    assert.equal(f.events.size, 0);
  }
});

test('empty skeletons, progress indicators and ambiguous panes cannot verify a conversation', async () => {
  for (const state of ['empty', 'progress', 'multiple']) {
    const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 40 });
    await adapter.run(); options.noPane = true;
    options.onClick = () => {
      const pane = f.createPane();
      if (state === 'empty') pane.actions = [];
      if (state === 'progress') pane.progress = [{ isConnected: true }];
      f.setPanes(state === 'multiple' ? [pane, f.createPane()] : [pane]);
    };
    const navigator = adapter.createNavigator({ expiresAt: Date.now() + 10_000 });
    await assert.rejects(navigator.navigate('101'), /conversation-pane-unverified/);
    assert.equal(f.events.size, 0);
  }
});

test('Stop, freeze and expiry during pane readiness clean up without accepting a later pane', async () => {
  for (const interruption of ['abort', 'freeze', 'expiry']) {
    const options = { pages: [['101']] }, f = fixture(options), adapter = f.adapter({ routeTimeoutMs: 150 });
    await adapter.run(); options.noPane = true;
    const signal = new AbortController();
    const navigator = adapter.createNavigator({ expiresAt: Date.now() + (interruption === 'expiry' ? 30 : 10_000) });
    const pending = navigator.navigate('101', { signal: signal.signal });
    if (interruption === 'abort') setTimeout(() => signal.abort(), 10);
    if (interruption === 'freeze') setTimeout(() => f.fire('freeze'), 10);
    await assert.rejects(pending, /cancelled|page-interrupted|navigation-expired/);
    f.replacePane();
    await assert.rejects(navigator.navigate('101'), /cancelled|page-interrupted|navigation-expired/);
    assert.equal(f.events.size, 0);
  }
});
