import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { mountUserscriptInboxPanel } from '../extension/inbox-userscript-panel.js';
import { createInboxCoordinator } from '../extension/inbox-coordinator.js';
import { createSingleTabInboxReview } from '../extension/inbox-single-tab.js';

const viewerSource = await readFile(new URL('../extension/instagram-viewer.js', import.meta.url), 'utf8');
const viewerContext = vm.createContext({ URL });
vm.runInContext(viewerSource, viewerContext);
const accountKey = viewerContext.InstaToolboxInstagramViewer.accountKey;
const deferred = () => {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
};

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument;
    this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.isConnected = true; this.hidden = false; this.disabled = false; this.checked = false;
    this.clientHeight = 0; this.scrollHeight = 0; this.scrollTop = 0; this._text = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set value(value) { this._value = value; }
  get value() { return this._value ?? (this.tagName === 'SELECT' ? this.children[0]?.value : ''); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; this.append(...nodes); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  matches(selector) {
    if (selector === '*') return true;
    if (selector === 'a[href]') return this.tagName === 'A' && this.getAttribute('href') !== null;
    if (selector === '[role="button"]') return this.getAttribute('role') === 'button';
    if (selector === '[role="tab"]') return this.getAttribute('role') === 'tab';
    if (selector === '[role="tab"][aria-selected="true"]') return this.getAttribute('role') === 'tab' && this.getAttribute('aria-selected') === 'true';
    if (selector === 'img') return this.tagName === 'IMG';
    if (selector === 'img[alt]') return this.tagName === 'IMG' && this.getAttribute('alt') !== null;
    if (selector === '[hidden]') return this.hidden;
    if (selector === '[aria-hidden="true"]') return this.getAttribute('aria-hidden') === 'true';
    const attribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (attribute) return this.getAttribute(attribute[1]) === attribute[2];
    return false;
  }
  querySelectorAll(selector) { return this.all().filter(node => selector.split(',').some(part => node.matches(part.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.split(',').some(part => node.matches(part.trim()))) return node;
    }
    return null;
  }
  getClientRects() { return this.hidden ? [] : [{}]; }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  async fire(name) { for (const listener of [...this.listeners.get(name) || []]) await listener({ target: this }); }
  async click() { if (!this.disabled && !this.hidden) await this.fire('click'); }
  focus() { this.ownerDocument.activeElement = this; }
}

function fixture(options = {}) {
  let url = new URL('https://www.instagram.com/direct/inbox/');
  const lifecycle = new Map(), lockNames = new Set();
  const confirmations = [], checkpoints = [], saveAttempts = [], starts = [], dispatches = [], navigation = [], statuses = [];
  const document = {
    createElement: tag => new Element(tag, document),
    createTextNode(text) { const node = new Element('#text', document); node.textContent = text; return node; },
    addEventListener(name, callback) { if (!lifecycle.has(name)) lifecycle.set(name, new Set()); lifecycle.get(name).add(callback); },
    removeEventListener(name, callback) { lifecycle.get(name)?.delete(callback); },
  };
  const root = document.createElement('div'); root.setAttribute('aria-label', 'Thread list');
  root.clientHeight = 300; root.scrollHeight = 300;
  const nativeSurface = document.createElement('main'); nativeSurface.append(root);
  let messagePane = null;
  const replaceMessagePane = (threadId) => {
    if (messagePane) {
      for (const node of [messagePane, ...messagePane.all()]) node.isConnected = false;
      nativeSurface.children = nativeSurface.children.filter(node => node !== messagePane);
      messagePane.parentElement = null;
      messagePane = null;
    }
    if (threadId === null) return;
    messagePane = document.createElement('div'); messagePane.setAttribute('data-pagelet', 'IGDMessagesList');
    const group = document.createElement('div'); group.setAttribute('role', 'group');
    const actions = document.createElement('div'); actions.setAttribute('aria-label', 'Message actions');
    group.append(actions); messagePane.append(group); nativeSurface.append(messagePane);
  };
  const section = document.createElement('div'); section.setAttribute('role', 'tab');
  section.setAttribute('aria-selected', 'true'); section.textContent = 'Primary'; root.append(section);
  for (const threadId of ['101', '202']) {
    const row = document.createElement('div'); row.setAttribute('role', 'button');
    row.textContent = `Synthetic participant ${threadId} · preview`;
    const avatar = document.createElement('img'); avatar.setAttribute('alt', `Synthetic ${threadId}`); row.append(avatar);
    row.addEventListener('click', () => {
      navigation.push(threadId); url = new URL(`https://www.instagram.com/direct/t/${threadId}/`);
      replaceMessagePane(threadId);
    });
    root.append(row);
  }
  const inbox = document.createElement('a'); inbox.setAttribute('href', '/direct/inbox/');
  inbox.addEventListener('click', () => {
    navigation.push('inbox'); url = new URL('https://www.instagram.com/direct/inbox/'); replaceMessagePane(null);
  });
  nativeSurface.append(inbox);
  document.documentElement = nativeSurface;
  document.querySelectorAll = selector => selector === '[aria-label="Thread list"]' ? [root]
    : selector === 'a[href]' ? [inbox] : nativeSurface.querySelectorAll(selector);
  const locks = options.locks === false ? undefined : {
    async request(name, lockOptions, callback) {
      assert.deepEqual(lockOptions, { mode: 'exclusive', ifAvailable: true });
      if (options.lockBusy || lockNames.has(name)) return callback(null);
      lockNames.add(name);
      try { return await callback({ name, mode: 'exclusive' }); }
      finally { lockNames.delete(name); }
    },
  };
  const window = {
    get location() { return url; }, navigator: { locks }, getComputedStyle: () => ({ overflowY: 'visible' }),
    addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
  };
  const viewer = {
    accountKey,
    inspect: () => ({ accountId: 'fixture.owner', accountKey: accountKey('fixture.owner'),
      identityKind: 'verified-viewer-username', accountVerified: true, restriction: false,
      usable: true, threadId: /^\/direct\/t\/(\d+)\/$/.exec(url.pathname)?.[1] || null }),
  };
  const runner = {
    createPlan(input) { return Object.freeze({ ...input }); },
    async start({ plan, workerAdapter }) {
      starts.push(plan);
      const candidate = { key: `synthetic-message-${plan.threadId}`, timestamp: null, ownershipVerified: true };
      try {
        workerAdapter.assertContext({ threadId: plan.threadId });
        const result = await workerAdapter.execute({ threadId: plan.threadId, candidate,
          signal: new AbortController().signal, execute: async () => {
            workerAdapter.assertAction({ threadId: plan.threadId, candidate });
            dispatches.push(plan.threadId);
            await options.afterDispatch?.({ plan, workerAdapter });
            return { verified: true };
          } });
        return { status: workerAdapter.signal.aborted ? 'stopped' : 'completed', processed: result.verified ? 1 : 0, uncertain: 0 };
      } catch { return { status: 'stopped', processed: 0, uncertain: 0 }; }
    },
  };
  const container = document.createElement('section');
  const panel = mountUserscriptInboxPanel({ container, document, window, viewer, runner,
    confirmAction: async value => { confirmations.push(value); return options.confirm ? options.confirm(value) : null; },
    cancelConfirmation: () => options.onCancelConfirmation?.(),
    load: options.load,
    save: async value => {
      saveAttempts.push(structuredClone(value));
      if (options.failSave?.(value)) throw new Error('storage-failed');
      checkpoints.push(structuredClone(value));
    },
    onStatus: value => statuses.push(value), busy: () => options.busy === true,
  });
  const button = name => {
    const matches = container.all().filter(node => node.tagName === 'BUTTON'
      && (name instanceof RegExp ? name.test(node.textContent) : node.textContent === name));
    assert.equal(matches.length, 1, `one button named ${name}`);
    return matches[0];
  };
  const selection = () => container.all().find(node => node.getAttribute('aria-label') === 'Conversations to clean up');
  const acknowledgement = container.all().find(node => node.tagName === 'INPUT' && node.type === 'checkbox');
  return {
    panel, container, document, viewer, confirmations, checkpoints, saveAttempts, starts, dispatches, statuses, navigation, lockNames,
    button, selection, acknowledgement,
    async find() { await panel.ready; acknowledgement.checked = true; await button('Find conversations').click(); },
    async select(index) { const input = selection().all().filter(node => node.tagName === 'INPUT')[index]; input.checked = true; await input.fire('change'); },
    fire(name) { for (const listener of [...lifecycle.get(name) || []]) listener(); },
    visibleText() {
      const text = node => node.hidden ? '' : node._text + node.children.map(text).join(' ');
      return text(container);
    },
    dispose() { panel.dispose?.(); panel.stop(); },
  };
}

test('Find, select, review and Cancel navigate only and never remove or save authority', { timeout: 10_000 }, async t => {
  const f = fixture(); t.after(() => f.dispose());
  await f.panel.ready;
  await f.button('Find conversations').click();
  assert.equal(f.navigation.length, 0, 'read-receipt acknowledgment is required');
  assert.match(f.statuses.at(-1), /mark them read/);
  assert.equal(f.document.activeElement, f.acknowledgement);
  await f.find();
  assert.equal(f.selection().children.length, 2);
  assert.equal(f.button('Review 0 conversations').disabled, true);
  assert.match(f.container.textContent, /may not include your whole inbox/);
  await f.select(1);
  await f.button('Review 1 conversation').click();
  assert.equal(f.confirmations.length, 1);
  assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []); assert.deepEqual(f.checkpoints, []);
  assert.equal(f.panel.snapshot(), null); assert.equal(f.panel.busy(), false);
  assert.match(f.statuses.at(-1), /Canceled.*Nothing was removed/);
});

