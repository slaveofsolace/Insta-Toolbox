import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');

function load(overrides = {}) {
  const context = vm.createContext({
    __instaToolboxTestHooks: true, AbortController, DOMException, Event, EventTarget,
    Date, setTimeout, clearTimeout, console, ...overrides,
  });
  vm.runInContext(source, context);
  return context.InstaToolboxDmThreadUnsender;
}

function trackedSignal() {
  const controller = new AbortController();
  const active = new Set();
  return {
    active, controller,
    signal: {
      get aborted() { return controller.signal.aborted; },
      addEventListener(type, callback, options) {
        active.add(callback);
        controller.signal.addEventListener(type, callback, options);
      },
      removeEventListener(type, callback) {
        active.delete(callback);
        controller.signal.removeEventListener(type, callback);
      },
    },
  };
}

test('repeated waits release every timer and abort listener after normal completion', async () => {
  const timers = new Set();
  const runner = load({
    setTimeout(fn, ms) {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
  });
  const tracked = trackedSignal();
  for (let index = 0; index < 200; index += 1) {
    await runner.__test.delay(0, tracked.signal);
    assert.equal(tracked.active.size, 0);
  }
  assert.equal(timers.size, 0);
  tracked.controller.abort();
  assert.equal(tracked.active.size, 0);
});

test('wait cancellation and timer/abort races settle once and leave no listeners', async () => {
  const runner = load();
  for (let index = 0; index < 30; index += 1) {
    const tracked = trackedSignal();
    const pending = runner.__test.delay(1, tracked.signal);
    tracked.controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(tracked.active.size, 0);
  }
  const tracked = trackedSignal();
  tracked.controller.abort();
  await assert.rejects(runner.__test.delay(60_000, tracked.signal), { name: 'AbortError' });
  assert.equal(tracked.active.size, 0);
});

function readinessHarness({ observe = () => {} } = {}) {
  let now = 1_000;
  let nextTimer = 0;
  const timers = new Map();
  const observers = new Set();
  let created = 0;
  let disconnected = 0;
  const runner = load({
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; created += 1; }
      observe() { observers.add(this.callback); observe(); }
      disconnect() { observers.delete(this.callback); disconnected += 1; }
    },
  });
  return {
    runner, timers, observers,
    state: () => ({ created, disconnected }),
    elapse(ms) { now += ms; },
    notify() { for (const callback of [...observers]) callback(); },
  };
}

test('readiness immediate and observed success clean timers, observers, and listeners', async () => {
  const harness = readinessHarness();
  const tracked = trackedSignal();
  const target = {};
  assert.equal(await harness.runner.__test.waitForElement(target, () => target, tracked.signal), target);
  assert.equal(harness.state().created, 0);
  assert.equal(tracked.active.size, 0);
  let ready = false;
  const pending = harness.runner.__test.waitForElement(target, () => ready && target, tracked.signal);
  assert.equal(harness.observers.size, 1);
  ready = true;
  harness.notify();
  assert.equal(await pending, target);
  assert.equal(harness.observers.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(tracked.active.size, 0);
  harness.notify();
  assert.equal(harness.state().disconnected, 1);
});

test('readiness getter and observe exceptions reject with cleanup on every path', async () => {
  for (const when of ['initial', 'observed', 'observe']) {
    const failure = new Error(`fixture-${when}`);
    let throwing = when === 'initial';
    const harness = readinessHarness({ observe() { if (when === 'observe') throw failure; } });
    const tracked = trackedSignal();
    const pending = harness.runner.__test.waitForElement({}, () => {
      if (throwing) throw failure;
      return null;
    }, tracked.signal);
    const checked = assert.rejects(pending, (error) => error === failure);
    if (when === 'observed') { throwing = true; harness.notify(); }
    await checked;
    assert.equal(harness.observers.size, 0);
    assert.equal(harness.timers.size, 0);
    assert.equal(tracked.active.size, 0);
  }
});

test('readiness catches abort during the initial getter or observer registration', async () => {
  for (const when of ['before', 'getter', 'observe']) {
    const tracked = trackedSignal();
    const harness = readinessHarness({ observe() { if (when === 'observe') tracked.controller.abort(); } });
    if (when === 'before') tracked.controller.abort();
    const pending = harness.runner.__test.waitForElement({}, () => {
      if (when === 'getter') { tracked.controller.abort(); return {}; }
      return null;
    }, tracked.signal);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(tracked.active.size, 0);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.observers.size, 0);
  }
});

