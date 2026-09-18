/**
 * Deterministic, account-bound Presence planning.
 * No network, DOM, credentials, or action authority.
 * Inputs describe observations; a future trusted adapter must revalidate them.
 */
export const PRESENCE_VERSION = 1;
export const PRESENCE_CAPABILITIES = Object.freeze({
  planning: true, preview: true, live: false, discovery: false,
  scheduledExecution: false, likes: false, comments: false, messages: false,
  background: false, ghostHandoff: false,
});
export const ROUTINES = Object.freeze({
  discover: Object.freeze({ name: 'Find my people', goal: 'discover', followLimit: 12, unfollowLimit: 0 }),
  maintain: Object.freeze({ name: 'Stay connected', goal: 'maintain', followLimit: 6, unfollowLimit: 0 }),
  curate: Object.freeze({ name: 'Make room', goal: 'curate', followLimit: 0, unfollowLimit: 12 }),
});
const DAY = 86_400_000;
const MAX_ITEMS = 2_000;
const RESERVED = new Set(['accounts', 'direct', 'explore', 'reels', 'stories', 'settings', 'api']);
const RELATIONS = new Set(['following', 'not-following', 'requested', 'unknown']);
const SOURCES = new Set(['manual', 'mutual-checker', 'managed-history']);
const STOPS = new Set(['challenge', 'rate-limit', 'action-blocked', 'signed-out', 'uncertain']);

function record(value, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object.`);
  }
  return value;
}
function integer(value, min, max, fallback, name) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return n;
}
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,29}$/u.test(value)) {
    throw new TypeError(`${name} must be a stable numeric ID string.`);
  }
  return value;
}
function timestamp(value, name) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be an epoch-millisecond integer.`);
  }
  return value;
}
function bool(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be true or false.`);
  return value;
}
function list(value, name, max = MAX_ITEMS) {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${name} must contain at most ${max} items.`);
  return value;
}
function strings(value, name, max = 30) {
  return [...new Set(list(value, name, max).map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 80) throw new TypeError(`Invalid ${name} item.`);
    return item.trim().toLowerCase();
  }))].sort();
}
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export function normalizeHandle(value) {
  const text = typeof value === 'string' ? value.trim().replace(/^@/u, '').toLowerCase() : '';
  if (!/^[a-z0-9._]{1,30}$/u.test(text) || RESERVED.has(text)) throw new TypeError('Invalid Instagram username.');
  return text;
}