test('confirmation names the exact selection and discloses messages sent during the run', { timeout: 10_000 }, async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.find(); await f.select(1);
  await f.button('Review 1 conversation').click();
  const confirmation = f.confirmations[0];
  assert.equal(confirmation.title, 'Clean up 1 conversation?');
  assert.equal(confirmation.confirmLabel, 'Start cleanup');
  assert.match(confirmation.detail, /Messages you send while cleanup is running may also be removed/);
  assert.match(confirmation.detail, /Keep this Instagram tab loaded/);
  assert.equal(confirmation.facts.find(item => item.label === 'Account').value, '@fixture.owner');
  assert.equal(confirmation.facts.find(item => item.label === 'Conversations').value, '202');
  assert.match(confirmation.facts.find(item => item.label === 'Messages').value, /one conversation at a time/);
  assert.equal(confirmation.binding.action, 'inbox-unsend');
  assert.equal(typeof confirmation.binding.reviewKey, 'string');
  assert.ok(confirmation.binding.reviewKey.length > 0);
});

test('a mismatched confirmation binding cannot start a runner or save execution state', { timeout: 10_000 }, async t => {
  const f = fixture({ confirm: value => ({ ...value.binding, reviewKey: 'different-review' }) });
  t.after(() => f.dispose()); await f.find(); await f.select(0);
  await f.button('Review 1 conversation').click();
  assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []); assert.deepEqual(f.checkpoints, []);
  assert.match(f.statuses.at(-1), /review changed/);
});

