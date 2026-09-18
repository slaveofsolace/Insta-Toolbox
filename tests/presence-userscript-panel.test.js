import assert from 'node:assert/strict';
import test from 'node:test';
import { mountUserscriptPresencePanel } from '../extension/presence-userscript-panel.js';
import { createPresenceNativeInputs } from '../extension/presence-native-inputs.js';
import { createPresencePreferenceStore, defaultPresencePreferences } from '../extension/presence-preferences.js';

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
  contains(node) { return node === this || this.all().includes(node); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  all() { return this.children.flatMap((node) => [node, ...node.all()]); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); }
}
const NOW = Date.parse('2026-09-16T16:00:00Z');
const numericRow = (index) => ({ username: `demo_${index}`, instagramId: String(200 + index), source: 'authenticated-instagram-web' });
async function fixture({ count = 3, partial = false, onReview = null, reviewAvailable = true, captureAvailable = true, privateAllowed = true, preferenceStore = null } = {}) {
  let clock = NOW;
  let viewer = { accountVerified: true, accountId: 'demo_owner', accountKey: 'iguser-v1-64656d6f5f6f776e6572', identityKind: 'verified-viewer-username', evidence: 'visible-account-picker-and-navigation', restriction: false };
  let profile = { goal: 'maintain', timezone: 'UTC', followLimit: 6, skipPrivate: !privateAllowed };
  const freshResult = () => ({ username: 'demo_owner', subjectInstagramId: '100', capturedAt: new Date(clock).toISOString(), source: 'authenticated-instagram-web', followers: Array.from({ length: count }, (_, index) => numericRow(index)), following: [], complete: { followers: true, following: !partial } });
  const nativeAdapter = createPresenceNativeInputs({ now: () => clock, inspectViewer: () => viewer, fetchFollowerComparison: async () => freshResult() });
  let capture = captureAvailable ? await nativeAdapter.captureComparison({ username: 'demo_owner' }) : null;
  const document = { createElement: (tag) => new Element(tag, document), createTextNode: (text) => { const node = new Element('#text', document); node.textContent = text; return node; } };
  const container = document.createElement('div');
  const reviews = [], messages = []; let manualCount = 0;
  const panel = mountUserscriptPresencePanel({ container, document, nativeAdapter, getCapture: () => capture, getProfile: () => profile, now: () => clock, preferenceStore,
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
  assert.match(f.container.textContent, /Planning only/);
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
  assert.match(f.container.textContent, /Planning only/);
});

test('private choices load into the real controls without restoring a plan or authority', async () => {
  const saved = { ...defaultPresencePreferences(), followLimit: 2, protectedHandles: ['demo_0'],
    skipPrivate: false, window: { start: 600, end: 1300 } };
  const writes = [];
  const store = createPresencePreferenceStore({ read: async () => saved, write: async (...args) => writes.push(args) });
  const f = await fixture({ preferenceStore: store });
  await f.panel.ready;
  assert.equal(f.field('allowance').value, '2');
  assert.equal(f.field('protected').value, '@demo_0');
  assert.equal(f.field('start').value, '10:00');
  assert.equal(f.field('end').value, '21:40');
  assert.equal(f.field('private').checked, true);
  assert.equal(f.panel.snapshot().plan, null);
  assert.equal(f.panel.snapshot().executable, false);
  assert.deepEqual(writes, []);
  assert.equal(f.panel.build(), true);
  assert.deepEqual(f.panel.snapshot().plan.targets.map(row => row.targetId), ['201', '202']);
});

test('late preference loading preserves edited controls while applying untouched fields', async () => {
  let finish;
  const loading = new Promise(resolve => { finish = resolve; });
  const writes = [];
  const f = await fixture({ preferenceStore: { load: () => loading, update: async patch => writes.push(patch) } });
  assert.equal(f.button('Build').disabled, true);
  assert.equal(f.panel.build(), false);
  const field = f.field('allowance'); field.value = '1'; await field.fire('input');
  finish({ preferences: { ...defaultPresencePreferences(), followLimit: 9, protectedHandles: ['demo_2'] }, issues: [], writable: true });
  await f.panel.ready;
  assert.equal(f.field('allowance'), field);
  assert.equal(field.value, '1');
  assert.equal(f.field('protected').value, '@demo_2');
  assert.equal(f.button('Build').disabled, false);
  assert.deepEqual(writes, []);
});

test('committed edits save only preferences, retain controls, and invalidate reviewed selections', async () => {
  let saved = defaultPresencePreferences(); const writes = [];
  const store = createPresencePreferenceStore({ read: async () => saved,
    write: async (key, value) => { saved = structuredClone(value); writes.push([key, value]); } });
  const f = await fixture({ preferenceStore: store }); await f.panel.ready;
  f.field('private').checked = true; await f.field('private').fire('change');
  f.panel.build();
  const field = f.field('allowance'); field.value = '1'; await field.fire('input');
  assert.equal(writes.length, 1, 'typing does not write on each keystroke');
  await field.fire('change');
  assert.equal(f.field('allowance'), field);
  assert.equal(f.panel.snapshot().plan, null);
  assert.equal(saved.followLimit, 1);
  assert.deepEqual(Object.keys(saved).sort(), ['followLimit', 'protectedHandles', 'schemaVersion', 'skipPrivate', 'window']);
  assert.equal(JSON.stringify(writes).includes('targetId'), false);
  assert.equal(f.field('storage').hidden, true);
});

test('invalid edits are not saved and leave the previous protected handles intact', async () => {
  let saved = { ...defaultPresencePreferences(), protectedHandles: ['demo_0'] };
  const store = createPresencePreferenceStore({ read: async () => saved, write: async (_, value) => { saved = value; } });
  const f = await fixture({ preferenceStore: store }); await f.panel.ready;
  f.field('protected').value = '@not/valid'; await f.field('protected').fire('change');
  assert.deepEqual(saved.protectedHandles, ['demo_0']);
  assert.match(f.field('storage').textContent, /Finish the choices/);
  assert.equal(f.panel.build(), false);
});

test('unreadable and future preference records stay untouched with a visible fallback', async () => {
  for (const load of [async () => { throw new Error('private detail'); },
    async () => ({ preferences: defaultPresencePreferences(), issues: ['version-unsupported'], writable: false })]) {
    const writes = [];
    const f = await fixture({ preferenceStore: { load, update: async patch => writes.push(patch) } });
    await f.panel.ready;
    assert.match(f.field('storage').textContent, /Changes stay in this tab/);
    assert.equal(f.field('storage').textContent.includes('private detail'), false);
    f.field('allowance').value = '1'; await f.field('allowance').fire('change');
    assert.deepEqual(writes, []);
    assert.equal(f.panel.snapshot().executable, false);
    assert.equal(f.button('Build').disabled, false);
  }
});

test('failed preference writes are visible without replacing current choices or controls', async () => {
  const f = await fixture({ preferenceStore: {
    load: async () => ({ preferences: defaultPresencePreferences(), issues: [], writable: true }),
    update: async () => { throw new Error('private path'); },
  } });
  await f.panel.ready;
  const field = f.field('allowance'); field.value = '2'; await field.fire('change');
  assert.equal(f.field('allowance'), field); assert.equal(field.value, '2');
  assert.match(f.field('storage').textContent, /could not save/);
  assert.equal(f.field('storage').textContent.includes('private path'), false);
  assert.equal(f.panel.snapshot().executable, false);
});

test('disposing a panel cancels pending preference UI updates and queued field saves', async () => {
  let finish;
  const loading = new Promise(resolve => { finish = resolve; }); const writes = [];
  const f = await fixture({ preferenceStore: { load: () => loading, update: async patch => writes.push(patch) } });
  f.field('allowance').value = '2'; const pending = f.field('allowance').fire('change');
  f.panel.dispose();
  finish({ preferences: defaultPresencePreferences(), issues: [], writable: true });
  await f.panel.ready; await pending;
  assert.deepEqual(writes, []);
  assert.equal(f.container.children.length, 0);
  assert.equal(f.panel.snapshot().status, 'disposed');
});

test('editing one time while preferences load preserves the stored other time', async () => {
  let finish;
  const loading = new Promise(resolve => { finish = resolve; }); const writes = [];
  const f = await fixture({ preferenceStore: { load: () => loading, update: async patch => writes.push(patch) } });
  f.field('start').value = '11:00'; await f.field('start').fire('input');
  const save = f.field('start').fire('change');
  finish({ preferences: { ...defaultPresencePreferences(), window: { start: 600, end: 1320 } }, issues: [], writable: true });
  await f.panel.ready; await save;
  assert.equal(f.field('start').value, '11:00');
  assert.equal(f.field('end').value, '22:00');
  assert.deepEqual(writes, [{ window: { start: 660 } }]);
});

test('damaged saved fields can be corrected together through an explicit full repair', async () => {
  let saved = { ...defaultPresencePreferences(), followLimit: 100, protectedHandles: ['bad/name'] };
  const old = structuredClone(saved); let writes = 0;
  const store = createPresencePreferenceStore({ read: async () => saved,
    write: async (_, value) => { writes += 1; saved = structuredClone(value); } });
  const f = await fixture({ preferenceStore: store }); await f.panel.ready;
  assert.equal(f.button('Save corrected').hidden, false);
  f.field('allowance').value = '2'; await f.field('allowance').fire('change');
  f.field('protected').value = '@demo_0'; await f.field('protected').fire('change');
  assert.equal(writes, 0); assert.deepEqual(saved, old);
  await f.button('Save corrected').click();
  assert.equal(writes, 1);
  assert.equal(saved.followLimit, 2); assert.deepEqual(saved.protectedHandles, ['demo_0']);
  assert.equal(f.button('Save corrected').hidden, true);
  assert.equal(f.field('storage').hidden, true);
  assert.equal(f.panel.snapshot().plan, null);
});

test('edits made during a repair are not falsely reported as saved', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = await fixture({ preferenceStore: {
    load: async () => ({ preferences: defaultPresencePreferences(), issues: ['record-invalid'], writable: true }),
    update: () => pending,
  } });
  await f.panel.ready;
  const saving = f.button('Save corrected').click();
  f.field('allowance').value = '3'; await f.field('allowance').fire('input');
  finish(); await saving;
  assert.equal(f.field('allowance').value, '3');
  assert.equal(f.button('Save corrected').hidden, false);
  assert.equal(f.button('Save corrected').disabled, false);
  assert.match(f.field('storage').textContent, /Choices changed while saving/);
});

