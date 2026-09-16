import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const [sharedSource, shellSource, inspectorSource, labelsSource] = await Promise.all([
  '../extension/overlay/shared.js', '../userscripts/src/toolbox-shell.js',
  '../extension/content-instagram.js', '../extension/action-labels.js',
].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
const plain = (value) => JSON.parse(JSON.stringify(value));
const normalizeUsername = (value) => String(value || '').replace(/^@/, '').toLowerCase();
const sharedContext = vm.createContext({});
vm.runInContext(sharedSource, sharedContext);
const shared = sharedContext.__instaToolboxOverlayModules.shared;
const shellContext = vm.createContext({
  GM_getValue: (_key, fallback) => fallback,
  InstaToolboxInstagramInspector: { normalizeFollowerDiagnostics: () => ({}) },
});
vm.runInContext(`
  const RESERVED = new Set(), CAPTURE_ACCOUNT_SOURCES = new Set(['authenticated-instagram-web', 'extension-visible-dom']);
  const ACTIONABLE_STATUSES = new Set(), RUN_CAPABILITY_MS = 1200000;
  const STATE_KEY = 'state', LEGACY_QUEUE_KEY = 'queue', TAB_CHECKER_FIELD = 'checker', TAB_RUN_FIELD = 'run';
  ${shellSource.slice(shellSource.indexOf('  const normalizeUsername ='), shellSource.indexOf('  function normalizePreferences('))}
  globalThis.normalize = normalizeAccounts;
  globalThis.restore = (capture) => loadState({ checker: { schemaVersion: 6, capture } }).capture;
`, shellContext);

test('both capture surfaces preserve only exact observed numeric metadata', () => {
  const rows = [
    { username: 'large', instagramId: '123456789012345678901234567890' },
    { username: 'safe', instagramId: 123 },
    ...[9007199254740992, 0, -2, 1.5, '0', '001', '1e3', 'bad', true, {}, '1'.repeat(31)]
      .map((instagramId, index) => ({ username: `invalid${index}`, instagramId })),
    { username: 'local', id: '123' },
    { username: 'legacy' },
  ];
  for (const normalize of [
    (followers) => shared.normalizeCaptureWorkspace({ followers }, normalizeUsername).followers,
    shellContext.normalize,
  ]) {
    const byName = new Map(normalize(rows).map((row) => [row.username, row]));
    assert.equal(byName.get('large').instagramId, rows[0].instagramId);
    assert.equal(byName.get('safe').instagramId, '123');
    for (const [name, row] of byName) if (!['large', 'safe'].includes(name)) {
      assert.equal(Object.hasOwn(row, 'instagramId'), false, name);
    }
  }
});

test('duplicate identity conflicts remain ambiguous after additional rows and reload', () => {
  for (const normalize of [
    (followers) => shared.normalizeCaptureWorkspace({ followers }, normalizeUsername).followers,
    shellContext.normalize,
  ]) {
    const rows = normalize([
      { username: 'conflict', instagramId: '123' }, { username: 'conflict', instagramId: '456' },
      { username: 'conflict', instagramId: '123' }, { username: 'conflict' },
      { username: 'known' }, { username: 'known', instagramId: '789' }, { username: 'known' },
    ]);
    assert.equal(rows[0].instagramIdAmbiguous, true);
    assert.equal(Object.hasOwn(rows[0], 'instagramId'), false);
    assert.equal(rows[1].instagramId, '789');
    assert.deepEqual(plain(normalize(rows)), plain(rows));
  }
});

test('metadata survives capture reload without promoting completeness or provenance', () => {
  const capture = {
    schemaVersion: 6, subjectUsername: 'fixture.owner', subjectInstagramId: '987',
    followers: [{ username: 'one', instagramId: '123', source: 'imported-json' }],
    following: [{ username: 'two', instagramId: '456' }],
    complete: { followers: false, following: true },
    verified: { followers: false, following: true },
    source: { followers: '', following: 'authenticated-web' },
  };
  for (const normalized of [shared.normalizeCaptureWorkspace(capture, normalizeUsername), shellContext.restore(capture)]) {
    assert.equal(normalized.subjectInstagramId, '987');
    assert.equal(normalized.followers[0].instagramId, '123');
    assert.equal(normalized.verified.followers, false);
    assert.equal(normalized.complete.followers, false);
    assert.equal(normalized.source.followers, '');
    assert.notEqual(normalized.followers[0].source, 'authenticated-instagram-web');
    const comparison = shared.compareCaptureWorkspace(normalized, { allowPartial: true });
    assert.deepEqual(plain(comparison.iDoNotFollowBack).map((row) => row.username), ['one']);
    assert.deepEqual(plain(comparison.notFollowingMeBack).map((row) => row.username), ['two']);
  }
  const legacy = shared.normalizeCaptureWorkspace({ ...capture, schemaVersion: 1 }, normalizeUsername);
  assert.deepEqual(plain(legacy.verified), { followers: false, following: false });
  assert.deepEqual(plain(legacy.complete), { followers: false, following: false });
  const imported = shared.normalizeCapture({ listType: 'followers', followers: capture.followers }, normalizeUsername);
  assert.equal(imported.followers[0].instagramId, '123');
  assert.equal(imported.followers[0].source, 'extension-visible-dom');
  assert.equal(Object.hasOwn(imported, 'verified'), false);
});

test('missing and invalid subject IDs remain absent on both surfaces', () => {
  for (const subjectInstagramId of [undefined, 9007199254740992, '0', false, 'bad']) {
    for (const capture of [
      shared.normalizeCaptureWorkspace({ subjectInstagramId }, normalizeUsername),
      shellContext.restore({ subjectInstagramId }),
    ]) assert.equal(Object.hasOwn(capture, 'subjectInstagramId'), false);
  }
});

function inspector() {
  const context = vm.createContext({
    AbortController, URL, clearTimeout, setTimeout, crypto: webcrypto,
    document: { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] },
    location: { origin: 'https://www.instagram.com', pathname: '/fixture.owner/', href: 'https://www.instagram.com/fixture.owner/' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    chrome: { runtime: { onMessage: { addListener() {} } } },
  });
  vm.runInContext(labelsSource, context);
  vm.runInContext(inspectorSource, context);
  return context.InstaToolboxInstagramInspector;
}

test('actual checker retains raw IDs, omits rounded numeric IDs, and keeps partial results unchanged', async () => {
  for (const ownerId of ['777', 9007199254740992]) {
    const rows = [{ username: 'safe', pk: 123 }, { username: 'large', id: '12345678901234567890' },
      { username: 'rounded', pk: 9007199254740992 }, { username: 'legacy' }];
    const result = await inspector().fetchFollowerComparison({
      username: 'fixture.owner', sleepImpl: async () => {},
      fetchImpl: async (input) => {
        const path = new URL(input).pathname;
        const data = path.includes('topsearch') ? { users: [{ user: { pk: ownerId, username: 'fixture.owner' } }] }
          : path.includes('web_profile_info') ? { data: { user: { id: ownerId, username: 'fixture.owner', edge_follow: { count: 4 }, edge_followed_by: { count: 5 } } } }
            : { users: rows };
        return { ok: true, status: 200, json: async () => data };
      },
    });
    assert.equal(result.userId, String(ownerId));
    assert.equal(result.subjectInstagramId, typeof ownerId === 'string' ? ownerId : undefined);
    const found = new Map(result.followers.map((row) => [row.username, row]));
    assert.equal(found.get('safe').instagramId, '123');
    assert.equal(found.get('large').instagramId, '12345678901234567890');
    assert.equal(Object.hasOwn(found.get('rounded'), 'instagramId'), false);
    assert.equal(Object.hasOwn(found.get('legacy'), 'instagramId'), false);
    assert.equal(result.complete.followers, false);
    assert.equal(result.complete.following, true);
    assert.equal(result.reasons.followers, 'count-mismatch');
  }
});