test('accepted two-thread cleanup uses the current controller and serial runner adapter without saved authority', { timeout: 15_000 }, async t => {
  const f = fixture({ confirm: value => ({ ...value.binding }) }); t.after(() => f.dispose());
  await f.find(); await f.button('Select all found').click();
  await f.button('Review 2 conversations').click();
  assert.deepEqual(f.starts.map(plan => plan.threadId), ['101', '202']);
  assert.deepEqual(f.dispatches, ['101', '202']);
  assert.ok(f.starts.every(plan => plan.scope === 'all' && plan.speed === 'standard'));
  const final = f.panel.snapshot();
  assert.equal(final.status, 'completed');
  assert.deepEqual(final.tasks.map(task => task.messageRemovals), [1, 1]);
  assert.deepEqual(final.tasks.map(task => task.status), ['completed', 'completed']);
  assert.equal(final.review.messageWindow, 'during-run');
  assert.equal(final.review.arrivalPolicy, 'include-sent-while-running');
  assert.equal(f.lockNames.size, 0); assert.equal(f.panel.busy(), false);
  const persisted = JSON.stringify(f.checkpoints);
  for (const forbidden of ['authority', 'workerAdapter', 'ownershipVerified', 'Synthetic participant', 'synthetic-message-', 'documentId']) {
    assert.equal(persisted.includes(forbidden), false, forbidden);
  }
  final.tasks[0].messageRemovals = 999;
  assert.equal(f.panel.snapshot().tasks[0].messageRemovals, 1, 'snapshot is detached');
});

