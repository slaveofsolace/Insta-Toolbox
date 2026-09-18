import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeProfile, normalizeHandle, activeNow, compilePlan, createPreviewSession, modeHandoff, PRESENCE_CAPABILITIES } from '../src/core/presence.js';

const NOW = Date.parse('2026-09-16T16:00:00Z');
const DAY = 86_400_000;
const profile = (patch = {}) => ({ accountId: '100', username: 'demo_owner', timezone: 'America/Chicago', topics: ['photography'], ...patch });
const candidate = (patch = {}) => ({ accountId: '100', targetId: '201', username: 'demo_creator', relation: 'not-following', source: 'manual', isPrivate: false, observedAt: NOW, topics: ['photography'], ...patch });
const history = (patch = {}) => ({ accountId: '100', targetId: '201', followedAt: NOW - 8 * DAY, origin: 'presence', outcome: 'verified', ...patch });
const plan = (options = {}) => compilePlan({ profile: profile(), candidates: [candidate()], now: NOW, ...options });
const followup = (c = {}, h = {}, p = {}) => plan({ profile: profile({ goal: 'curate', ...p }), candidates: [candidate({ relation: 'following', followsMe: false, followsMeEvidence: 'direct', ...c })], history: [history(h)] });

test('normalizes handles without accepting URLs or routes', () => {
  assert.equal(normalizeHandle(' @Demo.Owner '), 'demo.owner');
  for (const x of ['direct', 'https://example.com', '', '<script>', 'a/b']) assert.throws(() => normalizeHandle(x));
});
test('imports cannot enable live actions or bypass review', () => {
  const p = normalizeProfile(profile({ liveEnabled: true, reviewRequired: false, keepMutuals: false, password: true }));
  assert.equal(p.liveEnabled, false); assert.equal(p.reviewRequired, true); assert.equal(p.keepMutuals, true);
  assert.equal('password' in p, false); assert.ok(Object.isFrozen(p.topics));
});
test('rejects unsupported profile versions and invalid IDs', () => {
  assert.throws(() => normalizeProfile(profile({ version: 99 })));
  for (const id of [100, '', '0', '-1', 'not-a-number']) assert.throws(() => normalizeProfile(profile({ accountId: id })));
});
test('rejects invalid settings rather than silently expanding scope', () => {
  for (const patch of [{followLimit:-1}, {unfollowLimit:51}, {waitDays:0}, {followLimit:'12'}, {skipPrivate:'false'}, {goal:'all'}, {timezone:'invalid/zone'}, {window:{start:1,end:1}}]) {
    assert.throws(() => normalizeProfile(profile(patch)));
  }
});
test('rejects prototype-backed records', () => {
  assert.throws(() => normalizeProfile(Object.create(profile())));
  assert.throws(() => plan({ candidates: [Object.create(candidate())] }));
});
test('honors daytime local window and excludes end boundary', () => {
  const p = profile();
  assert.equal(activeNow(p, Date.parse('2026-09-16T14:00:00Z')), true);
  assert.equal(activeNow(p, Date.parse('2026-09-17T01:00:00Z')), false);
});
test('handles an overnight local window', () => {
  const p = profile({ window: { start: 1320, end: 360 } });
  assert.equal(activeNow(p, Date.parse('2026-09-17T04:00:00Z')), true);
  assert.equal(activeNow(p, NOW), false);
});
test('uses time-zone DST offsets instead of a fixed UTC offset', () => {
  const p = profile();
  assert.equal(activeNow(p, Date.parse('2026-01-16T14:30:00Z')), false);
  assert.equal(activeNow(p, Date.parse('2026-07-16T14:30:00Z')), true);
});
test('plans a finite interest-matched follow with an explanation', () => {
  const p = plan(); assert.equal(p.targets.length, 1); assert.equal(p.targets[0].action, 'follow');
  assert.match(p.targets[0].reason, /photography/); assert.equal(p.executable, false);
});
test('never passes arbitrary candidate fields to the plan', () => {
  const p = plan({ candidates: [candidate({ cookie: 'not-allowed', confirmed: true, execute: true })] });
  assert.equal(JSON.stringify(p).includes('not-allowed'), false);
});
test('deduplicates conservatively and holds conflicting account identities', () => {
  const p = plan({ candidates: [candidate(), candidate({ username: 'renamed' })] });
  assert.equal(p.targets.length, 0); assert.ok(p.decisions.every((x) => x.state === 'held'));
  assert.equal(plan({ candidates: [candidate(), candidate({ targetId: '202' })] }).targets.length, 0);
});
test('never mixes observations from another account', () => {
  assert.equal(plan({ candidates: [candidate({ accountId: '999' })] }).targets.length, 0);
});
test('protects self and keep-list accounts', () => {
  for (const c of [{ targetId: '100' }, { username: 'demo_owner' }]) assert.equal(plan({ candidates: [candidate(c)] }).decisions[0].state, 'protected');
  assert.equal(plan({profile:profile({protectedIds:['201']})}).decisions[0].state, 'protected');
});
test('holds stale and future observations', () => {
  for (const observedAt of [NOW + 1, NOW - 31*60_000]) assert.match(plan({ candidates:[candidate({observedAt})] }).decisions[0].reason, /Refresh/);
});
test('does not fill missing privacy evidence with false', () => {
  for (const isPrivate of [true, null]) assert.equal(plan({ candidates:[candidate({isPrivate})] }).targets.length, 0);
});
test('can review private candidates only with an explicit preference', () => {
  assert.equal(plan({ profile:profile({skipPrivate:false}), candidates:[candidate({isPrivate:true})] }).targets.length,1);
});
test('excludes unwanted topics and unmatched targets', () => {
  assert.equal(plan({profile:profile({excludedTopics:['photography']})}).targets.length,0);
  assert.equal(plan({candidates:[candidate({topics:['cooking']})]}).targets.length,0);
});
test('Stay connected requires positive follow-back evidence', () => {
  assert.equal(plan({profile:profile({goal:'maintain'})}).targets.length,0);
  assert.equal(plan({profile:profile({goal:'maintain'}), candidates:[candidate({followsMe:true,followsMeEvidence:'direct'})]}).targets.length,1);
});
test('rejects follow cycling and preserves pending requests', () => {
  assert.equal(plan({history:[history()]}).decisions[0].state,'protected');
  assert.equal(plan({candidates:[candidate({relation:'requested'})]}).decisions[0].state,'protected');
});
test('waits seven elapsed days from verified follow, not discovery', () => {
  assert.equal(followup({}, {followedAt:NOW-7*DAY+1}).decisions[0].state,'waiting');
  assert.equal(followup({}, {followedAt:NOW-7*DAY}).targets[0].action,'unfollow');
});
test('only revisits unique verified Presence-managed follows', () => {
  for (const h of [{origin:'legacy'}, {outcome:'uncertain'}, {accountId:'999'}]) assert.equal(followup({},h).targets.length,0);
  assert.equal(followup({}, {followedAt:NOW+1}).targets.length,0);
});
test('duplicate managed histories cannot authorize an unfollow suggestion', () => {
  assert.equal(plan({profile:profile({goal:'curate'}), candidates:[candidate({relation:'following',followsMe:false,followsMeEvidence:'direct'})], history:[history(), history()]}).targets.length,0);
});
test('keeps mutuals and does not infer non-mutual from a partial list', () => {
  assert.equal(followup({followsMe:true}).decisions[0].state,'protected');
  for (const followsMeEvidence of ['partial-list','unknown']) assert.equal(followup({followsMeEvidence}).decisions[0].state,'held');
  assert.equal(followup({followsMe:null}).decisions[0].state,'held');
});
test('complete-list negative evidence remains reviewable', () => {
  assert.equal(followup({followsMeEvidence:'complete-list'}).targets.length,1);
});
test('honors limits, recorded usage, and an explicit zero allowance', () => {
  assert.equal(plan({profile:profile({followLimit:0})}).targets.length,0);
  assert.equal(plan({usage:{follow:12}}).targets.length,0);
  assert.equal(followup({}, {}, {unfollowLimit:0}).targets.length,0);
});
test('holds rather than scheduling outside the active window', () => {
  assert.match(plan({profile:profile({window:{start:0,end:1}})}).decisions[0].reason,/Outside/);
});
test('ranks deterministically with stable ID tie-breaks', () => {
  const a = candidate({targetId:'203', username:'demo_c'}); const b = candidate({targetId:'202',username:'demo_b'});
  assert.deepEqual(plan({candidates:[a,b]}).targets,plan({candidates:[b,a]}).targets);
});
test('has input size bounds and frozen results', () => {
  assert.throws(() => plan({candidates:Array(2001).fill(candidate())}));
  assert.throws(() => { plan().targets.push(candidate()); });
});
test('preview needs review and never counts simulated work as actual activity', () => {
  const s = createPreviewSession(plan(),()=>NOW);
  assert.throws(()=>s.dispatch('start')); assert.throws(()=>s.dispatch('review', {}));
});
test('full preview path exposes only simulated outcomes', () => {
  const s=createPreviewSession(plan(),()=>NOW);
  s.dispatch('review',{accountId:'100'}); s.dispatch('start');
  const result=s.dispatch('step'); assert.equal(result.state,'simulated'); assert.equal(result.live,false);
  assert.equal(result.results[0].outcome,'simulated');
  assert.equal(s.dispatch('step').simulated,1);
});
test('pause/resume does not automatically restart processing', () => {
  const s=createPreviewSession(plan(),()=>NOW); s.dispatch('review',{accountId:'100'}); s.dispatch('start'); s.dispatch('pause');
  assert.throws(()=>s.dispatch('step')); s.dispatch('resume',{accountId:'100'}); assert.equal(s.snapshot().state,'ready');
});
test('Stop and account switching are terminal', () => {
  for (const context of [{accountId:'999'}, {restriction:'uncertain'}]) {
    const s=createPreviewSession(plan(),()=>NOW); assert.equal(s.dispatch('review',context).state,'stopped');
    assert.equal(s.dispatch('start').state,'stopped');
  }
  const s=createPreviewSession(plan(),()=>NOW); s.dispatch('stop'); assert.equal(s.dispatch('start').state,'stopped');
});
test('expiry and a backward clock never resume authorization', () => {
  for(const clock of [NOW-1,NOW+15*60_000]) assert.equal(createPreviewSession(plan(),()=>clock).dispatch('review').state,'expired');
});
test('Ghost request pauses but does not call a cleanup executor', () => {
  const s=createPreviewSession(plan(),()=>NOW); assert.equal(s.dispatch('ghost').state,'paused');
  assert.equal(s.snapshot().simulated,0);
});
test('mode handoff requires settlement and reconciliation', () => {
  assert.equal(modeHandoff({current:'presence',next:'ghost',inFlight:true}).ready,false);
  assert.equal(modeHandoff({current:'ghost',next:'presence',uncertain:true}).ready,false);
  assert.equal(modeHandoff({current:'ghost',next:'presence'}).requiresFreshReview,true);
  assert.throws(()=>modeHandoff({current:'anything',next:'presence'}));
});
test('live capabilities remain unavailable in this scaffold', () => {
  for (const key of ['live','background','ghostHandoff','scheduledExecution','likes','comments','messages']) assert.equal(PRESENCE_CAPABILITIES[key],false);
});
test('module contains no browser actuator or network side effects',async()=> {
  const source=await readFile(new URL('../src/core/presence.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|eval)\s*\(|\.click\s*\(|chrome\.tabs|document\./u);
});
