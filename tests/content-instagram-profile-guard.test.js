import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const [labels, inspectorSource] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
]);

function fixture(action, { menuReady = true, settle = true, onControl = null } = {}) {
  let clock = Date.now(), controls = 0, mutations = 0, runtimeListener;
  const timers = new Set(), dialogs = [];
  class Element {
    constructor(text, click = null) {
      this.textContent = text; this.isConnected = true; this.children = []; this.identities = []; this.onClick = click;
    }
    getAttribute(name) { return name === 'href' ? this.href || null : null; }
    querySelectorAll(selector) {
      if (selector === 'button, [role="button"]') return this.children.filter((node) => node.isConnected);
      if (selector === 'a[href], h1, h2, [role="heading"]') return this.identities;
      if (selector === 'a[href]') return this.identities.filter((node) => node.href);
      return [];
    }
    querySelector() { return null; }
    click() { controls += 1; this.onClick?.(); }
  }
  const location = { pathname: '/fixture_target/', href: 'https://www.instagram.com/fixture_target/' };
  const profile = new Element(action === 'follow' ? 'Follow' : 'Following');
  const header = new Element('fixture_target profile');
  header.identities = [new Element('fixture_target')]; header.identities[0].href = '/fixture_target/';
  header.children = [profile];
  const nativeConfirmation = new Element('Unfollow fixture_target?');
  const confirm = new Element('Unfollow', () => {
    mutations += 1; onControl?.('confirm', api);
    if (settle) profile.textContent = 'Follow';
    nativeConfirmation.isConnected = false; confirm.isConnected = false; dialogs.length = 0;
  });
  nativeConfirmation.children = [confirm];
  profile.onClick = () => {
    if (action === 'follow') {
      mutations += 1; onControl?.('follow', api);
      if (settle) profile.textContent = 'Following';
    } else {
      onControl?.('menu', api);
      if (menuReady) dialogs.push(nativeConfirmation);
    }
  };
  const document = {
    body: { innerText: '' },
    querySelector: (selector) => selector === 'main' ? {} : null,
    querySelectorAll: (selector) => selector === 'main header' ? [header]
      : selector === '[role="dialog"]' ? dialogs.filter((node) => node.isConnected) : [],
  };
  class Clock extends Date { static now() { return clock; } }
  const context = vm.createContext({
    crypto: webcrypto, document, location, Date: Clock,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout(callback, delay) {
      const timer = setTimeout(() => { timers.delete(timer); clock += delay; callback(); }, 1);
      timers.add(timer); return timer;
    },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    chrome: { runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } } },
  });
  vm.runInContext(labels, context); vm.runInContext(inspectorSource, context);
  const engine = context.InstaToolboxInstagramInspector;
  const api = {
    engine, location, document, profile, timers,
    showConfirmation() { dialogs.push(nativeConfirmation); },
    get controls() { return controls; }, get mutations() { return mutations; },
    item() {
      const observation = engine.inspectProfile('fixture_target');
      return { action, username: 'fixture_target', expectedRelationship: action === 'follow' ? 'not-following' : 'following',
        resolutionToken: observation.resolutionToken };
    },
    send(request) { return new Promise((resolve) => runtimeListener(request, {}, resolve)); },
  };
  return api;
}

test('runtime guard permits the normal exact Follow path and consumes its resolution once', async () => {
  const f = fixture('follow'), phases = [], item = f.item();
  const result = await f.engine.performReviewedProfileAction(item, { assertAuthorized: (context) => { phases.push(context); return true; } });
  assert.equal(result.result, 'followed'); assert.equal(f.mutations, 1); assert.equal(f.controls, 1);
  assert.ok(phases.length > 0); assert.ok(phases.every((context) => context.username === 'fixture_target' && context.action === 'follow'));
  const replay = await f.engine.performReviewedProfileAction(item, { assertAuthorized: () => true });
  assert.equal(replay.reason, 'profile-resolution-expired-or-changed'); assert.equal(f.mutations, 1);
});