test('Stop settles the dispatched result but never starts the next selected conversation', { timeout: 15_000 }, async t => {
  const entered = deferred(), release = deferred();
  const f = fixture({ confirm: value => ({ ...value.binding }), afterDispatch: async () => { entered.resolve(); await release.promise; } });
  t.after(() => { release.resolve(); f.dispose(); });
  await f.find(); await f.button('Select all found').click();
  const running = f.button('Review 2 conversations').click();
  await entered.promise;
  assert.equal(f.button('Stop all').hidden, false);
  await f.button('Stop all').click();
  assert.equal(f.lockNames.size, 1, 'native settlement still holds the account lock');
  release.resolve(); await running;
  assert.deepEqual(f.starts.map(plan => plan.threadId), ['101']);
  assert.deepEqual(f.dispatches, ['101']);
  assert.equal(f.panel.snapshot().tasks[0].messageRemovals, 1);
  assert.equal(f.panel.snapshot().status, 'stopped');
  assert.equal(f.lockNames.size, 0);
});

test('Stop during confirmation invalidates a later accepted result before execution', { timeout: 10_000 }, async t => {
  const entered = deferred(), confirmation = deferred(); let canceled = 0;
  const f = fixture({ confirm: value => { entered.resolve(value); return confirmation.promise; }, onCancelConfirmation: () => { canceled += 1; } });
  t.after(() => { confirmation.resolve(null); f.dispose(); });
  await f.find(); await f.select(0);
  const pending = f.button('Review 1 conversation').click();
  const request = await entered.promise;
  await f.button('Stop all').click();
  confirmation.resolve({ ...request.binding }); await pending;
  assert.equal(canceled, 1); assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []);
  assert.deepEqual(f.checkpoints, []); assert.equal(f.panel.busy(), false);
});

test('missing Web Locks keeps review disabled and cannot invoke cleanup', { timeout: 10_000 }, async t => {
  const f = fixture({ locks: false, confirm: value => ({ ...value.binding }) }); t.after(() => f.dispose());
  await f.find(); await f.select(0);
  const review = f.button('Review 1 conversation');
  assert.equal(review.disabled, true); await review.click();
  assert.match(f.visibleText(), /Inbox cleanup is unavailable: this browser does not provide exclusive tab locks\./);
  assert.deepEqual(f.confirmations, []); assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []);
});

test('an already-busy account lock never launches the first thread runner', { timeout: 10_000 }, async t => {
  const f = fixture({ lockBusy: true, confirm: value => ({ ...value.binding }) }); t.after(() => f.dispose());
  await f.find(); await f.select(0);
  await f.button('Review 1 conversation').click();
  assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []);
  assert.match(f.statuses.at(-1), /account busy/);
  assert.equal(f.lockNames.size, 0);
});