/** Return a new allowlisted profile; imported enabled/authority fields are ignored. */
export function normalizeProfile(input = {}) {
  const p = record(input, 'Profile');
  if (p.version !== undefined && p.version !== PRESENCE_VERSION) throw new TypeError('Unsupported profile version.');
  const goal = p.goal ?? 'discover';
  if (!Object.hasOwn(ROUTINES, goal)) throw new TypeError('Unknown routine.');
  const preset = ROUTINES[goal];
  const timezone = p.timezone ?? 'UTC';
  if (typeof timezone !== 'string' || timezone.length > 80) throw new TypeError('Invalid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0); }
  catch { throw new TypeError('Invalid time zone.'); }
  const window = record(p.window ?? { start: 540, end: 1200 }, 'Active window');
  const start = integer(window.start, 0, 1439, 540, 'Start minute');
  const end = integer(window.end, 0, 1439, 1200, 'End minute');
  if (start === end) throw new TypeError('Choose a nonempty active window.');
  return deepFreeze({
    version: PRESENCE_VERSION,
    accountId: identifier(p.accountId, 'Account ID'),
    username: normalizeHandle(p.username), goal, timezone, window: { start, end },
    topics: strings(p.topics ?? [], 'Topics'),
    excludedTopics: strings(p.excludedTopics ?? [], 'Excluded topics'),
    protectedIds: [...new Set(list(p.protectedIds ?? [], 'Protected IDs', 500)
      .map((id) => identifier(id, 'Protected ID')))].sort(),
    followLimit: integer(p.followLimit, 0, 50, preset.followLimit, 'Follow limit'),
    unfollowLimit: integer(p.unfollowLimit, 0, 50, preset.unfollowLimit, 'Unfollow limit'),
    waitDays: integer(p.waitDays, 1, 365, 7, 'Follow-up days'),
    evidenceMaxAgeMinutes: integer(p.evidenceMaxAgeMinutes, 1, 1440, 30, 'Evidence age'),
    skipPrivate: bool(p.skipPrivate, true, 'Skip private'),
    keepMutuals: true, reviewRequired: true, liveEnabled: false,
  });
}

/** Active windows are local wall time; waiting periods below use elapsed time. */
export function activeNow(profile, now) {
  const p = normalizeProfile(profile);
  timestamp(now, 'Now');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: p.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const minute = Number(parts.find((x) => x.type === 'hour').value) * 60
    + Number(parts.find((x) => x.type === 'minute').value);
  const { start, end } = p.window;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function normalizeCandidate(input) {
  const c = record(input, 'Candidate');
  const relation = c.relation ?? 'unknown';
  if (!RELATIONS.has(relation)) throw new TypeError('Invalid relationship.');
  const source = c.source ?? 'manual';
  if (!SOURCES.has(source)) throw new TypeError('Unsupported candidate source.');
  const proof = c.followsMeEvidence ?? 'unknown';
  if (!['direct', 'complete-list', 'partial-list', 'unknown'].includes(proof)) throw new TypeError('Invalid relationship evidence.');
  if (c.followsMe != null && typeof c.followsMe !== 'boolean') throw new TypeError('Invalid follow-back state.');
  if (c.isPrivate != null && typeof c.isPrivate !== 'boolean') throw new TypeError('Invalid privacy state.');
  return {
    accountId: identifier(c.accountId, 'Observation account'),
    targetId: identifier(c.targetId, 'Target ID'), username: normalizeHandle(c.username),
    relation, source, followsMe: c.followsMe ?? null, followsMeEvidence: proof,
    isPrivate: c.isPrivate ?? null,
    observedAt: timestamp(c.observedAt, 'Observation time'),
    topics: strings(c.topics ?? [], 'Candidate topics'),
  };
}
function normalizeHistory(input) {
  const h = record(input, 'History');
  return {
    accountId: identifier(h.accountId, 'History account'),
    targetId: identifier(h.targetId, 'History target'),
    followedAt: timestamp(h.followedAt, 'Follow time'),
    outcome: ['verified', 'uncertain'].includes(h.outcome) ? h.outcome : 'uncertain',
    origin: h.origin === 'presence' ? 'presence' : 'legacy',
  };
}

/**
 * Compile finite suggestions. This is NOT a signed job or permission to click.
 * IDs/observations from a UI or import remain untrusted until runtime inspection.
 */
export function compilePlan({ profile, candidates = [], history = [], now, usage = {} }) {
  timestamp(now, 'Now');
  const p = normalizeProfile(profile);
  record(usage, 'Usage');
  const usedFollow = integer(usage.follow, 0, 1_000_000, 0, 'Used follows');
  const usedUnfollow = integer(usage.unfollow, 0, 1_000_000, 0, 'Used unfollows');
  const rows = list(candidates, 'Candidates').map(normalizeCandidate);
  const events = list(history, 'History', 10_000).map(normalizeHistory);
  const counts = new Map();
  const names = new Map();
  const eventsById = new Map();
  for (const c of rows) {
    counts.set(c.targetId, (counts.get(c.targetId) || 0) + 1);
    names.set(c.username, (names.get(c.username) || 0) + 1);
  }
  for (const h of events) {
    if (h.accountId !== p.accountId) continue;
    const bucket = eventsById.get(h.targetId) || [];
    bucket.push(h); eventsById.set(h.targetId, bucket);
  }
  const active = activeNow(p, now);
  const decisions = rows.map((c) => {
    const sharedTopics = c.topics.filter((t) => p.topics.includes(t));
    const decision = { targetId: c.targetId, username: c.username, source: c.source,
      state: 'held', action: null, reason: '', score: sharedTopics.length, dueAt: null };
    const end = (state, reason, action = null) => ({ ...decision, state, reason, action });
    if (c.accountId !== p.accountId) return end('held', 'Different account');
    if (c.targetId === p.accountId || c.username === p.username) return end('protected', 'Your own account');
    if (counts.get(c.targetId) > 1 || names.get(c.username) > 1) return end('held', 'Duplicate or conflicting identity');
    if (p.protectedIds.includes(c.targetId)) return end('protected', 'On your keep list');
    if (c.observedAt > now || now - c.observedAt > p.evidenceMaxAgeMinutes * 60_000) {
      return end('held', 'Refresh this observation');
    }
    const prior = eventsById.get(c.targetId) || [];
    if (c.relation === 'requested') return end('protected', 'Follow request already pending');
    if (c.relation === 'not-following') {
      if (prior.length) return end('protected', 'Previously followed; no repeat cycle');
      if (p.goal === 'curate') return end('skipped', 'This routine only revisits managed follows');
      if (p.skipPrivate && c.isPrivate !== false) return end('held', 'Private or unknown account visibility');
      if (c.topics.some((t) => p.excludedTopics.includes(t))) return end('skipped', 'Matches an excluded topic');
      if (p.goal === 'maintain' && !(c.followsMe === true && ['direct', 'complete-list'].includes(c.followsMeEvidence))) {
        return end('held', 'Follow-back evidence required for Stay connected');
      }
      if (p.goal === 'discover' && (!p.topics.length || !sharedTopics.length)) return end('skipped', 'No selected interest match');
      return end('eligible', p.goal === 'maintain' ? 'Follows you; review a follow back' : `Matches ${sharedTopics.join(', ')}`, 'follow');
    }
    if (c.relation !== 'following') return end('held', 'Current relationship is unknown');
    if (c.followsMe === true) return end('protected', 'Mutual connection');
    if (prior.length !== 1 || prior[0]?.origin !== 'presence' || prior[0]?.outcome !== 'verified') {
      return end('protected', 'No unique verified managed follow');
    }
    const event = prior[0];
    if (event.followedAt > now) return end('held', 'Invalid future follow history');
    decision.dueAt = event.followedAt + p.waitDays * DAY;
    if (now < decision.dueAt) return end('waiting', 'Still in your follow-up window');
    if (c.followsMe !== false || !['direct', 'complete-list'].includes(c.followsMeEvidence)) {
      return end('held', 'Not found is not proof of a non-mutual');
    }
    return end('eligible', 'Follow-up due; verified non-mutual', 'unfollow');
  }).sort((a, b) => b.score - a.score || (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0));
  const available = { follow: Math.max(0, p.followLimit - usedFollow), unfollow: Math.max(0, p.unfollowLimit - usedUnfollow) };
  const targets = [];
  for (const d of decisions) {
    if (d.state !== 'eligible') continue;
    if (!active) { d.state = 'held'; d.reason = 'Outside your active window'; continue; }
    if (!available[d.action]) { d.state = 'held'; d.reason = 'Your session allowance is used'; continue; }
    available[d.action] -= 1;
    d.state = 'planned';
    targets.push({ targetId: d.targetId, username: d.username, action: d.action, reason: d.reason });
  }
  return deepFreeze({
    kind: 'presence-review', version: PRESENCE_VERSION, executable: false,
    accountId: p.accountId, profile: p, createdAt: now, expiresAt: now + 15 * 60_000,
    activeWindow: active, targets, decisions,
    notice: 'Planning only. Live execution requires a fresh review and a trusted browser adapter.',
  });
}

/** Pure arbitration advice, not an inter-tab mutex or action authorization. */
export function modeHandoff({ current, next, inFlight = false, uncertain = false }) {
  if (!['presence', 'ghost', 'idle'].includes(current) || !['presence', 'ghost', 'idle'].includes(next)) {
    throw new TypeError('Unknown activity mode.');
  }
  if (uncertain) return Object.freeze({ ready: false, reason: 'Reconcile the uncertain action first.' });
  if (inFlight) return Object.freeze({ ready: false, reason: 'Wait for the dispatched action to settle.' });
  return Object.freeze({ ready: true, reason: 'Revoke the old mode, then review the new scope.', requiresFreshReview: next !== 'idle' });
}

/** Finite, synchronous, no-click preview state machine. No injected executor. */
export function createPreviewSession(plan, now = Date.now) {
  record(plan, 'Plan');
  if (plan.kind !== 'presence-review' || plan.version !== PRESENCE_VERSION || plan.executable !== false) {
    throw new TypeError('A planning-only Presence review is required.');
  }
  const accountId = identifier(plan.accountId, 'Plan account');
  const createdAt = timestamp(plan.createdAt, 'Plan creation');
  const expiresAt = timestamp(plan.expiresAt, 'Plan expiry');
  if (expiresAt <= createdAt || expiresAt - createdAt > 15 * 60_000) throw new TypeError('Invalid plan lifetime.');
  const targets = list(plan.targets, 'Plan targets', 100).map((t) => {
    record(t, 'Target');
    if (!['follow', 'unfollow'].includes(t.action)) throw new TypeError('Unsupported preview action.');
    return Object.freeze({ targetId: identifier(t.targetId, 'Target ID'), username: normalizeHandle(t.username), action: t.action });
  });
  if (new Set(targets.map((t) => t.targetId)).size !== targets.length) throw new TypeError('Duplicate plan target.');
  let state = 'draft'; let cursor = 0; let reason = ''; const results = [];
  const snapshot = () => deepFreeze({ mode: 'preview', live: false, state, accountId,
    total: targets.length, simulated: cursor, reason, results: results.map((x) => ({ ...x })) });
  return Object.freeze({ snapshot, dispatch(event, context = {}) {
    const clock = timestamp(now(), 'Clock');
    if (['stopped', 'expired', 'simulated'].includes(state)) return snapshot();
    if (clock < createdAt || clock >= expiresAt) { state = 'expired'; reason = 'Review expired. Build a fresh plan.'; return snapshot(); }
    if (context.accountId !== undefined && context.accountId !== accountId) {
      state = 'stopped'; reason = 'Account changed.'; return snapshot();
    }
    if (STOPS.has(context.restriction)) { state = 'stopped'; reason = context.restriction; return snapshot(); }
    if (event === 'stop') { state = 'stopped'; reason = 'Stopped by you.'; return snapshot(); }
    if (event === 'ghost') { state = 'paused'; reason = 'Ghost needs a separate review; no automatic handoff.'; return snapshot(); }
    if (event === 'review' && state === 'draft') {
      if (context.accountId !== accountId) throw new Error('Review must name the planning account.');
      state = 'ready';
    } else if (event === 'start' && state === 'ready') {
      state = targets.length ? 'previewing' : 'simulated';
    } else if (event === 'pause' && state === 'previewing') { state = 'paused'; reason = 'Preview paused.';
    } else if (event === 'resume' && state === 'paused') {
      if (context.accountId !== accountId) throw new Error('Resume must name the planning account.');
      state = 'ready'; reason = 'Review ready; start the preview again.';
    } else if (event === 'step' && state === 'previewing') {
      results.push({ ...targets[cursor], outcome: 'simulated' }); cursor += 1;
      if (cursor === targets.length) state = 'simulated';
    } else { throw new Error(`Cannot ${event} from ${state}.`); }
    return snapshot();
  } });
}
