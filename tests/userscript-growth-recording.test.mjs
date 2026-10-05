import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createGrowthCampaign, dueGrowthUnfollows, recordGrowthOutcome } from '../extension/presence-growth.js';

const source = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const logic = source.slice(source.indexOf('  function growthCampaignKey('),
  source.indexOf('  async function runOneAccount('));

function fixture(account = 'owner') {
  let saved = [createGrowthCampaign({ account: 'owner', targets: ['candidate'],
    delayDays: 7, createdAt: 10, id: 'campaign-1' })];
  let writes = 0;
  const context = vm.createContext({
    normalizeUsername: (value) => String(value || '').toLowerCase(),
    engine: { detectAuthenticatedUsername: () => account },
    GM_getValue: () => saved,
    GM_setValue: (_key, value) => { saved = value; writes += 1; },
    globalThis: { InstaToolboxPresenceGrowth: { recordGrowthOutcome, dueGrowthUnfollows } },
    Date,
  });
  vm.runInContext(logic, context);
  return { context, saved: () => saved, setSaved: (value) => { saved = value; }, writes: () => writes };
}

const run = { growthCampaignId: 'campaign-1', growthAccount: 'owner', action: 'follow' };

test('a verified campaign Follow is recorded for the exact signed-in account', () => {
  const app = fixture();
  app.context.recordVerifiedGrowthAction(run, 'candidate');
  assert.equal(app.writes(), 1);
  assert.ok(Number(app.saved()[0].followed.candidate) > 0);
});

test('an account change or outside target cannot add a campaign follow', () => {
  const switched = fixture('other');
  assert.throws(() => switched.context.recordVerifiedGrowthAction(run, 'candidate'),
    /growth-account-changed/);
  assert.equal(switched.writes(), 0);
  const outside = fixture();
  assert.throws(() => outside.context.recordVerifiedGrowthAction(run, 'stranger'),
    /growth-target-not-recorded/);
  assert.equal(outside.writes(), 0);
});

test('resumed growth runs remain bound to stored exact targets and due dates', () => {
  const app = fixture();
  const base = { ...run, approvedTargets: ['candidate'], queue: ['candidate'] };
  assert.equal(app.context.growthRunStillApproved(base), true);
  assert.equal(app.context.growthRunStillApproved({ ...base, approvedTargets: ['stranger'] }), false);
  assert.equal(app.context.growthRunStillApproved({ ...base, action: 'unfollow' }), false);
  const due = recordGrowthOutcome(app.saved()[0], { action: 'follow', username: 'candidate',
    verifiedAt: Date.now() - 8 * 86_400_000 });
  app.setSaved([due]);
  assert.equal(app.context.growthRunStillApproved({ ...base, action: 'unfollow' }), true);
});
