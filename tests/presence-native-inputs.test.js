import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceNativeInputs } from '../extension/presence-native-inputs.js';
import { compilePlan } from '../src/core/presence.js';

const NOW = Date.parse('2026-09-16T16:00:00Z');
const key = (name) => `iguser-v1-${[...name].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
const viewer = (name = 'demo_owner') => ({ accountVerified: true, accountId: name, accountKey: key(name), identityKind: 'verified-viewer-username', evidence: 'visible-account-picker-and-navigation', restriction: false, usable: false });
const row = (id = '201', username = 'demo_follower') => ({ instagramId: id, username, source: 'authenticated-instagram-web' });
const result = (extra = {}) => ({ username: 'demo_owner', subjectInstagramId: '100', capturedAt: new Date(NOW).toISOString(), source: 'authenticated-instagram-web', followers: [row()], following: [], complete: { followers: true, following: true }, ...extra });
function harness(initial = result()) {
  let currentViewer = viewer();
  let clock = NOW;
  let fetched = initial;
  let options;
  const adapter = createPresenceNativeInputs({
    inspectViewer: () => currentViewer, now: () => clock,
    fetchFollowerComparison: async (value) => { options = value; return typeof fetched === 'function' ? fetched() : fetched; },
  });
  return { adapter, setViewer(value) { currentViewer = value; }, setClock(value) { clock = value; }, setResult(value) { fetched = value; }, get options() { return options; } };
}
const read = (h) => h.adapter.captureComparison({ username: 'demo_owner' });
const prepare = (h, capture, profile = {}) => h.adapter.prepareProductionInputs({ capture, profile });

test('original runtime result binds current own viewer to observed numeric subject without extra requests', async () => {
  const h = harness();
  const capture = await read(h);
  const data = prepare(h, capture);
  assert.equal(data.status, 'ready-for-review');
  assert.equal(data.accountBinding.accountId, '100');
  assert.equal(data.inputs.profile.goal, 'maintain');
  assert.equal(data.executable, false);
  assert.equal(data.live, false);
  assert.deepEqual(data.inputs.history, []);
  assert.equal(data.inputs.candidates[0].followsMe, true);
  assert.equal(data.inputs.candidates[0].relation, 'not-following');
  assert.equal(data.inputs.candidates[0].isPrivate, null);
  assert.equal(compilePlan({ ...data.inputs, now: NOW }).targets.length, 0);
  const explicit = prepare(h, capture, { skipPrivate: false });
  assert.equal(compilePlan({ ...explicit.inputs, now: NOW }).targets.length, 1);
});

test('saved JSON, cloned results, other factory receipts, and forged provenance cannot supply inputs', async () => {
  const h = harness();
  const capture = await read(h);
  for (const value of [result(), JSON.parse(JSON.stringify(capture)), { ...capture, verified: true }, null]) {
    assert.equal(prepare(h, value).reason, 'fresh-runtime-capture-required');
  }
  assert.equal(prepare(harness(), capture).reason, 'fresh-runtime-capture-required');
});

test('viewer absence, switched account, restrictions, or another checked profile does not break checker but cannot mint receipt', async () => {
  for (const currentViewer of [null, { ...viewer(), accountVerified: false }, { ...viewer(), restriction: true }, viewer('demo_other'), { ...viewer(), accountKey: '100' }]) {
    const h = harness(); h.setViewer(currentViewer);
    const capture = await read(h);
    assert.equal(capture.username, 'demo_owner');
    assert.equal(prepare(h, capture).reason, 'fresh-runtime-capture-required');
  }
  const h = harness();
  h.setResult(() => { h.setViewer(viewer('demo_other')); return result(); });
  assert.equal(prepare(h, await read(h)).reason, 'fresh-runtime-capture-required');
});

test('preparation rechecks viewer, expiry, backward clock, supersession and explicit invalidation', async () => {
  const h = harness(); const capture = await read(h);
  h.setViewer(viewer('demo_other'));
  assert.equal(prepare(h, capture).reason, 'viewer-changed-or-unavailable');
  h.setViewer(viewer()); h.setClock(NOW - 1);
  assert.equal(prepare(h, capture).reason, 'capture-expired');
  h.setClock(NOW + 30 * 60_000);
  assert.equal(prepare(h, capture).reason, 'capture-expired');
  h.setClock(NOW); await read(h);
  assert.equal(prepare(h, capture).reason, 'fresh-runtime-capture-required');
  h.setResult(result());
  const fresh = await read(h); h.adapter.invalidate();
  assert.equal(prepare(h, fresh).reason, 'fresh-runtime-capture-required');
});

test('partial followers still support positive membership; partial following absence stays unknown', async () => {
  const h = harness(result({ complete: { followers: false, following: false } }));
  const data = prepare(h, await read(h), { skipPrivate: false });
  assert.equal(data.inputs.candidates[0].followsMe, true);
  assert.equal(data.inputs.candidates[0].followsMeEvidence, 'direct');
  assert.equal(data.inputs.candidates[0].relation, 'unknown');
  assert.equal(compilePlan({ ...data.inputs, now: NOW }).targets.length, 0);
});

test('positive following membership remains following even in partial capture', async () => {
  const h = harness(result({ following: [row()], complete: { followers: false, following: false } }));
  assert.equal(prepare(h, await read(h)).inputs.candidates[0].relation, 'following');
});

test('missing and conflicting observed IDs are omitted, never replaced by usernames', async () => {
  const original = result({ followers: [row(), row('202', 'demo_conflict'), row('203', 'demo_conflict'), { username: 'demo_missing' }], following: [{ username: 'other' }] });
  const h = harness(original);
  const data = prepare(h, await read(h));
  assert.deepEqual(data.inputs.candidates.map((c) => c.targetId), ['201']);
  assert.equal(data.evidence.unresolvedFollowers, 3);
  assert.equal(data.evidence.negativeFollowingEvidence, false);
  assert.equal(data.inputs.candidates[0].relation, 'unknown');
});

test('cross-list ID or username contradictions cannot produce a follow candidate', async () => {
  for (const following of [[row('201', 'demo_renamed')], [row('202', 'demo_follower')]]) {
    const h = harness(result({ following }));
    const data = prepare(h, await read(h));
    assert.equal(data.inputs.candidates.length, 0);
    assert.equal(data.evidence.identityConflicts, 1);
  }
});

test('internal snapshot survives caller edits without promoting them', async () => {
  const h = harness(); const capture = await read(h);
  capture.followers[0].instagramId = '999'; capture.subjectInstagramId = '777';
  const data = prepare(h, capture);
  assert.equal(data.accountBinding.accountId, '100');
  assert.equal(data.inputs.candidates[0].targetId, '201');
  assert.ok(Object.isFrozen(data.inputs.candidates[0]));
});

test('unsupported routines and mismatched profile identities stay unavailable', async () => {
  const h = harness(); const capture = await read(h);
  for (const goal of ['discover', 'curate']) assert.equal(prepare(h, capture, { goal }).reason, 'routine-source-unavailable');
  assert.equal(prepare(h, capture, { accountId: '999' }).reason, 'profile-account-mismatch');
  assert.equal(prepare(h, capture, { username: 'demo_other' }).reason, 'profile-account-mismatch');
});

test('subject ID and capture-time proof are required and injected checker options are stripped', async () => {
  for (const extra of [{ subjectInstagramId: null }, { subjectInstagramId: 'iguser-v1-100' }, { capturedAt: new Date(NOW - 1).toISOString() }, { source: 'import' }]) {
    const h = harness(result(extra));
    assert.equal(prepare(h, await read(h)).reason, 'fresh-runtime-capture-required');
  }
  const h = harness();
  await h.adapter.captureComparison({ username: 'demo_owner', fetchImpl: () => result(), now: () => 1 });
  assert.equal('fetchImpl' in h.options, false);
  assert.equal('now' in h.options, false);
});

test('cancelled or overlapping calls cannot retain an earlier capture receipt', async () => {
  const h = harness(); let finish;
  h.setResult(() => new Promise((resolve) => { finish = resolve; }));
  const first = read(h);
  h.setResult(result()); const second = await read(h);
  finish(result()); const stale = await first;
  assert.equal(prepare(h, stale).reason, 'fresh-runtime-capture-required');
  assert.equal(prepare(h, second).status, 'ready-for-review');
  const controller = new AbortController(); controller.abort();
  const cancelled = await h.adapter.captureComparison({ username: 'demo_owner', signal: controller.signal });
  assert.equal(prepare(h, cancelled).reason, 'fresh-runtime-capture-required');
});