test('page interruption invalidates a pending confirmation even when it later returns the original binding', { timeout: 10_000 }, async t => {
  const entered = deferred(), confirmation = deferred();
  const f = fixture({ confirm: value => { entered.resolve(value); return confirmation.promise; } });
  t.after(() => { confirmation.resolve(null); f.dispose(); });
  await f.find(); await f.select(0);
  const pending = f.button('Review 1 conversation').click();
  const request = await entered.promise;
  f.fire('freeze'); confirmation.resolve({ ...request.binding }); await pending;
  assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []); assert.deepEqual(f.checkpoints, []);
  assert.equal(f.panel.busy(), false);
});

test('an account change while confirmation is open cannot authorize another signed-in account', { timeout: 10_000 }, async t => {
  let f;
  f = fixture({ confirm: value => {
    const original = f.viewer.inspect;
    f.viewer.inspect = () => ({ ...original(), accountId: 'another.fixture', accountKey: accountKey('another.fixture') });
    return { ...value.binding };
  } });
  t.after(() => f.dispose()); await f.find(); await f.select(0);
  await f.button('Review 1 conversation').click();
  assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []); assert.deepEqual(f.checkpoints, []);
  assert.match(f.statuses.at(-1), /account changed/i);
});

test('a verified result remains visible when its checkpoint save fails and no further thread starts', { timeout: 15_000 }, async t => {
  const f = fixture({ confirm: value => ({ ...value.binding }),
    failSave: checkpoint => checkpoint.tasks.some(task => task.messageRemovals > 0) });
  t.after(() => f.dispose()); await f.find(); await f.button('Select all found').click();
  await f.button('Review 2 conversations').click();
  assert.deepEqual(f.starts.map(plan => plan.threadId), ['101']);
  assert.deepEqual(f.dispatches, ['101']);
  assert.equal(f.panel.snapshot().tasks[0].messageRemovals, 1);
  assert.match(f.visibleText(), /1 unsent/);
  assert.equal(f.panel.snapshot().reason, 'storage-failed');
  assert.ok(f.saveAttempts.some(value => value.tasks[0].messageRemovals === 1));
  assert.ok(f.checkpoints.every(value => value.tasks[0].messageRemovals === 0), 'the failed save was not treated as durable');
  assert.equal(f.lockNames.size, 0); assert.equal(f.panel.busy(), false);
  assert.equal(f.button('Find conversations').disabled, true, 'failed writes require a fresh readable runtime');
});

function interruptedCheckpoint(phase) {
  const review = createSingleTabInboxReview({ accountId: accountKey('fixture.owner'),
    threadIds: ['101', '202'], scope: 'all', messageWindow: 'during-run' });
  const state = createInboxCoordinator({ review, save: async () => {} }).snapshot();
  state.status = phase === 'uncertain' ? 'paused' : 'running';
  state.reason = phase === 'uncertain' ? 'removal-not-proven' : null;
  state.tasks[0].status = phase === 'uncertain' ? 'uncertain' : 'running';
  state.tasks[0].messageRemovals = 2;
  state.pendingMutation = { threadId: '101', kind: 'message', phase };
  return state;
}

