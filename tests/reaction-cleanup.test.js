import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const planSource = await readFile(new URL('../extension/own-reactions.js', import.meta.url), 'utf8');
const passSource = await readFile(new URL('../extension/reaction-cleanup.js', import.meta.url), 'utf8');

function fixture({ steps, remove, next, assertCurrent = () => true,
  limit = null, expiresAt = Date.now() + 10_000 } = {}) {
  const context = vm.createContext({ Date, Set, Map, WeakMap, WeakSet, Object,
    AbortController, DOMException, setTimeout, clearTimeout });
  vm.runInContext(planSource, context); vm.runInContext(passSource, context);
  const plans = context.InstaToolboxOwnReactions;
  const rows = steps || [{ isConnected: true, reactions: [{}] }];
  let at = 0, closed = 0, dispatches = 0;
  const live = { threadId: '12345', accountId: 'fixture_viewer', accountVerified: true, usable: true };
  const plan = plans.createPlan({ threadId: live.threadId, accountUsername: live.accountId, expiresAt, limit });
  const pass = context.InstaToolboxReactionCleanup.create({
    inspectContext: () => live,
    createWalker: () => ({
      assertCurrent,
      next: async () => next ? next() : at < rows.length
        ? { done: false, value: { row: rows[at++] } } : { done: true, reason: 'exhausted' },
      close() { closed += 1; },
    }),
    reactions: { ...plans, create: ({ assertAuthorized }) => ({
      badges: (row) => row.reactions,
      remove: async (target) => {
        assert.equal(assertAuthorized(), true); dispatches += 1;
        return remove ? remove(target, assertAuthorized) : { verified: true, removed: 1 };
      },
    }) },
  });
  return { pass, plan, live, plans, closed: () => closed, dispatches: () => dispatches };
}

test('reaction pass visits surviving received messages and records reactions separately', async () => {
  const f = fixture(); const records = [];
  const result = await f.pass.start({ plan: f.plan, onVerifiedRemoval: (record) => records.push(record) });
  assert.equal(result.status, 'completed'); assert.equal(result.complete, true);
  assert.equal(result.removed, 1); assert.equal(result.checked, 1);
  assert.equal(records.length, 1); assert.equal(records[0].removed, 1);
  assert.equal(f.closed(), 1); assert.equal(f.dispatches(), 1);
});

test('a finite reaction selection does not claim to have checked the entire conversation', async () => {
  const f = fixture({ limit: 1, steps: [{ isConnected: true, reactions: [{}, {}] }] });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.removed, 1); assert.equal(result.complete, false); assert.equal(f.dispatches(), 1);
});

test('unknown reaction ownership is skipped rather than reported removed', async () => {
  const f = fixture({ remove: async () => ({ skipped: true, reason: 'not-my-reaction' }) });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.removed, 0); assert.equal(result.skipped, 1); assert.equal(result.status, 'completed');
});

test('uncertain reaction removal stops without advancing or retrying', async () => {
  const f = fixture({ remove: async () => { throw Object.assign(new Error('uncertain'), { code: 'REACTION_OUTCOME_UNCERTAIN' }); } });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.status, 'needs-attention'); assert.equal(result.uncertain, 1);
  assert.equal(result.removed, 0); assert.equal(f.dispatches(), 1); assert.equal(f.closed(), 1);
  await assert.rejects(f.pass.start({ plan: f.plan }), /review-required/);
});

test('Stop after dispatch retains the verified result and prevents the next reaction', async () => {
  let f;
  f = fixture({ steps: [{ isConnected: true, reactions: [{}, {}] }], remove: async () => {
    assert.equal(f.pass.stop(), true); return { verified: true, removed: 1 };
  } });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.status, 'stopped'); assert.equal(result.removed, 1); assert.equal(f.dispatches(), 1);
});

test('checkpoint failure preserves the real count without another mutation', async () => {
  const f = fixture();
  const result = await f.pass.start({ plan: f.plan, onVerifiedRemoval() { throw new Error('disk'); } });
  assert.equal(result.status, 'needs-attention'); assert.equal(result.reason, 'reaction-checkpoint-failed');
  assert.equal(result.removed, 1); assert.equal(result.uncertain, 0); assert.equal(f.dispatches(), 1);
});

