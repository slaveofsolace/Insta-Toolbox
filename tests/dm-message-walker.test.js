import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');

function fixture({ count = 6, ids = true, virtual = false } = {}) {
  const timers = new Set();
  const counters = { clicks: 0, markerWrites: 0, scrolls: 0 };
  const location = { pathname: '/direct/t/200/' };
  const restrictions = {};
  const documentEvents = new EventTarget(), windowEvents = new EventTarget();
  let document;
  class Element extends EventTarget {
    constructor(tagName = 'div', attributes = {}, children = []) {
      super();
      Object.assign(this, { tagName, attributes, children: [], parentElement: null,
        style: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      this.append(...children);
    }
    get ownerDocument() { return document; }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this.attributes.text || this.children.map((child) => child.textContent).join(''); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    setAttribute(name, value) { if (name.includes('unsent')) counters.markerWrites += 1; this.attributes[name] = value; }
    removeAttribute(name) { if (name.includes('unsent')) counters.markerWrites += 1; delete this.attributes[name]; }
    matches(selector) {
      return selector.split(',').some((entry) => {
        let part = entry.trim();
        let valid = true;
        part = part.replace(/\[([\w-]+)(?:=["']([^"']*)["'])?\]/g, (_, name, value) => {
          if (!Object.hasOwn(this.attributes, name) || (value !== undefined && this.attributes[name] !== value)) valid = false;
          return '';
        });
        return valid && (!part || part === this.tagName || part === '*');
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    remove() {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
    click() { counters.clicks += 1; }
    scrollIntoView() {}
    getBoundingClientRect() { return { top: 10, bottom: 610, height: 600, left: 10, right: 510, width: 500 }; }
  }
  const body = new Element('body');
  document = { body, documentElement: body,
    defaultView: { getComputedStyle: (element) => element.style, innerHeight: 800, innerWidth: 1200 },
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  };
  const root = new Element('div', { 'data-pagelet': 'IGDMessagesList' });
  body.append(root);
  const logical = Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`, text: `Fixture content ${index}`, own: index % 2 === 0,
  }));
  const rows = new Map();
  let scroller;
  const makeRow = (entry) => {
    const row = new Element('div', { role: 'row', 'data-sent-by-me': String(entry.own),
      ...(ids ? { 'data-message-id': entry.id } : {}) }, [
      new Element('span', { dir: 'auto', text: entry.text }),
      new Element('button', { 'aria-label': 'More options' }),
    ]);
    row.logical = entry;
    row.getBoundingClientRect = () => {
      const index = logical.indexOf(row.logical);
      const top = 30 + index * 50 - (virtual ? Number(scroller.scrollTop) : 0);
      return { top, bottom: top + 30, height: 30, left: 30, right: 400, width: 370 };
    };
    row.scrollIntoView = () => {
      if (!virtual) return;
      const index = logical.indexOf(row.logical);
      scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
        index * 50 + 35 - scroller.clientHeight / 2));
      render();
    };
    return row;
  };
  const render = () => {
    const start = virtual ? Math.min(Math.max(0, Math.floor(scroller.scrollTop / 50)), Math.max(0, count - 4)) : 0;
    const entries = virtual ? logical.slice(start, start + 4) : logical;
    for (const row of scroller.children) row.parentElement = null;
    scroller.children = [];
    for (const entry of entries) {
      if (!rows.has(entry.id)) rows.set(entry.id, makeRow(entry));
      scroller.append(rows.get(entry.id));
    }
  };
  const makeScroller = () => {
    const element = new Element();
    Object.assign(element, { clientHeight: virtual ? 220 : 600,
      scrollHeight: virtual ? count * 50 + 20 : 600, scrollTop: 0 });
    element.style = { display: 'flex', flexDirection: 'column', overflowY: 'auto' };
    element.getBoundingClientRect = () => ({ top: 10, bottom: virtual ? 230 : 610,
      height: virtual ? 220 : 600, left: 10, right: 510, width: 500 });
    element.addEventListener('scroll', () => { counters.scrolls += 1; render(); });
    return element;
  };
  scroller = makeScroller(); root.append(scroller); render();
  // Short-list context uses its visible root as the scroller.
  if (!virtual) {
    root.children = []; scroller.parentElement = null;
    for (const row of [...scroller.children]) root.append(row);
    scroller = root;
    Object.assign(root, { clientHeight: 600, scrollHeight: 600, scrollTop: 0 });
  }
  const sandbox = vm.createContext({ __instaToolboxTestHooks: true, document, location,
    AbortController, DOMException, Event, EventTarget, Date,
    setTimeout(callback, ms) { const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    InstaToolboxInstagramInspector: { inspectSession: () => restrictions },
  });
  vm.runInContext(source, sandbox);
  const runner = sandbox.InstaToolboxDmThreadUnsender;
  const create = (options = {}) => runner.createMessageWalker({ threadId: '200', expiresAt: Date.now() + 30_000, ...options });
  return { runner, create, location, restrictions, root, rows, logical, counters, timers,
    interrupt(type) { (type === 'freeze' ? documentEvents : windowEvents).dispatchEvent(new Event(type)); },
    get scroller() { return scroller; },
    replaceScroller() {
      const old = scroller;
      scroller = makeScroller(); old.remove(); root.append(scroller); render();
    },
    recycle(row, entry) {
      const position = logical.indexOf(row.logical);
      if (position >= 0) logical[position] = entry;
      row.logical = entry;
      row.children[0].attributes.text = entry.text;
      row.attributes['data-sent-by-me'] = String(entry.own);
      if (ids) row.attributes['data-message-id'] = entry.id;
    },
  };
}

test('read-only walker includes received rows without changing default sent-only candidates or markers', async () => {
  const f = fixture();
  const first = f.rows.get('message-0');
  first.attributes['data-insta-toolbox-unsent'] = 'older-marker';
  const walker = f.create();
  const seen = [];
  for (;;) {
    const item = await walker.next();
    if (item.done) {
      assert.equal(item.coverage, 'exhausted');
      assert.equal(item.reason, 'stable-exhaustion');
      break;
    }
    seen.push(item.value.key);
  }
  assert.deepEqual(seen, [5, 4, 3, 2, 1, 0].map((i) => `data-message-id:message-${i}`));
  assert.equal(first.attributes['data-insta-toolbox-unsent'], 'older-marker');
  assert.equal(f.counters.markerWrites, 0);
  assert.equal(f.counters.clicks, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual([...f.runner.__test.candidateRows(f.scroller)].map((row) => row.logical.id),
    ['message-0', 'message-2', 'message-4']);
});

test('walker lock rejects concurrent readers, Unsend, and full-history inspection', async () => {
  const f = fixture(); const walker = f.create();
  assert.throws(() => f.create(), { code: 'DM_WALKER_BUSY' });
  await assert.rejects(f.runner.start(), { code: 'DM_WALKER_BUSY' });
  assert.equal((await f.runner.inspectAll()).ready, false);
  const first = walker.next();
  await assert.rejects(walker.next(), { code: 'DM_WALKER_BUSY' });
  await first;
  walker.close();
  assert.equal(walker.snapshot().coverage, 'partial');
  assert.equal(f.create().close(), true);
  assert.equal(f.timers.size, 0);
});

test('external Stop cancels pending traversal, releases the lock, and does not claim completion', async () => {
  const f = fixture(); const controller = new AbortController();
  const walker = f.create({ signal: controller.signal });
  const pending = walker.next(); controller.abort();
  await assert.rejects(pending);
  assert.notEqual(walker.snapshot().coverage, 'exhausted');
  assert.equal(f.create().close(), true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.counters.clicks, 0);
});

test('elapsed expiry, route drift, and restrictions interrupt before returning another row', async () => {
  for (const cause of ['expiry', 'thread', 'challenge']) {
    const f = fixture();
    const walker = f.create(cause === 'expiry' ? { expiresAt: Date.now() + 25 } : {});
    if (cause === 'expiry') await new Promise((resolve) => setTimeout(resolve, 35));
    if (cause === 'thread') f.location.pathname = '/direct/t/201/';
    if (cause === 'challenge') f.restrictions.challenge = true;
    if (cause === 'expiry') {
      const result = await walker.next();
      assert.equal(result.done, true); assert.equal(result.reason, 'DM_WALKER_EXPIRED');
    } else await assert.rejects(walker.next(), { code: 'DM_WALKER_CONTEXT' });
    assert.notEqual(walker.snapshot().coverage, 'exhausted');
    assert.equal(f.counters.clicks, 0);
    assert.equal(f.timers.size, 0);
  }
});

test('a step limit reports interrupted coverage rather than stable exhaustion', async () => {
  const f = fixture(); const walker = f.create({ maxSteps: 1 });
  await assert.rejects(walker.next(), { code: 'DM_WALKER_LIMIT' });
  assert.equal(walker.snapshot().reason, 'DM_WALKER_LIMIT');
  assert.notEqual(walker.snapshot().coverage, 'exhausted');
  assert.equal(f.timers.size, 0);
});

test('stable message identities remain visited across replacement scrollers and overlapping windows', async (context) => {
  const f = fixture({ count: 10, virtual: true }); const walker = f.create();
  context.after(() => walker.close());
  const seen = new Set();
  for (let index = 0; index < 30; index += 1) {
    const item = await walker.next();
    if (item.done) break;
    assert.equal(seen.has(item.value.key), false);
    seen.add(item.value.key);
    if (seen.size === 2) f.replaceScroller();
  }
  assert.equal(seen.size, 10);
  assert.equal(walker.snapshot().coverage, 'exhausted');
  assert.equal(f.counters.clicks, 0);
  assert.equal(f.counters.markerWrites, 0);
  assert.equal(f.timers.size, 0);
});

test('recycled id-less physical nodes with different content are read again without DOM markers', async (context) => {
  const f = fixture({ count: 2, ids: false }); const walker = f.create();
  context.after(() => walker.close());
  const first = await walker.next();
  const row = first.value.row;
  f.recycle(row, { id: 'replacement', own: false, text: 'Different recycled content' });
  const second = await walker.next();
  assert.equal(second.done, false);
  assert.equal(second.value.row, row);
  assert.equal(f.counters.markerWrites, 0);
  assert.equal(f.counters.clicks, 0);
  walker.close();
});

test('read-only walker refuses invalid options and a stopped signal before scrolling', () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  assert.throws(() => f.create({ signal: controller.signal }), { code: 'DM_WALKER_ABORTED' });
  assert.throws(() => f.create({ threadId: '201' }), { code: 'DM_WALKER_CONTEXT' });
  assert.throws(() => f.create({ expiresAt: Date.now() - 1 }), { code: 'DM_WALKER_INVALID' });
  assert.throws(() => f.create({ timeoutMs: Infinity }), { code: 'DM_WALKER_INVALID' });
  assert.equal(f.counters.scrolls, 0);
  assert.equal(f.timers.size, 0);
});

test('walker lifecycle latch revokes before a caller can activate another native control', async () => {
  for (const event of ['freeze', 'pagehide']) {
    const f = fixture(); const walker = f.create();
    await walker.next();
    assert.equal(walker.assertCurrent(), true);
    f.interrupt(event);
    assert.equal(walker.signal.aborted, true);
    assert.throws(() => walker.assertCurrent());
    assert.equal((await walker.next()).done, true);
    assert.equal(walker.snapshot().coverage, 'partial');
    assert.equal(walker.snapshot().reason, event === 'freeze' ? 'page-frozen' : 'page-left');
    assert.equal(f.timers.size, 0);
  }
});

test('an active Unsend preparation excludes read-only walkers until its Stop settles', async () => {
  const f = fixture();
  const plan = f.runner.createPlan({ threadId: '200', scope: 'newest', limit: 1, expiresAt: Date.now() + 30_000 });
  const pending = f.runner.start({ plan });
  assert.throws(() => f.create(), { code: 'DM_WALKER_BUSY' });
  f.runner.stop();
  await pending;
  assert.equal(f.counters.clicks, 0);
  assert.equal(f.create().close(), true);
  assert.equal(f.timers.size, 0);
});

test('oldest read-only traversal keeps the existing stable history-boundary proof', async (context) => {
  const f = fixture({ count: 2 }); const walker = f.create({ order: 'oldest', timeoutMs: 5_000 });
  context.after(() => walker.close());
  const first = await walker.next();
  assert.equal(first.value.key, 'data-message-id:message-0');
  assert.equal(f.counters.clicks, 0);
});

test('controller-owned walker keeps its operation lock through aborted outcome settlement', async () => {
  for (const stop of ['signal', 'runner', 'freeze']) {
    const f = fixture(); const controller = new AbortController();
    const walker = f.create({ signal: controller.signal, holdUntilClosed: true });
    await walker.next();
    if (stop === 'signal') controller.abort();
    else if (stop === 'runner') f.runner.stop();
    else f.interrupt('freeze');
    assert.equal(walker.signal.aborted, true);
    assert.throws(() => walker.assertCurrent());
    await assert.rejects(f.runner.start(), { code: 'DM_WALKER_BUSY' });
    assert.throws(() => f.create(), { code: 'DM_WALKER_BUSY' });
    assert.equal(walker.close(), true);
    assert.equal(f.create().close(), true);
    assert.equal(f.timers.size, 0);
  }
});

test('a rejected controller-owned walker constructor never leaves an unreachable operation lock', () => {
  const f = fixture(); f.restrictions.challenge = true;
  assert.throws(() => f.create({ holdUntilClosed: true }), { code: 'DM_WALKER_CONTEXT' });
  f.restrictions.challenge = false;
  assert.equal(f.create().close(), true);
  assert.equal(f.timers.size, 0);
});
