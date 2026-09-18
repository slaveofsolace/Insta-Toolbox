import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { compilePlan, createPreviewSession } from '../src/core/presence.js';
import { createPresenceBatchDraft, PRESENCE_BATCH_CAPABILITIES } from '../extension/presence-batch-review.js';

const NOW = Date.parse('2026-09-16T16:00:00Z');
const profile = (extra = {}) => ({ accountId: '100', username: 'demo_owner', timezone: 'America/Chicago', topics: ['photography'], ...extra });
const candidate = (extra = {}) => ({ accountId: '100', targetId: '201', username: 'demo_creator', relation: 'not-following', source: 'manual', isPrivate: false, observedAt: NOW, topics: ['photography'], ...extra });
function input(extra = {}) {
  return { profile: profile(), candidates: [candidate()], history: [], usage: {}, ...extra };
}
function draft(current = input(), options = {}) {
  return createPresenceBatchDraft({
    reviewedPlan: compilePlan({ ...current, now: NOW }), current,
    selectedTargetIds: ['201'], now: NOW, ...options,
  });
}

test('maps finite targets to existing queue and account batch review shapes without authority', () => {
  const result = draft();
  assert.equal(result.status, 'review-required');
  assert.equal(result.executable, false);
  assert.equal(result.capabilities.live, false);
  assert.equal(result.liveUnavailableReason, 'presence-trusted-runtime-required');
  assert.deepEqual(result.confirmationDraft, {
    kind: 'account', action: 'follow',
    items: [{ id: 'presence-follow-201-0', username: 'demo_creator' }],
    description: '1 reviewed follow target. Nothing has run.',
  });
  assert.deepEqual(result.bindings, [{ accountId: '100', targetId: '201', username: 'demo_creator', action: 'follow' }]);
  assert.deepEqual(result.queueDraft.selected, ['demo_creator']);
  assert.equal(result.queueDraft.signature, JSON.stringify({ action: 'follow', requested: 1, selected: ['demo_creator'], source: 'presence', partial: false }));
  assert.ok(Object.isFrozen(result.queueDraft.selected));
  assert.ok(Object.isFrozen(result.confirmationDraft.items[0]));
  assert.equal('confirmed' in result.confirmationDraft, false);
  assert.equal('confirmation' in result.confirmationDraft, false);
  assert.equal('jobId' in result.confirmationDraft, false);
});

test('preserves planner order and accepts only an exact finite subset', () => {
  const current = input({ candidates: [candidate(), candidate({ targetId: '202', username: 'demo_second' }), candidate({ targetId: '203', username: 'demo_third' })] });
  const result = draft(current, { selectedTargetIds: ['203', '201'] });
  assert.deepEqual(result.queueDraft.selected, ['demo_creator', 'demo_third']);
  assert.equal(result.queueDraft.omitted, 1);
  for (const selectedTargetIds of [[], ['201', '201'], ['201', '999'], [201], ['iguser-v1-64656d6f']]) {
    assert.equal(draft(current, { selectedTargetIds }).status, 'unavailable');
  }
});

test('rejects expired, future, widened and invalid plan lifetimes without renewing them', () => {
  const current = input();
  const reviewedPlan = compilePlan({ ...current, now: NOW });
  for (const now of [NOW - 1, reviewedPlan.expiresAt, reviewedPlan.expiresAt + 1]) {
    assert.equal(draft(current, { reviewedPlan, now }).reason, 'review-expired');
  }
  assert.equal(draft(current, { now: NOW + 1 }).expiresAt, reviewedPlan.expiresAt);
  assert.equal(draft(current, { reviewedPlan: { ...reviewedPlan, expiresAt: NOW + 16 * 60_000 } }).reason, 'invalid-review-lifetime');
  assert.throws(() => draft(current, { now: NaN }));
});

test('fresh account, routine, protection, relationship and username drift invalidates review', () => {
  const original = input();
  const reviewedPlan = compilePlan({ ...original, now: NOW });
  for (const current of [
    input({ profile: profile({ accountId: '999' }) }),
    input({ profile: profile({ followLimit: 1 }) }),
    input({ profile: profile({ protectedIds: ['201'] }) }),
    input({ candidates: [candidate({ relation: 'following' })] }),
    input({ candidates: [candidate({ relation: 'requested' })] }),
    input({ candidates: [candidate({ username: 'demo_renamed' })] }),
    input({ usage: { follow: 12 } }),
    input({ candidates: [candidate({ observedAt: NOW - 31 * 60_000 })] }),
  ]) assert.equal(draft(current, { reviewedPlan }).status, 'unavailable');
});