test('readiness rechecks after observation and rejects late evidence after a throttled deadline', async () => {
  let ready = false;
  const registration = readinessHarness({ observe() { ready = true; } });
  assert.equal(await registration.runner.__test.waitForElement({}, () => ready, null, 100), true);
  assert.equal(registration.observers.size, 0);
  assert.equal(registration.timers.size, 0);

  const throttled = readinessHarness();
  let reads = 0;
  const tracked = trackedSignal();
  const pending = throttled.runner.__test.waitForElement({}, () => { reads += 1; return false; }, tracked.signal, 100);
  const before = reads;
  const lateTimer = [...throttled.timers.values()][0];
  throttled.elapse(10_000);
  throttled.notify();
  assert.equal(await pending, null);
  assert.equal(reads, before, 'expired observation never inspects late readiness');
  lateTimer();
  assert.equal(throttled.timers.size, 0);
  assert.equal(throttled.observers.size, 0);
  assert.equal(tracked.active.size, 0);
});

function rowFixture({ id = '', text = 'Disposable message' } = {}) {
  const view = { getComputedStyle: (element) => element.style || {} };
  const parent = {
    isConnected: true, children: [], scrollTop: 0, scrollHeight: 200, clientHeight: 100,
    querySelectorAll(selector) {
      if (selector === '[data-message-id], [data-item-id]') return this.children.filter((row) => row.id);
      if (selector.includes('progressbar')) return this.loading ? [this.loading] : [];
      return [];
    },
    getAttribute(name) { return name === 'aria-busy' && this.busy ? 'true' : null; },
  };
  const row = {
    id, text, isConnected: true, parentElement: parent, style: {}, children: [],
    ownerDocument: { defaultView: view },
    getAttribute(name) { return name === 'data-message-id' ? this.id : null; },
    querySelector(selector) { return selector === 'img, video, audio, [aria-haspopup="menu"]' && this.menu ? {} : null; },
    querySelectorAll(selector) {
      if (selector === '[dir="auto"]') return [{
        textContent: this.text, getAttribute: () => null, querySelector: () => null,
      }];
      return [];
    },
  };
  parent.children = [row];
  return { row, parent, view };
}

test('preview edits, empty/loading content, recycled IDs, and retained menus never prove removal', () => {
  const runner = load();
  const { row, parent } = rowFixture({ id: 'original' });
  const before = runner.__test.removalEvidence(row);
  for (const text of ['Edited message', '', 'Loading…', 'Another message']) {
    row.text = text;
    assert.equal(runner.__test.removalProven(row, before), false, text);
  }
  row.text = 'You unsent a message';
  row.id = 'recycled';
  assert.equal(runner.__test.removalProven(row, before), false);
  row.id = 'original';
  parent.busy = true;
  assert.equal(runner.__test.removalProven(row, before), false);
  parent.busy = false;
  row.menu = true;
  assert.equal(runner.__test.removalProven(row, before), false);
  row.menu = false;
  assert.equal(runner.__test.removalProven(row, before), true);
});

test('id-less removals preserve the local neighborhood, not detached virtual windows', () => {
  const runner = load();
  const { row, parent } = rowFixture();
  const before = runner.__test.removalEvidence(row);
  row.isConnected = false;
  parent.children = [];
  assert.equal(runner.__test.removalProven(row, before), true);
  parent.scrollTop = 20;
  assert.equal(runner.__test.removalProven(row, before), false);
  parent.scrollTop = 0;
  parent.isConnected = false;
  assert.equal(runner.__test.removalProven(row, before), false);
  parent.isConnected = true;
  const replacement = rowFixture().row;
  parent.children = [replacement];
  assert.equal(runner.__test.removalProven(row, before), false, 'remounting identical text is not removal');
  replacement.text = 'Different mounted message';
  assert.equal(runner.__test.removalProven(row, before), false, 'replacing an id-less row is not removal');
});