test('a proven removal stays counted when the native reaction list cannot close', async () => {
  const records = [];
  const f = fixture({ steps: [{ isConnected: true, reactions: [{}, {}] }],
    remove: async () => ({ verified: true, removed: 1, needsAttention: true,
      reason: 'reaction-dialog-close-unavailable' }) });
  const result = await f.pass.start({ plan: f.plan, onVerifiedRemoval: (value) => records.push(value) });
  assert.equal(result.status, 'needs-attention'); assert.equal(result.removed, 1);
  assert.equal(result.uncertain, 0); assert.equal(result.complete, false);
  assert.equal(result.reason, 'reaction-dialog-close-unavailable');
  assert.equal(records.length, 1); assert.equal(records[0].removed, 1);
  assert.equal(f.dispatches(), 1); assert.equal(f.closed(), 1);
});

test('wrong account and copied plans cannot start a reaction pass', async () => {
  const f = fixture();
  await assert.rejects(f.pass.start({ plan: { ...f.plan } }), /review-required/);
  f.live.accountId = 'different_viewer';
  await assert.rejects(f.pass.start({ plan: f.plan }), /context-changed/);
  assert.equal(f.dispatches(), 0);
});

test('thread drift after traversal stops before the next reaction control', async () => {
  let f;
  f = fixture({ next: async () => {
    f.live.threadId = '99999'; return { done: false, value: { isConnected: true, reactions: [{}] } };
  } });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.status, 'needs-attention'); assert.equal(f.dispatches(), 0); assert.equal(f.closed(), 1);
});

test('aborted and interrupted passes never call an incomplete walk fully complete', async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  const result = await f.pass.start({ plan: f.plan, signal: abort.signal });
  assert.equal(result.status, 'stopped'); assert.equal(result.complete, false); assert.equal(f.dispatches(), 0);
  const stopped = fixture({ next: async () => ({ done: true, reason: 'step-limit' }) });
  const partial = await stopped.pass.start({ plan: stopped.plan });
  assert.equal(partial.status, 'needs-attention'); assert.equal(partial.complete, false);
});

test('concurrent reaction passes do not consume a second plan', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ next: async () => { await gate; return { done: true, reason: 'exhausted' }; } });
  const running = f.pass.start({ plan: f.plan });
  const another = f.plans.createPlan({ ...f.plan });
  await assert.rejects(f.pass.start({ plan: another }), /cleanup-active/);
  release(); await running;
  assert.equal(f.plans.validatePlan(another, f.plan.threadId, f.plan.accountUsername), true);
});

test('stable-exhaustion from the real walker is a completed reaction pass', async () => {
  const f = fixture({ next: async () => ({ done: true, reason: 'stable-exhaustion' }) });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.status, 'completed'); assert.equal(result.complete, true);
});

test('a revoked walker cannot authorize a reaction after an asynchronous wait', async () => {
  let revoked = false;
  const f = fixture({
    next: async () => { revoked = true; return { done: false, value: { isConnected: true, reactions: [{}] } }; },
    assertCurrent() { if (revoked) throw new Error('page-frozen'); return true; },
  });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.status, 'needs-attention'); assert.equal(result.reason, 'page-frozen');
  assert.equal(f.dispatches(), 0); assert.equal(f.closed(), 1);
});

test('done without a proven exhaustion reason is not a complete traversal', async () => {
  const f = fixture({ next: async () => ({ done: true }) });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.status, 'needs-attention'); assert.equal(result.complete, false);
});

test('freeze during reaction readiness revokes the native click, not just the next row', async () => {
  let frozen = false, mutations = 0;
  const f = fixture({
    assertCurrent() { if (frozen) throw new Error('page-frozen'); return true; },
    async remove(_target, assertAuthorized) {
      await Promise.resolve(); frozen = true;
      assertAuthorized(); mutations += 1;
      return { verified: true, removed: 1 };
    },
  });
  const result = await f.pass.start({ plan: f.plan });
  assert.equal(result.status, 'needs-attention'); assert.equal(result.removed, 0);
  assert.equal(mutations, 0);
});