test('does not silently add newly discovered targets after review', () => {
  const reviewedPlan = compilePlan({ ...input(), now: NOW });
  const current = input({ candidates: [candidate(), candidate({ targetId: '202', username: 'demo_second' })] });
  assert.equal(draft(current, { reviewedPlan }).reason, 'targets-changed');
});

test('planner-held accounts stay out and their reasons remain visible', () => {
  const current = input({ candidates: [candidate(), candidate({ targetId: '202', username: 'demo_protected', relation: 'requested' })] });
  const result = draft(current);
  assert.equal(result.queueDraft.skipped.length, 1);
  assert.equal(result.queueDraft.skipped[0].count, 1);
  assert.equal(result.confirmationDraft.items.length, 1);
  assert.equal(draft(current, { selectedTargetIds: ['202'] }).reason, 'selection-outside-review');
});

test('unfollow planning history stays metadata and partial negative evidence stays held', () => {
  const current = input({
    profile: profile({ goal: 'curate' }),
    candidates: [candidate({ relation: 'following', followsMe: false, followsMeEvidence: 'direct' })],
    history: [{ accountId: '100', targetId: '201', followedAt: NOW - 8 * 86_400_000, origin: 'presence', outcome: 'verified' }],
  });
  const result = draft(current);
  assert.equal(result.confirmationDraft.action, 'unfollow');
  assert.equal(result.executable, false);
  assert.equal(result.capabilities.live, false);
  for (const followsMeEvidence of ['partial-list', 'unknown']) {
    assert.equal(draft({ ...current, candidates: [candidate({ relation: 'following', followsMe: false, followsMeEvidence })] }).status, 'unavailable');
  }
});

test('does not mistake a copied plan or completed simulation for permission', () => {
  const current = input();
  const plan = compilePlan({ ...current, now: NOW });
  const preview = createPreviewSession(plan, () => NOW);
  preview.dispatch('review', { accountId: '100' });
  preview.dispatch('start');
  const simulated = preview.dispatch('step');
  assert.equal(simulated.state, 'simulated');
  assert.equal(draft(current, { reviewedPlan: simulated }).reason, 'presence-review-required');
  const copied = draft(current, { reviewedPlan: JSON.parse(JSON.stringify(plan)) });
  assert.equal(copied.status, 'review-required');
  assert.equal(copied.executable, false);
  assert.equal('authority' in copied, false);
  assert.deepEqual(PRESENCE_BATCH_CAPABILITIES, { reviewDraft: true, live: false, scheduledExecution: false });
});

test('rejects invented username identities and malformed records', () => {
  assert.throws(() => draft(input({ profile: profile({ accountId: 'iguser-v1-64656d6f' }) })));
  assert.throws(() => createPresenceBatchDraft({ reviewedPlan: Object.create({}), current: input(), selectedTargetIds: ['201'], now: NOW }));
  assert.equal(draft(input(), { reviewedPlan: { ...compilePlan({ ...input(), now: NOW }), executable: true } }).reason, 'presence-review-required');
});

test('batch review compatibility uses the actual confirmation UI and Cancel sends no start', async () => {
  const modules = { shared: { install(name, value) { modules[name] = value; } } };
  const context = vm.createContext({ __instaToolboxOverlayModules: modules, setTimeout, clearTimeout, Date });
  vm.runInContext(await readFile(new URL('../extension/overlay/batch.js', import.meta.url), 'utf8'), context);
  const requests = [];
  let confirmation;
  const runtime = {
    query: () => null, status() {},
    async sendBridge(request) { requests.push(request.kind); return { run: null }; },
    async confirmAction(value) { confirmation = value; return null; },
  };
  const result = await modules.batch.start(runtime, draft().confirmationDraft);
  assert.equal(result, false);
  assert.deepEqual(requests, ['insta-toolbox-batch-status']);
  assert.equal(confirmation.title, 'Follow 1 account?');
  assert.deepEqual([...confirmation.items], ['@demo_creator']);
  assert.equal(confirmation.binding.kind, 'account');
  assert.equal(confirmation.binding.count, 1);
});