test('a stable logical placeholder remains verifiable after virtual row replacement', () => {
  const runner = load();
  const { row, parent } = rowFixture({ id: 'original' });
  const before = runner.__test.removalEvidence(row);
  row.isConnected = false;
  const replacement = rowFixture({ id: 'original', text: 'You unsent a message' }).row;
  parent.children = [replacement];
  assert.equal(runner.__test.removalProven(row, before), true);
  replacement.text = 'Original message is back';
  assert.equal(runner.__test.removalProven(row, before), false);
});

test('optimistic removal that reverts before settlement produces no success', async () => {
  const runner = load();
  const { row } = rowFixture();
  const before = runner.__test.removalEvidence(row);
  row.text = 'You unsent a message';
  const timer = setTimeout(() => { row.text = before.text; }, 90);
  const verified = await runner.__test.waitForRemoval(row, before, { timeoutMs: 220, stableMs: 150 });
  clearTimeout(timer);
  assert.equal(verified, false);
  row.text = 'You unsent a message';
  assert.equal(await runner.__test.waitForRemoval(row, before, { timeoutMs: 220, stableMs: 80 }), true);
});

test('received rows with right-aligned controls or reactions fail ownership checks', () => {
  const runner = load();
  const view = { getComputedStyle: (element) => element.style || {} };
  const element = (alignment = 'normal', children = [], explicit = '') => ({
    style: { justifyContent: alignment }, children,
    getAttribute: () => explicit, querySelectorAll: () => [],
  });
  const reaction = element('flex-end');
  reaction.matches = () => true;
  assert.equal(runner.__test.sentByCurrentUser(element('normal', [reaction]), view), false);
  assert.equal(runner.__test.sentByCurrentUser(element('flex-start', [reaction]), view), false);
  assert.equal(runner.__test.sentByCurrentUser(element('normal', [element(), reaction]), view), false);
  assert.equal(runner.__test.sentByCurrentUser(element('flex-end', [], 'false'), view), false);
  assert.equal(runner.__test.sentByCurrentUser(element('flex-start', [], 'true'), view), false);
  const contradictory = element('flex-end', [], 'true');
  contradictory.querySelectorAll = () => [element('normal', [], 'false')];
  assert.equal(runner.__test.sentByCurrentUser(contradictory, view), false);
  assert.equal(runner.__test.sentByCurrentUser(element('normal', [element('flex-end')]), view), true);
  assert.equal(runner.__test.sentByCurrentUser(element('normal', [], 'true'), view), true);
});

test('message-options names honor own aria labels and reject conflicting or arbitrary actions', () => {
  const runner = load();
  const control = (text, label = '', icons = []) => ({
    textContent: text,
    getAttribute: (name) => name === 'aria-label' ? label : null,
    querySelectorAll: () => icons.map((name) => ({ getAttribute: () => name })),
  });
  const recognizes = runner.__test.isDmMessageOptionsControl;
  assert.equal(recognizes(control('More', 'See more options for message')), true);
  assert.equal(recognizes(control('…', 'See more options for message')), true);
  assert.equal(recognizes(control('', '', ['See more options for message'])), true);
  assert.equal(recognizes(control('More')), true, 'legacy exact caption remains supported');
  assert.equal(recognizes(control('More', 'Reply')), false);
  assert.equal(recognizes(control('Reply', 'See more options for message')), false);
  assert.equal(recognizes(control('Unrecognized action', 'See more options for message')), false);
  assert.equal(recognizes(control('More', '', ['Share'])), false);
  assert.equal(recognizes(control('', 'Share', ['See more options for message'])), false);
  assert.equal(recognizes(control('', '', ['See more options for message', 'Reply'])), false);
  assert.equal(recognizes(control('…')), false, 'an unlabeled ellipsis is not sufficient proof');
});

