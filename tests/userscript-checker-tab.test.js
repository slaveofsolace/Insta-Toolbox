import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const shell = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const engine = await readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8');
const stateKey = 'instaToolboxUserscriptStateV2';
const tabKey = 'instaToolboxCheckerDraftV1';
const diagnosticsFunction = engine.slice(engine.indexOf('  function normalizeFollowerDiagnostics('), engine.indexOf('  function followerComparisonDetails('));
const loadFunctions = shell.slice(shell.indexOf('  const normalizeUsername ='), shell.indexOf('  function normalizePreferences('));
const saveFunction = shell.slice(shell.indexOf('  function saveState()'), shell.indexOf('  function savePreferences('));
const readerFunction = shell.slice(shell.indexOf('  function readManagerTab()'), shell.indexOf('  function loadState('));

function openTab(shared, tab = { value: {} }, available = true) {
  const context = vm.createContext({
    console, Date, Set, Map, structuredClone,
    GM_getValue: (key, fallback) => structuredClone(shared.get(key) ?? fallback),
    GM_setValue: (key, value) => shared.set(key, structuredClone(value)),
    GM_saveTab: (value) => { tab.value = structuredClone(value); },
    initialTab: available ? structuredClone(tab.value) : null,
  });
  vm.runInContext(`
    const STATE_KEY = '${stateKey}', LEGACY_QUEUE_KEY = 'instaToolboxManualQueueV1';
    const TAB_RUN_FIELD = 'instaToolboxAccountRunV1', TAB_CHECKER_FIELD = '${tabKey}';
    const RESERVED = new Set(), CAPTURE_ACCOUNT_SOURCES = new Set(['authenticated-instagram-web', 'tampermonkey-visible-dom']);
    const ACTIONABLE_STATUSES = new Set(['pending', 'ready', 'failed', 'paused']);
    const RUN_CAPABILITY_MS = 1200000;
    ${diagnosticsFunction}
    globalThis.InstaToolboxInstagramInspector = { normalizeFollowerDiagnostics };
    ${loadFunctions}
    let managerTab = initialTab;
    const managerTabStorageAvailable = managerTab !== null;
    let state = loadState(managerTab);
    ${saveFunction}
    globalThis.fixture = { read: () => structuredClone(state), save: saveState,
      capture: (value) => { state.capture = value; saveState(); } };
  `, context);
  return context.fixture;
}

function capture(username = 'fixture.person') {
  return {
    subjectUsername: 'fixture.owner', followers: [{ username }], following: [{ username }],
    complete: { followers: false, following: true }, verified: { followers: true, following: true },
    source: { followers: 'authenticated-web', following: 'authenticated-web' },
    capturedAt: { followers: '2026-09-16T00:00:00.000Z', following: '2026-09-16T00:00:00.000Z' },
    expectedCounts: { followers: 2, following: 1 }, pages: { followers: 1, following: 1 },
    reasons: { followers: 'count-mismatch', following: 'pagination-complete' },
  };
}

test('new userscript tabs ignore shared checker history without deleting it or changing unrelated state', () => {
  const archived = capture('archived.person');
  const shared = new Map([[stateKey, { schemaVersion: 6, capture: archived, ledger: { actions: 4, unsends: 3 }, queue: { queue: [] }, history: [{ kind: 'dm-dry-run' }] }], ['preferences', { theme: 'dark' }]]);
  const first = openTab(shared);
  assert.equal(first.read().capture.followers.length, 0);
  assert.equal(first.read().capture.following.length, 0);
  assert.equal(first.read().capture.subjectUsername, '');
  first.save();
  assert.deepEqual(shared.get(stateKey).capture, archived);
  assert.deepEqual(shared.get(stateKey).ledger, { actions: 4, unsends: 3 });
  assert.deepEqual(shared.get(stateKey).history, [{ kind: 'dm-dry-run' }]);
  assert.deepEqual(shared.get('preferences'), { theme: 'dark' });
});

test('same-tab reload restores only its own checker draft and diagnostics', () => {
  const shared = new Map(); const tab = { value: {} };
  const first = openTab(shared, tab); first.capture(capture());
  const reloaded = openTab(shared, tab).read().capture;
  assert.equal(reloaded.followers[0].username, 'fixture.person');
  assert.equal(reloaded.expectedCounts.followers, 2);
  assert.equal(reloaded.pages.followers, 1);
  assert.equal(reloaded.reasons.followers, 'count-mismatch');
  assert.equal(reloaded.complete.followers, false);
  assert.equal(Object.hasOwn(shared.get(stateKey), 'capture'), false);
});

test('different tabs cannot overwrite or inherit one another’s checker drafts', () => {
  const shared = new Map(); const a = { value: {} }, b = { value: {} };
  const first = openTab(shared, a); first.capture(capture('first.person'));
  const second = openTab(shared, b);
  assert.equal(second.read().capture.followers.length, 0);
  second.capture(capture('second.person'));
  assert.equal(openTab(shared, a).read().capture.followers[0].username, 'first.person');
  assert.equal(openTab(shared, b).read().capture.followers[0].username, 'second.person');
  assert.equal(openTab(shared).read().capture.followers.length, 0);
});

test('unavailable tab storage stays memory-only and never falls back to the shared capture', () => {
  const archived = capture('archived.person'); const shared = new Map([[stateKey, { capture: archived }]]);
  const first = openTab(shared, { value: {} }, false);
  first.capture(capture('new.person'));
  assert.equal(first.read().capture.followers[0].username, 'new.person');
  assert.deepEqual(shared.get(stateKey).capture, archived);
  assert.equal(openTab(shared, { value: {} }, false).read().capture.followers.length, 0);
});

test('saving a checker draft preserves unrelated manager-tab fields', () => {
  const shared = new Map(); const tab = { value: { unrelatedManagerField: { marker: 'keep' } } };
  openTab(shared, tab).capture(capture());
  assert.deepEqual(tab.value.unrelatedManagerField, { marker: 'keep' });
  assert.equal(tab.value[tabKey].capture.followers[0].username, 'fixture.person');
});

test('manager tab read timeout falls back blank and a late callback cannot replace it', async () => {
  let callback, timeout, cleared = 0;
  const context = vm.createContext({
    GM_getTab: (done) => { callback = done; }, GM_saveTab() {},
    setTimeout: (fn) => { timeout = fn; return 1; }, clearTimeout: () => { cleared += 1; },
  });
  vm.runInContext(`${readerFunction}; globalThis.read = readManagerTab;`, context);
  const result = context.read(); timeout();
  assert.equal(await result, null);
  callback({ [tabKey]: { capture: capture() } });
  assert.equal(await result, null); assert.equal(cleared, 1);
});

test('manager tab rejection does not stall startup and successful callbacks clear the timeout', async () => {
  for (const rejected of [true, false]) {
    let cleared = 0;
    const context = vm.createContext({
      GM_getTab: (done) => rejected ? Promise.reject(new Error('unavailable')) : done({ marker: 'tab' }), GM_saveTab() {},
      setTimeout: () => 1, clearTimeout: () => { cleared += 1; },
    });
    vm.runInContext(`${readerFunction}; globalThis.read = readManagerTab;`, context);
    const value = await context.read();
    assert.equal(rejected ? value : value.marker, rejected ? null : 'tab');
    assert.equal(cleared, 1);
  }
});