test('loaded pending or uncertain checkpoints display history without restoring execution authority', { timeout: 10_000 }, async t => {
  for (const phase of ['prepared', 'dispatched', 'uncertain']) {
    const saved = interruptedCheckpoint(phase);
    const f = fixture({ load: async () => structuredClone(saved), confirm: value => ({ ...value.binding }) });
    t.after(() => f.dispose());
    await f.panel.ready;
    assert.deepEqual(f.panel.snapshot(), saved, phase);
    assert.match(f.visibleText(), /2 unsent/);
    assert.match(f.visibleText(), /nothing resumes automatically/i);
    assert.match(f.visibleText(), /I checked the interrupted conversation before starting again/);
    assert.deepEqual(f.starts, [], phase); assert.deepEqual(f.dispatches, [], phase);
    assert.deepEqual(f.navigation, [], phase); assert.deepEqual(f.checkpoints, [], phase);
    assert.equal(f.lockNames.size, 0, phase); assert.equal(f.panel.busy(), false, phase);
    const snapshot = f.panel.snapshot(); snapshot.tasks[0].messageRemovals = 77;
    assert.equal(f.panel.snapshot().tasks[0].messageRemovals, 2, phase);
  }
});

test('replacing interrupted history requires acknowledgment plus a new exact confirmation', { timeout: 15_000 }, async t => {
  const saved = interruptedCheckpoint('uncertain'); let accept = false;
  const f = fixture({ load: async () => structuredClone(saved), confirm: value => accept ? ({ ...value.binding }) : null });
  t.after(() => f.dispose()); await f.panel.ready;
  await f.find(); await f.select(1);
  let review = f.button('Review 1 conversation');
  assert.equal(review.disabled, true, 'newly selected conversations do not erase the recovery gate');
  await review.click();
  assert.deepEqual(f.confirmations, []); assert.deepEqual(f.checkpoints, []);
  assert.deepEqual(f.panel.snapshot(), saved);
  const recovery = f.container.all().find(node => node.tagName === 'LABEL'
    && node.textContent.includes('I checked the interrupted conversation before starting again.'));
  assert.ok(recovery && !recovery.hidden);
  const input = recovery.children.find(node => node.tagName === 'INPUT');
  assert.equal(input.checked, false); input.checked = true; await input.fire('change');
  assert.equal(review.disabled, false);
  await review.click();
  assert.equal(f.confirmations.length, 1);
  assert.deepEqual(f.panel.snapshot(), saved, 'cancel preserves the interrupted history');
  assert.deepEqual(f.starts, []); assert.deepEqual(f.dispatches, []); assert.deepEqual(f.checkpoints, []);
  accept = true; review = f.button('Review 1 conversation'); await review.click();
  assert.equal(f.confirmations.length, 2);
  assert.equal(f.confirmations[1].facts.find(item => item.label === 'Conversations').value, '202');
  assert.deepEqual(f.starts.map(plan => plan.threadId), ['202']); assert.deepEqual(f.dispatches, ['202']);
  const final = f.panel.snapshot();
  assert.equal(final.status, 'completed'); assert.deepEqual(final.review.threadIds, ['202']);
  assert.equal(final.tasks[0].messageRemovals, 1, 'new run does not inherit the old count or approval');
});

test('pending load and failed history reads cannot silently start a fresh cleanup', { timeout: 10_000 }, async t => {
  const loaded = deferred();
  const waiting = fixture({ load: () => loaded.promise });
  t.after(() => { loaded.resolve(null); waiting.dispose(); });
  assert.equal(waiting.button('Find conversations').disabled, true);
  await waiting.button('Find conversations').click();
  assert.deepEqual(waiting.navigation, []); assert.deepEqual(waiting.starts, []);
  loaded.resolve(interruptedCheckpoint('dispatched')); await waiting.panel.ready;
  assert.match(waiting.visibleText(), /nothing resumes automatically/i);
  assert.deepEqual(waiting.starts, []); assert.deepEqual(waiting.checkpoints, []);

  const failed = fixture({ load: async () => { throw new Error('storage-unavailable'); } });
  t.after(() => failed.dispose()); await failed.panel.ready;
  assert.equal(failed.button('Find conversations').disabled, true);
  assert.match(failed.visibleText(), /Saved cleanup progress could not be read/);
  await failed.button('Find conversations').click();
  assert.deepEqual(failed.navigation, []); assert.deepEqual(failed.starts, []); assert.deepEqual(failed.checkpoints, []);
});