test('Presence keeps one primary action and compacts choices after an explicit build', async () => {
  const f = await fixture();
  const choices = f.field('choices'), allowance = f.field('allowance');
  const primary = () => f.container.all().filter(node => node.tagName === 'button'
    && node.className === 'button primary' && !node.hidden);
  assert.equal(choices.open, true);
  assert.deepEqual(primary(), [f.button('Build')]);
  assert.equal(f.container.children[0].attributes['aria-label'], 'Presence');
  assert.equal(f.container.textContent.includes('Stay connected'), false);
  assert.equal((f.container.textContent.match(/Planning only/g) || []).length, 1);
  assert.equal(f.panel.build(), true);
  assert.equal(choices.open, false);
  assert.equal(choices.children[0].textContent, 'Edit plan choices');
  assert.deepEqual(primary(), [f.button('Review')]);
  assert.equal(f.button('Build').hidden, true);
  assert.equal(f.field('allowance'), allowance);
  const root = f.container.children[0];
  assert.ok(root.children.indexOf(f.field('plan-summary').parentElement)
    < root.children.indexOf(f.button('Review').parentElement), 'review follows the visible targets');
  choices.open = true; allowance.value = '2'; await allowance.fire('input');
  assert.equal(choices.open, true);
  assert.deepEqual(primary(), [f.button('Build')]);
  assert.equal(f.button('Manual').hidden, false);
});