test('false, thrown, asynchronous and missing explicit-true guard results cannot dispatch', async () => {
  for (const assertAuthorized of [() => false, () => undefined, () => 'true', () => { throw new Error('wrong-account'); },
    () => Promise.resolve(true), async () => { throw new Error('async guard rejected'); }]) {
    const f = fixture('follow');
    const result = await f.engine.performReviewedProfileAction(f.item(), { assertAuthorized });
    assert.equal(result.dispatched, false); assert.equal(result.uncertain, false);
    assert.equal(f.controls, 0); assert.equal(f.mutations, 0);
  }
});

test('runtime hook types and explicit context proof fail closed', async () => {
  for (const runtime of [
    { assertAuthorized: true }, { assertContext: true }, { signal: {} },
    { assertAuthorized: () => true, assertContext: () => undefined },
    { assertAuthorized: () => true, assertContext: () => Promise.resolve(true) },
    { assertAuthorized: () => true, assertContext: () => { throw new Error('account unavailable'); } },
  ]) {
    const f = fixture('follow'), result = await f.engine.performReviewedProfileAction(f.item(), runtime);
    assert.equal(result.dispatched, false); assert.equal(result.uncertain, false); assert.equal(f.controls, 0);
  }
});

test('a signal aborted inside the authorization callback cannot dispatch despite its true return', async () => {
  const f = fixture('follow'), controller = new AbortController();
  const result = await f.engine.performReviewedProfileAction(f.item(), {
    signal: controller.signal, assertAuthorized() { controller.abort(); return true; },
  });
  assert.equal(result.dispatched, false); assert.equal(result.uncertain, false); assert.equal(f.controls, 0);
});

test('pre-aborted signals and failed exact target/account context prevent the initial native control', async () => {
  const controller = new AbortController(); controller.abort();
  for (const runtime of [
    { signal: controller.signal, assertAuthorized: () => true },
    { assertAuthorized: ({ username }) => username === 'a_different_target' },
    { assertAuthorized: () => true, assertContext: () => false },
  ]) {
    const f = fixture('follow'), result = await f.engine.performReviewedProfileAction(f.item(), runtime);
    assert.equal(result.dispatched, false); assert.equal(result.uncertain, false); assert.equal(f.controls, 0);
  }
});

test('revocation while waiting for Unfollow confirmation prevents any second native click', async () => {
  let authorized = true;
  const f = fixture('unfollow', { menuReady: false });
  const pending = f.engine.performReviewedProfileAction(f.item(), { assertAuthorized: () => authorized });
  assert.equal(f.controls, 1); authorized = false; f.showConfirmation();
  const result = await pending;
  assert.equal(result.dispatched, false); assert.equal(result.uncertain, false);
  assert.equal(f.controls, 1); assert.equal(f.mutations, 0); assert.equal(f.timers.size, 0);
});

test('Stop during native Unfollow readiness cancels promptly and cannot click a later dialog', async () => {
  const controller = new AbortController(), f = fixture('unfollow', { menuReady: false });
  const pending = f.engine.performReviewedProfileAction(f.item(), { assertAuthorized: () => true, signal: controller.signal });
  assert.equal(f.controls, 1); controller.abort();
  const result = await pending; f.showConfirmation();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(result.dispatched, false); assert.equal(result.uncertain, false);
  assert.equal(f.controls, 1); assert.equal(f.mutations, 0); assert.equal(f.timers.size, 0);
});

test('permission and context are rechecked after an already-ready confirmation yields', async () => {
  for (const change of ['authority', 'account', 'target']) {
    let authorized = true, sameAccount = true;
    const f = fixture('unfollow');
    const pending = f.engine.performReviewedProfileAction(f.item(), {
      assertAuthorized: () => authorized, assertContext: () => sameAccount,
    });
    assert.equal(f.controls, 1);
    if (change === 'authority') authorized = false;
    if (change === 'account') sameAccount = false;
    if (change === 'target') f.location.pathname = '/different_target/';
    const result = await pending;
    assert.equal(result.dispatched, false); assert.equal(result.uncertain, false);
    assert.equal(f.controls, 1); assert.equal(f.mutations, 0);
  }
});