test('resume reviews only unfinished discovered threads and never restores old approval', { timeout: 15_000 }, async t => {
  const saved = interruptedCheckpoint('prepared');
  saved.status = 'paused'; saved.reason = 'paused'; saved.pendingMutation = null;
  saved.tasks[0].status = 'completed'; saved.tasks[1].status = 'pending';
  let accept = false;
  const f = fixture({ load: async () => structuredClone(saved), confirm: value => accept ? { ...value.binding } : null });
  t.after(() => f.dispose()); await f.panel.ready;
  assert.equal(f.button(/remaining to resume/).hidden, true, 'saved IDs alone are not discovered navigation evidence');
  assert.deepEqual(f.starts, []);
  await f.find();
  const resume = f.button('Review 1 remaining to resume');
  assert.equal(resume.hidden, false); assert.equal(resume.disabled, false);
  await resume.click();
  assert.equal(f.confirmations[0].facts.find(item => item.label === 'Conversations').value, '202');
  assert.deepEqual(f.starts, []); assert.deepEqual(f.panel.snapshot(), saved, 'Cancel preserves prior verified counts');
  accept = true; await resume.click();
  assert.equal(f.confirmations.length, 2);
  assert.deepEqual(f.starts.map(plan => plan.threadId), ['202']);
  assert.deepEqual(f.panel.snapshot().review.threadIds, ['202']);
  assert.equal(f.panel.snapshot().tasks[0].messageRemovals, 1, 'new run counts do not duplicate prior removals');
  assert.equal(resume.hidden, true);
});

test('resume omits uncertain, failed and skipped conversations instead of silently retrying them', { timeout: 10_000 }, async t => {
  const saved = interruptedCheckpoint('uncertain');
  saved.pendingMutation = null; saved.tasks[1].status = 'skipped';
  const f = fixture({ load: async () => structuredClone(saved), confirm: value => ({ ...value.binding }) });
  t.after(() => f.dispose()); await f.find();
  assert.equal(f.button(/remaining to resume/).hidden, true);
  await f.button(/remaining to resume/).click();
  assert.deepEqual(f.confirmations, []); assert.deepEqual(f.dispatches, []);
});

test('same-page Pause and reviewed Resume reopen the exact conversation through the native inbox', { timeout: 15_000 }, async t => {
  const entered = deferred(), release = deferred(); let first = true;
  const f = fixture({ confirm: value => ({ ...value.binding }), afterDispatch: async () => {
    if (!first) return;
    first = false; entered.resolve(); await release.promise;
  } });
  t.after(() => { release.resolve(); f.dispose(); });
  await f.find(); await f.select(0);
  const running = f.button('Review 1 conversation').click();
  await entered.promise;
  await f.button('Pause').click();
  release.resolve(); await running;
  assert.equal(f.panel.snapshot().status, 'paused');
  assert.equal(f.panel.snapshot().tasks[0].status, 'partial');
  assert.equal(f.panel.snapshot().tasks[0].messageRemovals, 1);
  assert.equal(f.navigation.at(-1), '101', 'the paused run remains in its conversation');
  assert.equal(f.lockNames.size, 0);
  const before = f.navigation.length;
  const resume = f.button('Review 1 remaining to resume');
  assert.equal(resume.hidden, false); assert.equal(resume.disabled, false);
  await resume.click();
  assert.equal(f.confirmations.length, 2, 'Resume obtains new exact approval');
  assert.deepEqual(f.navigation.slice(before), ['inbox', '101']);
  assert.deepEqual(f.starts.map(plan => plan.threadId), ['101', '101']);
  assert.deepEqual(f.dispatches, ['101', '101']);
  assert.equal(f.panel.snapshot().status, 'completed');
  assert.equal(f.panel.snapshot().tasks[0].messageRemovals, 1, 'the new run does not count old removals again');
  assert.equal(f.lockNames.size, 0);
});
