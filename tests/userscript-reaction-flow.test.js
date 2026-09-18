import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function runDmUnsend()');
const end = source.indexOf('  // --- Section 7:', start);
assert.ok(start > 0 && end > start, 'actual DM handlers must be present');
const handlers = source.slice(start, end);

function fixture(options = {}) {
  let clock = 1_800_000_000_000;
  const calls = { viewers: 0, dm: [], reactions: [], plans: [], reservations: 0,
    dmStops: 0, reactionStops: 0, saves: 0, renders: 0, confirmations: [], statuses: [] };
  const controls = {
    'unsend-scope': { value: 'all' }, 'unsend-count': { value: '3' },
    'unsend-reactions': { checked: options.selected ?? false },
  };
  const inspection = { ready: true, threadId: '12345' };
  const viewer = { accountId: 'fixture_owner', accountVerified: true, usable: true, threadId: '12345' };
  const state = { ledger: { day: 'fixture-day', actions: 4, unsends: 8, reactions: 2 },
    cleanupPreferences: { removeOwnReactions: true } };
  const context = vm.createContext({
    fixtureInboxPanel: options.inboxPanel || null,
    AbortController, Date: class extends Date { static now() { return clock; } },
    DM_PLAN_CAPABILITY_MS: 900_000, state,
    dmRunner: {
      snapshot: () => ({ status: 'idle', canStop: false }), inspect: () => ({ ...inspection }),
      createPlan: (plan) => Object.freeze({ ...plan, reviewedDigest: 'fixture-reviewed-digest' }),
      start: async (args) => { calls.dm.push(args); return options.dmStart
        ? options.dmStart(args, api) : { status: options.dmStatus || 'completed', processed: 0 }; },
      stop: () => { calls.dmStops += 1; return true; },
    },
    reactionCleanup: {
      start: async (args) => { calls.reactions.push(args); return options.reactionStart
        ? options.reactionStart(args, api) : { status: 'completed', removed: 0 }; },
      stop: () => { calls.reactionStops += 1; return true; },
    },
    cleanupSettings: { capabilities: () => ({ reactions: options.supported === true }) },
    InstaToolboxInstagramViewer: { inspect: () => { calls.viewers += 1; return { ...viewer }; } },
    InstaToolboxOwnReactions: { createPlan: (value) => {
      const plan = Object.freeze({ ...value }); calls.plans.push(plan); return plan;
    } },
    confirmationController: { isPending: () => false },
    query: (selector) => controls[selector.match(/data-role="([^"]+)"/)?.[1]],
    confirmRun: async (request) => {
      calls.confirmations.push(request);
      if (options.confirm) return options.confirm(request, api);
      return options.cancel ? null : { ...request.binding };
    },
    reserveUnsendPlan: () => { calls.reservations += 1; return { ok: true, minDelayMs: 1000, maxDelayMs: 2000 }; },
    recordVerifiedUnsend: () => {},
    finalizeUnsendOutcome: (_plan, result) => options.finalize?.(result, api),
    renderDmSummary: () => { calls.renders += 1; },
    status: (...args) => calls.statuses.push(args),
    today: () => 'fixture-day', saveState: async () => { calls.saves += 1; },
  });
  vm.runInContext(`let dmThreadPreview = null, reactionSnapshot = null, inboxPanel = fixtureInboxPanel;
    let dmCleanupController = null, activeUnsendCapability = {};
    ${handlers}
    globalThis.flow = { run: runDmUnsend, stop: stopDmCleanup,
      active: () => dmCleanupController !== null,
      capability: () => activeUnsendCapability };`, context);
  const api = { ...context.flow, calls, controls, viewer, inspection, state,
    advance: (ms) => { clock += ms; } };
  return api;
}

test('ordinary Unsend has no viewer dependency and no reaction pass', async () => {
  const f = fixture({ supported: true });
  await f.run();
  assert.equal(f.calls.dm.length, 1);
  assert.equal(f.calls.viewers, 0);
  assert.equal(f.calls.plans.length, 0);
  assert.equal(f.calls.reactions.length, 0);
  assert.equal(f.calls.dm[0].plan.scope, 'all');
  assert.equal(f.calls.dm[0].minDelayMs, 1000);
  assert.equal(f.active(), false);
  assert.equal(f.capability(), null);
});

test('the primary Stop button stops an active inbox cleanup instead of starting another run', async () => {
  let stopped = 0;
  const f = fixture({ inboxPanel: { busy: () => true, stop: () => { stopped += 1; } } });
  await f.run();
  assert.equal(stopped, 1);
  assert.equal(f.calls.dm.length, 0);
  assert.equal(f.calls.confirmations.length, 0);
  assert.equal(f.calls.reservations, 0);
});

test('unsupported saved preferences or a forged checked control cannot enable reactions', async () => {
  const f = fixture({ supported: false, selected: true });
  await f.run();
  assert.equal(f.calls.dm.length, 1);
  assert.equal(f.calls.viewers, 0);
  assert.equal(f.calls.plans.length, 0);
  assert.equal(f.calls.reactions.length, 0);
  assert.equal(f.calls.confirmations[0].binding.removeReactions, false);
});