test('two visible message-options controls remain ambiguous after selector deduplication', () => {
  const runner = load();
  const controls = ['first', 'second'].map((id) => ({
    id, isConnected: true, textContent: 'More',
    getAttribute: (name) => name === 'aria-label' ? 'See more options for message' : null,
    matches: () => true,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 40, left: 0, right: 100, width: 100, height: 40 }),
  }));
  const row = { querySelectorAll: () => controls };
  assert.equal(runner.__test.actionButton(row), null);
  controls[1].isConnected = false;
  assert.equal(runner.__test.actionButton(row), controls[0]);
});

function interactionFixture(onDispatch, {
  speed = 'standard', runtime = {}, beforeDispatch = null, nativeLayout = false,
  messageCount = 1, scope = 'newest',
} = {}) {
  const observers = new Set();
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  const emitLifecycle = (type, properties = {}) => {
    const event = Object.assign(new Event(type), properties);
    (['freeze', 'resume', 'visibilitychange'].includes(type) ? documentEvents : windowEvents).dispatchEvent(event);
  };
  const notify = () => queueMicrotask(() => { for (const callback of [...observers]) callback(); });
  let document;
  class Element extends EventTarget {
    constructor(tagName = 'div', attributes = {}, text = '') {
      super();
      Object.assign(this, { tagName, attributes, text, children: [], parentElement: null, style: {} });
    }
    get ownerDocument() { return document; }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    get firstChild() { return this.text ? { nodeType: 3 } : this.children[0]; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }
    scrollIntoView() {}
    getBoundingClientRect() { return { top: 10, bottom: 50, left: 10, right: 110, width: 100, height: 40 }; }
    append(...elements) {
      for (const element of elements) { element.parentElement = this; this.children.push(element); }
      notify();
    }
    remove() {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
      notify();
    }
    matches(selector) {
      return selector.split(',').some((part) => {
        let plain = part.trim();
        if (plain.startsWith('[role="dialog"] ')) {
          if (!this.parentElement?.closest('[role="dialog"]')) return false;
          plain = plain.slice('[role="dialog"] '.length);
        }
        let valid = true;
        plain = plain.replace(/\[([\w-]+)(?:(\^=|\*=|=)["']([^"']*)["'])?\]/g, (_, name, operator, value) => {
          const actual = this.getAttribute(name);
          if (!operator ? actual === null : operator === '=' ? actual !== value
            : operator === '^=' ? !String(actual || '').startsWith(value)
              : !String(actual || '').includes(value)) valid = false;
          return '';
        });
        return valid && (!plain || plain === this.tagName);
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [child, ...child.querySelectorAll('*')])
        .filter((child) => selector === '*' || child.matches(selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(element) { return element === this || this.querySelectorAll('*').includes(element); }
    click() { this.onClick?.(); }
  }
  const body = new Element('body');
  document = {
    body, documentElement: body,
    defaultView: { getComputedStyle: (element) => element.style, innerHeight: 800, innerWidth: 1200 },
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    contains: (element) => body.contains(element),
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  };
  const root = new Element('div', { 'data-pagelet': 'IGDMessagesList' });
  Object.assign(root, { scrollHeight: 100, clientHeight: 100, scrollTop: 0 });
  const received = () => {
    const row = new Element('div', { 'data-sent-by-me': 'false' });
    const content = new Element('div', { dir: 'auto' }, 'Received message');
    if (nativeLayout) {
      const group = new Element('div', { role: 'group' });
      group.append(content, new Element('div', { role: 'group', 'aria-label': 'Message actions' }));
      row.append(group);
    } else row.append(content);
    return row;
  };
  const target = new Element('div', { 'data-sent-by-me': 'true', 'data-message-id': 'target' });
  target.append(new Element('div', { dir: 'auto' }, 'Disposable message'));
  const options = new Element('button', { 'aria-haspopup': 'menu', 'aria-label': 'More options' }, 'More options');
  target.append(options);
  if (nativeLayout) {
    target.removeAttribute('data-message-id');
    const content = target.children[0];
    target.children = [];
    const group = new Element('div', { role: 'group' });
    const actions = new Element('div', { role: 'group', 'aria-label': 'Message actions' });
    actions.append(options);
    group.append(content, actions);
    target.append(group);
  }
  root.append(received(), target, received());
  const outgoing = [[target, options]];
  for (let index = 1; index < messageCount; index += 1) {
    const extra = new Element('div', { 'data-sent-by-me': 'true', 'data-message-id': `target-${index}` });
    const extraOptions = new Element('button', { 'aria-haspopup': 'menu', 'aria-label': 'More options' }, 'More options');
    extra.append(new Element('div', { dir: 'auto' }, `Disposable message ${index}`), extraOptions);
    root.append(extra);
    outgoing.push([extra, extraOptions]);
  }
  body.append(root);
  let dispatches = 0;
  let runner;
  for (const [selectedTarget, selectedOptions] of outgoing) selectedOptions.onClick = () => {
    beforeDispatch?.({ runner, emitLifecycle });
    const menu = new Element('button', {}, 'Unsend');
    menu.onClick = () => {
      menu.remove();
      const dialog = new Element('div', { role: 'dialog' });
      const confirm = new Element('button', {}, 'Unsend');
      confirm.onClick = () => {
        dispatches += 1;
        dialog.remove();
        onDispatch({ target: selectedTarget, runner, emitLifecycle, root, Element, observerCount: observers.size });
      };
      dialog.append(confirm);
      body.append(dialog);
    };
    body.append(menu);
  };
  runner = load({
    document, location: { pathname: '/direct/t/disposable/' },
    HTMLElement: Element, MouseEvent: Event, KeyboardEvent: Event,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this.callback); }
      disconnect() { observers.delete(this.callback); }
    },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    ...runtime,
  });
  let ledgerWrites = 0;
  let lastPlan;
  return {
    runner, emitLifecycle,
    dispatches: () => dispatches,
    ledgerWrites: () => ledgerWrites,
    replay: () => runner.start({ plan: lastPlan }),
    run: () => runner.start({
      plan: lastPlan = runner.createPlan({ threadId: 'disposable', scope, speed, limit: 1, expiresAt: (runtime.Date || Date).now() + 60_000 }),
      onVerifiedRemoval() { ledgerWrites += 1; },
    }),
  };
}

test('a dispatched but unproven Unsend is not retried and writes no success ledger entry', async () => {
  const fixture = interactionFixture(() => {});
  const result = await fixture.run();
  assert.equal(fixture.dispatches(), 1, JSON.stringify(result));
  assert.equal(fixture.ledgerWrites(), 0);
  assert.equal(result.processed, 0);
  assert.equal(result.retryAttempts, 0);
  assert.equal(result.status, 'error');
  assert.match(result.message, /uncertain/);
});

test('Stop after dispatch settles a proven removal once without dispatching another mutation', async () => {
  const fixture = interactionFixture(({ target, runner }) => {
    target.remove();
    runner.stop();
  });
  const result = await fixture.run();
  assert.equal(fixture.dispatches(), 1, JSON.stringify(result));
  assert.equal(fixture.ledgerWrites(), 1);
  assert.equal(result.processed, 1);
  assert.equal(result.status, 'stopped');
});

test('the restored runner counts one native id-less removal despite layout reconciliation', async () => {
  const fixture = interactionFixture(({ target, root, Element, observerCount }) => {
    assert.ok(observerCount >= 1, 'the exact-thread monitor is armed before dispatch');
    target.remove();
    root.append(new Element('span', {}, 'Seen'));
  }, { nativeLayout: true });
  const result = await fixture.run();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.processed, 1);
  assert.equal(result.uncertain, 0);
  assert.equal(fixture.dispatches(), 1);
  assert.equal(fixture.ledgerWrites(), 1);
});

