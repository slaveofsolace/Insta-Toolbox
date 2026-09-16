import assert from 'node:assert/strict';
import test from 'node:test';
import { mountUserscriptPresencePanel } from '../extension/presence-userscript-panel.js';
import { createPresenceNativeInputs } from '../extension/presence-native-inputs.js';

class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.attributes = {}; this.listeners = {}; this._text = ''; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
  async fire(type) { for (const fn of [...(this.listeners[type] || [])]) await fn({ target: this }); }
  async click() { if (!this.disabled && !this.hidden) await this.fire('click'); }
  all() { return this.children.flatMap((node) => [node, ...node.all()]); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); }
}
const NOW = Date.parse('2026-09-16T16:00:00Z');
const numericRow = (index) => ({ username: `demo_${index}`, instagramId: String(200 + index), source: 'authenticated-instagram-web' });
async function fixture({ count = 3, partial = false, onReview = null, reviewAvailable = true, captureAvailable = true, privateAllowed = true } = {}) {
  let clock = NOW;
  let viewer = { accountVerified: true, accountId: 'demo_owner', accountKey: 'iguser-v1-64656d6f5f6f776e6572', identityKind: 'verified-viewer-username', evidence: 'visible-account-picker-and-navigation', restriction: false };
  let profile = { goal: 'maintain', timezone: 'UTC', followLimit: 6, skipPrivate: !privateAllowed };
  const freshResult = () => ({ username: 'demo_owner', subjectInstagramId: '100', capturedAt: new Date(clock).toISOString(), source: 'authenticated-instagram-web', followers: Array.from({ length: count }, (_, index) => numericRow(index)), following: [], complete: { followers: true, following: !partial } });
  const nativeAdapter = createPresenceNativeInputs({ now: () => clock, inspectViewer: () => viewer, fetchFollowerComparison: async () => freshResult() });
  let capture = captureAvailable ? await nativeAdapter.captureComparison({ username: 'demo_owner' }) : null;
  const document = { createElement: (tag) => new Element(tag, document), createTextNode: (text) => { const node = new Element('#text', document); node.textContent = text; return node; } };
  const container = document.createElement('div');
  const reviews = [], messages = []; let manualCount = 0;
  const panel = mountUserscriptPresencePanel({ container, document, nativeAdapter, getCapture: () => capture, getProfile: () => profile, now: () => clock,
    onReview: reviewAvailable ? onReview || ((draft) => { reviews.push(draft); }) : null, onManual: () => { manualCount += 1; }, onStatus: (message) => messages.push(message) });
  return { panel, container, reviews, messages, nativeAdapter,
    field(name) { return container.all().find((node) => node.attributes['data-presence'] === name); },
    button(text) { return container.all().find((node) => node.tagName === 'button' && node.textContent.startsWith(text)); },
    targets() { return container.all().filter((node) => node.attributes['data-presence-target']); },
    setProfile(value) { profile = { ...profile, ...value }; }, setClock(value) { clock = value; }, setViewer(value) { viewer = value; },
    setCapture(value) { capture = value; }, async newCapture() { capture = await nativeAdapter.captureComparison({ username: 'demo_owner' }); },
    get manualCount() { return manualCount; }, get capture() { return capture; } };
}

test('uses actual receipt, planner, and review adapter without a simulation or Start action', async () => {
  const f = await fixture();
  assert.equal(f.panel.build(), true);
  assert.equal(f.panel.snapshot().plan.targets.length, 3);
  assert.equal(f.targets().length, 3);
  assert.match(f.container.textContent, /Plan preview only/);
  assert.equal(f.button('Start'), undefined);
  assert.equal(f.button('Preview'), undefined);
  assert.equal(await f.panel.review(), true);
  assert.equal(f.reviews.length, 1);
  assert.equal(f.reviews[0].confirmationDraft.kind, 'account');
  assert.equal(f.reviews[0].executable, false);
  assert.equal(f.reviews[0].capabilities.live, false);
  assert.equal(f.panel.snapshot().status, 'reviewed');
});

test('missing receipt or copied saved capture gives a repair message rather than synthetic targets', async () => {
  const f = await fixture({ captureAvailable: false });
  assert.equal(f.panel.build(), false);
  assert.match(f.messages.at(-1), /Run Mutual Checker/);
  await f.newCapture(); f.setCapture(structuredClone(f.capture));
  assert.equal(f.panel.build(), false);
  assert.equal(f.targets().length, 0);
});

test('zero allowance is honored; invalid allowance and protected names do not fall back silently', async () => {
  const f = await fixture(); f.field('allowance').value = '0';
  assert.equal(f.panel.build(), true); assert.equal(f.targets().length, 0);
  for (const value of ['-1', '1.5', '51', '', '2x']) {
    f.field('allowance').value = value;
    assert.equal(f.panel.build(), false); assert.match(f.messages.at(-1), /whole number from 0 to 50/);
  }
  f.field('allowance').value = '6'; f.field('protected').value = '@missing';
  assert.equal(f.panel.build(), false); assert.match(f.messages.at(-1), /Not found in these checked lists: @missing/);
});

test('protected observed handles resolve to IDs, preserve stored protections, and explain held rows', async () => {
  const f = await fixture(); f.setProfile({ protectedIds: ['201'] });
  f.field('protected').value = '@demo_0';
  assert.equal(f.panel.build(), true);
  assert.deepEqual(f.panel.snapshot().plan.targets.map((row) => row.targetId), ['202']);
  assert.match(f.container.textContent, /Held accounts \(2\)/);
  assert.match(f.container.textContent, /keep list/i);
});