test('Stop after a dispatched Follow or Unfollow preserves verified settlement without another mutation', async () => {
  for (const action of ['follow', 'unfollow']) {
    const controller = new AbortController();
    const f = fixture(action, { onControl: (phase) => { if (phase !== 'menu') controller.abort(); } });
    const result = await f.engine.performReviewedProfileAction(f.item(), {
      assertAuthorized: () => !controller.signal.aborted, assertContext: () => true, signal: controller.signal,
    });
    assert.equal(result.result, action === 'follow' ? 'followed' : 'unfollowed');
    assert.equal(result.dispatched, true); assert.equal(result.uncertain, false); assert.equal(result.needsAttention, true);
    assert.equal(f.mutations, 1); assert.equal(f.timers.size, 0);
  }
});

test('lost account context after dispatch does not report a relationship change as verified success', async () => {
  let contextValid = true;
  const f = fixture('follow', { onControl: () => { contextValid = false; } });
  const result = await f.engine.performReviewedProfileAction(f.item(), { assertAuthorized: () => true, assertContext: () => contextValid });
  assert.equal(result.result, undefined); assert.equal(result.dispatched, true); assert.equal(result.uncertain, true);
  assert.equal(f.mutations, 1); assert.equal(f.timers.size, 0);
});

test('unconfirmed dispatched outcomes stay uncertain and the same token cannot retry them', async () => {
  const f = fixture('follow', { settle: false }), item = f.item();
  const result = await f.engine.performReviewedProfileAction(item, { assertAuthorized: () => true, assertContext: () => true });
  assert.equal(result.result, undefined); assert.equal(result.dispatched, true); assert.equal(result.uncertain, true);
  const replay = await f.engine.performReviewedProfileAction(item, { assertAuthorized: () => true });
  assert.equal(replay.reason, 'profile-resolution-expired-or-changed'); assert.equal(f.mutations, 1);
  assert.equal(f.timers.size, 0);
});

test('a native evidence exception after dispatch remains an uncertain outcome', async () => {
  const f = fixture('follow', { onControl: (_phase, api) => {
    api.document.querySelectorAll = () => { throw new Error('native document unavailable'); };
  } });
  const result = await f.engine.performReviewedProfileAction(f.item(), { assertAuthorized: () => true, assertContext: () => true });
  assert.equal(result.result, undefined); assert.equal(result.dispatched, true); assert.equal(result.uncertain, true);
  assert.equal(result.reason, 'profile-outcome-unavailable'); assert.equal(f.mutations, 1); assert.equal(f.timers.size, 0);
});

test('native preflight failure reports zero dispatches rather than an uncertain action', async () => {
  const f = fixture('follow'), item = f.item(); f.profile.isConnected = false;
  const result = await f.engine.performReviewedProfileAction(item, { assertAuthorized: () => true });
  assert.equal(result.reason, 'profile-resolution-expired-or-changed');
  assert.equal(result.dispatched, false); assert.equal(result.uncertain, false); assert.equal(f.controls, 0);
});

test('message payloads cannot inject runtime guards or signals into the manual action route', async () => {
  const f = fixture('follow'), controller = new AbortController(); controller.abort();
  const item = { ...f.item(), assertAuthorized() { assert.fail('page field called as authority'); }, signal: controller.signal };
  const result = await f.send({ kind: 'insta-toolbox-perform-reviewed-profile-action', item,
    assertAuthorized() { assert.fail('message field called as authority'); }, signal: controller.signal });
  assert.equal(result.result, 'followed'); assert.equal(f.mutations, 1);
});