test('freeze before dispatch interrupts readiness with a clear needs-attention result', async () => {
  const fixture = interactionFixture(() => {}, {
    beforeDispatch: ({ emitLifecycle }) => emitLifecycle('freeze'),
  });
  const result = await fixture.run();
  assert.equal(fixture.dispatches(), 0);
  assert.equal(fixture.ledgerWrites(), 0);
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.interruptionReason, 'page-frozen');
  assert.equal(result.needsAttention, true);
  assert.equal(result.processed, 0);
  fixture.emitLifecycle('resume');
  fixture.emitLifecycle('pageshow', { persisted: true });
  assert.equal(fixture.runner.snapshot().status, 'needs-attention');
  assert.match((await fixture.replay()).message, /already used/);
  assert.equal(fixture.dispatches(), 0);
});

test('BFCache entry after dispatch settles verified removal but never resumes authority', async () => {
  const fixture = interactionFixture(({ target, emitLifecycle }) => {
    target.remove();
    emitLifecycle('pagehide', { persisted: true });
  });
  const result = await fixture.run();
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.interruptionReason, 'page-cached');
  assert.equal(result.processed, 1);
  assert.equal(result.uncertain, 0);
  assert.equal(fixture.ledgerWrites(), 1);
  fixture.emitLifecycle('pageshow', { persisted: true });
  fixture.emitLifecycle('resume');
  assert.equal(fixture.runner.snapshot().processed, 1);
  assert.equal(fixture.runner.snapshot().status, 'needs-attention');
  assert.match((await fixture.replay()).message, /already used/);
  assert.equal(fixture.dispatches(), 1);
});