test('keyboard Build moves focus to its result without scrolling; background refresh never moves it', async () => {
  const f = await fixture();
  f.button('Build').focus();
  assert.equal(f.panel.build(), true);
  const summary = f.field('plan-summary'), document = summary.ownerDocument;
  assert.equal(document.activeElement, summary);
  assert.deepEqual(summary.focusOptions, { preventScroll: true });
  assert.equal(summary.attributes.tabindex, '-1');
  const choices = f.field('choices'); choices.open = true;
  const allowance = f.field('allowance'); allowance.focus();
  const target = f.targets()[0]; target.checked = false; await target.fire('change');
  const selection = f.panel.snapshot().selectedTargetIds;
  f.panel.refresh();
  assert.equal(document.activeElement, allowance);
  assert.equal(choices.open, true);
  assert.equal(f.targets()[0], target);
  assert.deepEqual(f.panel.snapshot().selectedTargetIds, selection);
  f.setViewer(null); f.panel.refresh();
  assert.equal(document.activeElement, allowance);
  assert.equal(choices.open, true);
  assert.equal(f.button('Build').hidden, false);
});

test('programmatic Build does not hide a focused choice or repeat successful-plan instructions', async () => {
  const f = await fixture();
  f.field('allowance').focus();
  assert.equal(f.panel.build(), true);
  assert.equal(f.field('choices').open, true);
  assert.equal(f.field('allowance').ownerDocument.activeElement, f.field('allowance'));
  assert.equal(f.container.textContent.includes('Choose the accounts to review.'), false);
  assert.equal(f.container.textContent.includes('Suggested accounts are listed below.'), false);
  assert.match(f.messages.at(-1), /3 suggested/);
});

test('Build uses the shadow root active element instead of the document host', async () => {
  const f = await fixture();
  const root = f.container.children[0], shadow = { activeElement: f.button('Build') };
  root.getRootNode = () => shadow;
  root.ownerDocument.activeElement = f.container;
  assert.equal(f.panel.build(), true);
  assert.deepEqual(f.field('plan-summary').focusOptions, { preventScroll: true });
  f.field('choices').open = true;
  shadow.activeElement = f.field('allowance');
  f.field('allowance').value = '2'; await f.field('allowance').fire('input');
  f.panel.build();
  assert.equal(f.field('choices').open, true);
});