test('unknown privacy and partial following evidence remain held until a valid choice/evidence exists', async () => {
  const f = await fixture({ privateAllowed: false });
  assert.equal(f.panel.build(), true); assert.equal(f.targets().length, 0);
  f.field('private').checked = true; await f.field('private').fire('change');
  assert.equal(f.panel.build(), true); assert.equal(f.targets().length, 3);
  const partial = await fixture({ partial: true }); partial.panel.build();
  assert.equal(partial.targets().length, 0);
  assert.match(partial.messages.at(-1), /missing accounts stay unknown/);
});

test('selection changes only a finite subset and keeps the existing row nodes', async () => {
  const f = await fixture(); f.panel.build();
  const first = f.targets()[0]; first.checked = false; await first.fire('change');
  assert.equal(f.targets()[0], first);
  assert.equal(f.button('Review').textContent, 'Review 2 accounts');
  await f.panel.review();
  assert.deepEqual(f.reviews[0].bindings.map((row) => row.targetId), ['201', '202']);
  for (const input of f.targets()) { input.checked = false; await input.fire('change'); }
  f.panel.refresh();
  assert.equal(f.panel.snapshot().status, 'planned');
  assert.equal(f.button('Review').disabled, true);
});

test('form changes invalidate prior review while preserving controls and edited value', async () => {
  const f = await fixture(); f.panel.build();
  const field = f.field('allowance'); field.value = '1'; await field.fire('input');
  assert.equal(f.field('allowance'), field);
  assert.equal(field.value, '1'); assert.equal(f.panel.snapshot().plan, null);
  assert.equal(await f.panel.review(), false); assert.equal(f.reviews.length, 0);
  f.panel.build(); assert.equal(f.targets().length, 1);
});

test('new capture, changed protections, expiry and lost account proof prevent review callback', async () => {
  for (const change of [
    async (f) => f.newCapture(),
    async (f) => f.setProfile({ protectedIds: ['200'] }),
    async (f) => f.setClock(NOW + 16 * 60_000),
    async (f) => f.setViewer(null),
  ]) {
    const f = await fixture(); f.panel.build(); await change(f);
    assert.equal(await f.panel.review(), false); assert.equal(f.reviews.length, 0);
    assert.equal(f.panel.snapshot().status, 'unavailable');
  }
});

test('held lists are bounded and reveal another page without rebuilding form controls', async () => {
  const f = await fixture({ count: 80, privateAllowed: false }); f.panel.build();
  const field = f.field('allowance');
  const list = f.container.all().find((node) => node.tagName === 'details' && node.children[0].textContent.startsWith('Held accounts')).children[1];
  assert.equal(list.children.length, 25);
  await f.button('Show 25 more').click();
  assert.equal(list.children.length, 50); assert.equal(f.field('allowance'), field);
});

test('late review rejection cannot invalidate a newer rebuilt plan', async () => {
  let reject;
  const f = await fixture({ onReview: () => new Promise((_, fail) => { reject = fail; }) });
  f.panel.build(); const pending = f.panel.review();
  f.field('allowance').value = '1'; await f.field('allowance').fire('input'); f.panel.build();
  reject(new Error('cancelled')); assert.equal(await pending, false);
  assert.equal(f.panel.snapshot().status, 'planned');
  assert.equal(f.panel.snapshot().plan.targets.length, 1);
});

test('manual route remains usable and dispose leaves no panel or stale review result', async () => {
  const f = await fixture(); f.panel.build(); await f.button('Manual').click();
  assert.equal(f.manualCount, 1); assert.equal(f.panel.snapshot().plan, null);
  f.panel.dispose(); assert.equal(f.container.children.length, 0);
  assert.equal(f.panel.build(), false); assert.equal(await f.panel.review(), false);
  assert.equal(f.panel.snapshot().status, 'disposed');
});

test('an empty or fully held plan also loses its account context on refresh after account loss', async () => {
  const f = await fixture({ privateAllowed: false }); f.panel.build();
  assert.equal(f.panel.snapshot().plan.targets.length, 0);
  f.setViewer(null); f.panel.refresh();
  assert.equal(f.panel.snapshot().plan, null);
  assert.equal(f.panel.snapshot().status, 'unavailable');
  assert.equal(f.container.textContent.includes('@demo_owner'), false);
});

test('plan hours are editable, validated, and invalidate an old review', async () => {
  const f = await fixture();
  assert.equal(f.field('start').value, '09:00');
  assert.equal(f.field('end').value, '20:00');
  f.panel.build();
  f.field('start').value = '17:00'; await f.field('start').fire('input');
  assert.equal(f.panel.snapshot().plan, null);
  assert.equal(f.panel.build(), true);
  assert.equal(f.targets().length, 0);
  f.field('end').value = '17:00';
  assert.equal(f.panel.build(), false);
  assert.match(f.messages.at(-1), /different start and end/);
  f.field('start').value = '25:00';
  assert.equal(f.panel.build(), false);
  assert.match(f.messages.at(-1), /valid plan hours/);
});

test('without a native review handler no enabled-looking Review or Start action is shown', async () => {
  const f = await fixture({ reviewAvailable: false });
  f.panel.build();
  assert.equal(f.button('Review').hidden, true);
  assert.equal(f.button('Build').className, 'button primary');
  assert.equal(f.button('Start'), undefined);
  assert.equal(await f.panel.review(), false);
  assert.equal(f.targets().length, 0, 'preview rows have no inactive selection controls');
  assert.match(f.container.textContent, /@demo_0/);
  assert.match(f.container.textContent, /Plan preview only/);
});