test('pagehide after an unproven dispatch preserves uncertainty without retrying', async () => {
  const fixture = interactionFixture(({ emitLifecycle }) => emitLifecycle('pagehide', { persisted: false }));
  const result = await fixture.run();
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.interruptionReason, 'page-left');
  assert.equal(result.uncertain, 1);
  assert.equal(result.processed, 0);
  assert.equal(result.retryAttempts, 0);
  assert.equal(fixture.ledgerWrites(), 0);
  assert.equal(fixture.dispatches(), 1);
  assert.match(result.message, /uncertain/);
});

test('normal tab focus and visibility changes leave a valid run active', async () => {
  const fixture = interactionFixture(({ target, emitLifecycle }) => {
    emitLifecycle('blur');
    emitLifecycle('visibilitychange');
    emitLifecycle('focus');
    target.remove();
  });
  const result = await fixture.run();
  assert.equal(result.status, 'completed');
  assert.equal(result.needsAttention, false);
  assert.equal(result.interruptionReason, null);
  assert.equal(result.processed, 1);
  assert.equal(fixture.dispatches(), 1);
});

test('v3 and authentic legacy v2 plans accept only the original execution pace', () => {
  const runner = load();
  const plan = runner.createPlan({ threadId: 'disposable', scope: 'all', expiresAt: Date.now() + 60_000 });
  assert.equal(plan.version, 3);
  assert.equal(plan.speed, 'standard');
  assert.equal(runner.__test.validatePlan(plan).reviewedDigest, plan.reviewedDigest);
  assert.equal(runner.createPlan({ ...plan, speed: 'fast' }), null);
  assert.equal(runner.__test.validatePlan({ ...plan, speed: 'fast' }), null);
  assert.equal(runner.createPlan({ ...plan, speed: 'turbo' }), null);
  const legacy = { version: 2, threadId: plan.threadId, scope: 'all', limit: null, detectedCount: null, expiresAt: plan.expiresAt };
  let hash = 0x811c9dc5;
  const text = JSON.stringify(legacy);
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  legacy.reviewedDigest = (hash >>> 0).toString(16).padStart(8, '0');
  assert.equal(runner.__test.validatePlan(legacy).speed, 'standard');
  assert.equal(runner.__test.validatePlan({ ...legacy, speed: 'fast' }), null);
  assert.equal(runner.SPEED_PROFILES, undefined);
  const staleFast = { ...plan, speed: 'fast' };
  delete staleFast.reviewedDigest;
  hash = 0x811c9dc5;
  const staleText = JSON.stringify(staleFast);
  for (let index = 0; index < staleText.length; index += 1) hash = Math.imul(hash ^ staleText.charCodeAt(index), 0x01000193);
  staleFast.reviewedDigest = (hash >>> 0).toString(16).padStart(8, '0');
  assert.equal(runner.__test.validatePlan(staleFast), null, 'an authentic old Fast digest grants no current authority');
});