test('selected reaction approval binds account, exact thread, and original expiry', async () => {
  const f = fixture({ supported: true, selected: true });
  await f.run();
  const request = f.calls.confirmations[0], dmPlan = f.calls.dm[0].plan;
  assert.equal(request.binding.reactionAccount, 'fixture_owner');
  assert.equal(request.binding.removeReactions, true);
  assert.equal(request.binding.threadId, '12345');
  assert.equal(request.binding.expiresAt, dmPlan.expiresAt);
  assert.equal(f.calls.plans[0].accountUsername, 'fixture_owner');
  assert.equal(f.calls.plans[0].threadId, dmPlan.threadId);
  assert.equal(f.calls.plans[0].expiresAt, dmPlan.expiresAt);
  assert.equal(f.calls.reactions[0].plan, f.calls.plans[0]);
  assert.match(request.detail, /Then remove your reactions/);
});

test('Cancel dispatches neither Unsend nor reactions and reserves nothing', async () => {
  const f = fixture({ supported: true, selected: true, cancel: true });
  await f.run();
  assert.equal(f.calls.dm.length, 0);
  assert.equal(f.calls.reactions.length, 0);
  assert.equal(f.calls.reservations, 0);
  assert.equal(f.calls.saves, 0);
  assert.match(f.calls.statuses[0][0], /Canceled/);
});

test('changed account, thread, expiry, or reaction choice invalidates confirmation', async () => {
  for (const change of ['account', 'thread', 'expiry', 'choice', 'forged-account']) {
    const f = fixture({ supported: true, selected: true, confirm(request, api) {
      const response = { ...request.binding };
      if (change === 'account') api.viewer.accountId = 'another_owner';
      if (change === 'thread') api.inspection.threadId = '67890';
      if (change === 'expiry') api.advance(900_001);
      if (change === 'choice') api.controls['unsend-reactions'].checked = false;
      if (change === 'forged-account') response.reactionAccount = 'another_owner';
      return response;
    } });
    await f.run();
    assert.equal(f.calls.dm.length, 0, change);
    assert.equal(f.calls.reactions.length, 0, change);
    assert.equal(f.calls.reservations, 0, change);
  }
});

test('uncertain, stopped, failed, and interrupted DM outcomes never launch reactions', async () => {
  for (const dmStatus of ['uncertain', 'stopped', 'error', 'needs-attention']) {
    const f = fixture({ supported: true, selected: true, dmStatus });
    await f.run();
    assert.equal(f.calls.dm.length, 1, dmStatus);
    assert.equal(f.calls.reactions.length, 0, dmStatus);
    assert.equal(f.active(), false, dmStatus);
  }
});

test('reaction viewer proof must still be usable and thread-bound after confirmation', async () => {
  for (const changed of ['accountVerified', 'usable', 'threadId', 'restriction']) {
    const f = fixture({ supported: true, selected: true, confirm(request, api) {
      api.viewer[changed] = changed === 'threadId' ? '67890' : changed === 'restriction';
      return { ...request.binding };
    } });
    await f.run();
    assert.equal(f.calls.dm.length, 0, changed);
    assert.equal(f.calls.reactions.length, 0, changed);
    assert.equal(f.calls.reservations, 0, changed);
  }
});

test('Stop during the completed-DM handoff prevents the reaction pass', async () => {
  const f = fixture({ supported: true, selected: true, finalize(_outcome, api) {
    assert.equal(api.stop(), true);
  } });
  await f.run();
  assert.equal(f.calls.dm.length, 1);
  assert.equal(f.calls.reactions.length, 0);
  assert.equal(f.calls.dmStops, 1);
  assert.equal(f.calls.reactionStops, 1);
  assert.equal(f.active(), false);
});

test('Stop during reactions forwards cancellation and does not start another Unsend', async () => {
  const f = fixture({ supported: true, selected: true, async reactionStart(args, api) {
    assert.equal(args.signal.aborted, false);
    assert.equal(api.stop(), true);
    assert.equal(args.signal.aborted, true);
    return { status: 'stopped', removed: 0 };
  } });
  await f.run();
  assert.equal(f.calls.dm.length, 1);
  assert.equal(f.calls.reactions.length, 1);
  assert.equal(f.calls.dmStops, 1);
  assert.equal(f.calls.reactionStops, 1);
  assert.equal(f.stop(), false);
});

test('reaction totals persist separately and repeated counters are not counted twice', async () => {
  const f = fixture({ supported: true, selected: true, async reactionStart(args) {
    await args.onVerifiedRemoval({ removed: 1 });
    await args.onVerifiedRemoval({ removed: 1 });
    await args.onVerifiedRemoval({ removed: 2 });
    return { status: 'completed', removed: 2 };
  } });
  await f.run();
  assert.equal(f.state.ledger.reactions, 4);
  assert.equal(f.state.ledger.unsends, 8);
  assert.equal(f.state.ledger.actions, 4);
  assert.equal(f.calls.saves, 2);
});