test('a stale Fast request dispatches no native controls and writes no ledger entries', async () => {
  const fixture = interactionFixture(() => assert.fail('obsolete speed must never dispatch'), { speed: 'fast' });
  const result = await fixture.run();
  assert.equal(result.status, 'error');
  assert.equal(fixture.dispatches(), 0);
  assert.equal(fixture.ledgerWrites(), 0);
});

async function timedFixture(speed, fixtureOptions = {}) {
  let now = Date.now();
  const startedAt = now;
  let timerId = 0;
  const timers = new Map();
  const runtime = {
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay = 0) {
      const id = ++timerId;
      timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const settlementDelayMs = Math.max(0, Number(fixtureOptions.settlementDelayMs) || 0);
  const fixture = interactionFixture(({ target, runner }) => {
    if (settlementDelayMs) runtime.setTimeout(() => target.remove(), settlementDelayMs);
    else target.remove();
    if (fixtureOptions.stopAfterDispatch) runner.stop();
  }, { ...fixtureOptions, speed, runtime });
  let result;
  const pending = fixture.run().then((value) => { result = value; });
  for (let step = 0; step < 1_000 && !result; step += 1) {
    for (let flush = 0; flush < 30; flush += 1) await Promise.resolve();
    if (result) break;
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) continue;
    timers.delete(next[0]);
    now = next[1].at;
    next[1].callback();
  }
  assert.ok(result, 'fixture completes within bounded virtual time');
  await pending;
  assert.equal(timers.size, 0, 'settlement and route-monitor timers are cleaned');
  return { fixture, result, durationMs: now - startedAt };
}

test('restored hover timing remains 110ms with verified bounded settlement', async (context) => {
  const standard = await timedFixture('standard');
  assert.equal(standard.result.status, 'completed');
  assert.equal(standard.result.processed, 1);
  assert.equal(standard.result.failed, 0);
  assert.equal(standard.result.retryAttempts, 0);
  assert.equal(standard.fixture.dispatches(), 1);
  assert.equal(standard.fixture.ledgerWrites(), 1);
  assert.ok(standard.result.phaseTimings.verification >= 350);
  const copy = standard.fixture.runner.snapshot();
  copy.phaseTimings.verification = -1;
  assert.ok(standard.fixture.runner.snapshot().phaseTimings.verification >= 350);
  assert.equal(standard.result.phaseTimings.menuReadiness, 110);
  context.diagnostic(JSON.stringify({
    fixture: 'one immediate-menu disposable message; virtual clock',
    standardMs: standard.durationMs,
    standardPhases: standard.result.phaseTimings,
    verifiedPerRun: 1,
    failuresPerRun: 0,
    uncertainPerRun: 0,
  }));
});

test('a delayed native removal uses one full stability window instead of becoming uncertain', async () => {
  const delayed = await timedFixture('standard', { settlementDelayMs: 4_900 });
  assert.equal(delayed.result.status, 'completed', JSON.stringify(delayed.result));
  assert.equal(delayed.result.processed, 1);
  assert.equal(delayed.result.uncertain, 0);
  assert.equal(delayed.fixture.dispatches(), 1);
  assert.equal(delayed.fixture.ledgerWrites(), 1);
  assert.ok(delayed.result.phaseTimings.verification >= 5_250);
});

test('Stop after a delayed dispatch settles the verified removal without starting another one', async () => {
  const delayed = await timedFixture('standard', { settlementDelayMs: 4_900, stopAfterDispatch: true });
  assert.equal(delayed.result.status, 'stopped', JSON.stringify(delayed.result));
  assert.equal(delayed.result.processed, 1);
  assert.equal(delayed.result.uncertain, 0);
  assert.equal(delayed.fixture.dispatches(), 1);
  assert.equal(delayed.fixture.ledgerWrites(), 1);
});

test('All continues after each verified removal and reaches stable exhaustion without counting received rows', async () => {
  const { fixture, result } = await timedFixture('standard', { scope: 'all', messageCount: 3 });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.processed, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.uncertain, 0);
  assert.equal(fixture.dispatches(), 3);
  assert.equal(fixture.ledgerWrites(), 3);
  assert.ok(result.phaseTimings.pacing > 0, 'the original pacing remains between successful actions');
});
