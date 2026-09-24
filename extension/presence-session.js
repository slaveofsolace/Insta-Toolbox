const ACTION_ORDER = Object.freeze([
  'viewStories',
  'reactStories',
  'likePosts',
  'followPeople',
  'acceptRequests',
]);

export const PRESENCE_ACTION_LABELS = Object.freeze({
  viewStories: 'View stories',
  reactStories: 'React to stories',
  likePosts: 'Like posts',
  followPeople: 'Follow people',
  acceptRequests: 'Accept incoming requests',
});

const SESSION_REVIEW_TTL_MS = 15 * 60_000;
const LIVE_REVIEW_TTL_MS = 12 * 60 * 60_000;
const MAX_ACTIONS = 50;
const MAX_LIVE_ACTIONS = 500;
const MIN_ACTIONS = 1;
const LIVE_STARTUP_SWEEPS = 3;
const LIVE_STARTUP_RETRY_MS = 2_000;
const reviews = new WeakSet();
const consumed = new WeakSet();

const fail = (reason) => { throw new Error(reason); };
const text = (value) => typeof value === 'string' ? value.trim() : '';
const count = (value, fallback = 10) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= MIN_ACTIONS && number <= MAX_ACTIONS
    ? number : fallback;
};
const boundedInteger = (value, { min, max, fallback }) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};
const digest = (value) => {
  const source = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const clone = (value) => structuredClone(value);

export function normalizePresenceSessionOptions(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const actions = Object.fromEntries(ACTION_ORDER.map((action) => [action, source.actions?.[action] === true]));
  if (actions.reactStories) actions.viewStories = true;
  const mode = source.mode === 'live' ? 'live' : 'session';
  return Object.freeze({
    actions: Object.freeze(actions),
    mode,
    maxActions: mode === 'live'
      ? boundedInteger(source.maxActions, { min: 1, max: MAX_LIVE_ACTIONS, fallback: null })
      : count(source.maxActions),
    liveDurationMinutes: boundedInteger(source.liveDurationMinutes,
      { min: 30, max: 720, fallback: 120 }),
    scheduledBreaks: source.scheduledBreaks === true,
    liveBurstActions: boundedInteger(source.liveBurstActions,
      { min: 1, max: 20, fallback: 5 }),
    quietMinutes: boundedInteger(source.quietMinutes,
      { min: 1, max: 120, fallback: 10 }),
  });
}

export function createPresenceSession({
  nativeActions,
  locks = null,
  now = Date.now,
  random = Math.random,
  wait = null,
  onUpdate = () => {},
  minDelayMs = 2_000,
  maxDelayMs = 5_000,
} = {}) {
  if (typeof nativeActions?.inspectContext !== 'function'
    || typeof nativeActions?.find !== 'function'
    || typeof nativeActions?.execute !== 'function'
    || (locks !== null && typeof locks?.request !== 'function')
    || typeof now !== 'function' || typeof random !== 'function'
    || (wait !== null && typeof wait !== 'function') || typeof onUpdate !== 'function') {
    fail('presence-session-adapter-required');
  }
  if (!Number.isFinite(minDelayMs) || !Number.isFinite(maxDelayMs)
    || minDelayMs < 0 || maxDelayMs < minDelayMs || maxDelayMs > 60_000) {
    fail('presence-session-pacing-invalid');
  }

  let controller = null;
  let pauseGate = null;
  let runSequence = 0;
  let state = Object.freeze({
    status: 'idle', reason: null, accountId: null, current: null,
    completed: 0, skipped: 0, uncertain: 0, maxActions: 0,
    mode: 'session', runId: null, enabledActions: Object.freeze([]),
    results: Object.freeze([]), canPause: false,
    canResume: false, canStop: false,
  });

  const publish = (patch = {}) => {
    const nextResults = patch.results || state.results;
    state = Object.freeze({ ...state, ...patch, results: Object.freeze([...nextResults].slice(0, 50)) });
    onUpdate(snapshot());
    return state;
  };
  const snapshot = () => clone(state);
  const active = () => controller && ['running', 'searching', 'waiting', 'quiet', 'paused', 'stopping'].includes(state.status);
  const context = (accountId) => {
    const value = nativeActions.inspectContext();
    if (value?.accountVerified !== true || value.usable !== true || value.accountId !== accountId
      || value.challenge || value.actionBlocked || value.rateLimited || value.sessionExpired
      || value.frozen || value.discarded) fail('presence-context-changed');
    return value;
  };
  const sleep = async (ms, signal) => {
    if (wait) return wait(ms, signal);
    const deadline = now() + ms;
    while (now() < deadline && state.status !== 'paused') {
      await new Promise((resolve, reject) => {
        let timer = null;
        const done = () => { signal?.removeEventListener?.('abort', abort); if (timer !== null) clearTimeout(timer); resolve(); };
        const abort = () => { if (timer !== null) clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
        if (signal?.aborted) return abort();
        signal?.addEventListener?.('abort', abort, { once: true });
        timer = setTimeout(done, Math.min(1_000, Math.max(0, deadline - now())));
      });
    }
  };
  const awaitResume = async (signal) => {
    while (state.status === 'paused') {
      await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Stopped', 'AbortError'));
        if (signal.aborted) return abort();
        pauseGate = () => { signal.removeEventListener('abort', abort); pauseGate = null; resolve(); };
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  };

  function createReview({ accountId, options, expiresAt } = {}) {
    const normalized = normalizePresenceSessionOptions(options);
    const enabledActions = ACTION_ORDER.filter((action) => normalized.actions[action]);
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(text(accountId))) fail('presence-account-required');
    if (!enabledActions.length) fail('presence-action-required');
    const ttl = normalized.mode === 'live'
      ? Math.min(LIVE_REVIEW_TTL_MS, normalized.liveDurationMinutes * 60_000)
      : SESSION_REVIEW_TTL_MS;
    const expiry = Math.min(Number(expiresAt) || (now() + ttl), now() + ttl);
    if (expiry <= now()) fail('presence-review-expired');
    const payload = Object.freeze({ accountId: text(accountId), options: normalized,
      enabledActions: Object.freeze(enabledActions), expiresAt: expiry });
    const review = Object.freeze({ version: 1, ...payload,
      reviewedDigest: digest({ ...payload, options: normalized }) });
    reviews.add(review);
    return review;
  }

  async function start(review) {
    if (active()) fail('presence-session-active');
    if (!review || !reviews.has(review) || consumed.has(review)) fail('presence-review-required');
    if (review.expiresAt <= now()) fail('presence-review-expired');
    if (!locks) fail('presence-account-lock-unavailable');
    const initialContext = context(review.accountId);
    const accountKey = text(initialContext.accountKey);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountKey)) fail('presence-account-lock-unavailable');
    const lockName = `insta-toolbox:account-activity:${accountKey}`;
    return locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock || lock.name !== lockName || lock.mode !== 'exclusive') fail('presence-account-busy');
      context(review.accountId);
      consumed.add(review);
      controller = new AbortController();
      const { signal } = controller;
      const results = [];
      const seen = new Set();
      const empty = new Set();
      const runId = `${now()}:${++runSequence}`;
      let resultSequence = 0;
      let cursor = 0;
      let emptySweeps = 0;
      let verifiedInBurst = 0;
      // Stay on a surface for a short visit instead of bouncing between feed,
      // stories and notifications after every click. Story reactions follow
      // the story they belong to before advancing to the next story.
      const itinerary = [];
      if (review.options.actions.viewStories) for (let index = 0; index < 3; index += 1) {
        itinerary.push('viewStories');
        if (review.options.actions.reactStories) itinerary.push('reactStories');
      }
      for (const action of review.enabledActions.filter(value => !['viewStories', 'reactStories'].includes(value))) {
        itinerary.push(action, action, action);
      }
      const assertCurrent = () => {
        if (signal.aborted || now() >= review.expiresAt) fail('presence-grant-revoked');
        if (state.status === 'paused') fail('presence-paused');
        context(review.accountId);
        return true;
      };
      const reachedLimit = () => review.options.maxActions !== null
        && state.completed >= review.options.maxActions;
      const waitWithinReview = (ms) => sleep(Math.min(ms, Math.max(0, review.expiresAt - now())), signal);
      publish({
        status: 'running', reason: null, accountId: review.accountId, current: null,
        completed: 0, skipped: 0, uncertain: 0, maxActions: review.options.maxActions,
        mode: review.options.mode, runId, enabledActions: review.enabledActions,
        results, canPause: true, canResume: false, canStop: true,
      });
      try {
        while (!signal.aborted && !reachedLimit() && now() < review.expiresAt) {
          await awaitResume(signal);
          context(review.accountId);
          const action = itinerary[cursor % itinerary.length];
          cursor += 1;
          publish({
            status: 'searching',
            current: { action, id: null, label: PRESENCE_ACTION_LABELS[action] },
          });
          let candidate;
          try {
            candidate = await nativeActions.find(action, Object.freeze({ accountId: review.accountId,
              seen: new Set(seen), signal, assertCurrent }));
          } catch (error) {
            if (signal.aborted) throw error;
            if (error?.message === 'presence-paused') {
              await awaitResume(signal); cursor -= 1; continue;
            }
            fail(error?.message || 'presence-discovery-failed');
          }
          await awaitResume(signal);
          if (signal.aborted || now() >= review.expiresAt) break;
          assertCurrent();
          if (!candidate) {
            empty.add(action);
            if (empty.size === review.enabledActions.length) {
              if (review.options.mode !== 'live') break;
              empty.clear();
              emptySweeps += 1;
              if (emptySweeps < LIVE_STARTUP_SWEEPS) {
                publish({ status: 'searching', current: null });
                await waitWithinReview(LIVE_STARTUP_RETRY_MS);
              } else {
                publish({ status: 'searching', current: null });
                await waitWithinReview(Math.min(30_000, 5_000 * (emptySweeps - 2)));
              }
              await awaitResume(signal);
              if (!signal.aborted && now() < review.expiresAt) publish({ status: 'running' });
            }
            continue;
          }
          if (!text(candidate.id) || candidate.action !== action || seen.has(candidate.id)) {
            fail('presence-target-invalid');
          }
          empty.delete(action);
          emptySweeps = 0;
          const actionId = `${action}:${candidate.id}`;
          publish({ status: 'running', current: { action, id: candidate.id,
            label: text(candidate.label) || PRESENCE_ACTION_LABELS[action] } });
          let outcome;
          try {
            assertCurrent();
            outcome = await nativeActions.execute(action, candidate, Object.freeze({ signal,
              assertCurrent: () => {
                if (state.status === 'paused') fail('presence-grant-revoked');
                return assertCurrent();
              }, actionId }));
          } catch (error) {
            if (signal.aborted) throw error;
            outcome = { verified: false, uncertain: true, reason: error?.message || 'presence-outcome-uncertain' };
          }
          seen.add(candidate.id);
          if (outcome?.verified === true) {
            results.unshift({ action, id: candidate.id, label: text(outcome.label) || text(candidate.label),
              status: 'completed', reason: text(outcome.reason), at: now(),
              eventId: `${runId}:${++resultSequence}` });
            verifiedInBurst += 1;
            publish({ completed: state.completed + 1, current: null, results });
          } else if (outcome?.skipped === true && outcome?.uncertain !== true) {
            results.unshift({ action, id: candidate.id, label: text(candidate.label),
              status: 'skipped', reason: text(outcome.reason) || 'No longer available', at: now(),
              eventId: `${runId}:${++resultSequence}` });
            publish({ skipped: state.skipped + 1, current: null, results });
          } else {
            results.unshift({ action, id: candidate.id, label: text(candidate.label),
              status: 'uncertain', reason: text(outcome?.reason) || 'Check Instagram before continuing',
              at: now(), eventId: `${runId}:${++resultSequence}` });
            publish({ status: 'needs-attention', reason: text(outcome?.reason) || 'presence-outcome-uncertain',
              uncertain: state.uncertain + 1, current: null, results,
              canPause: false, canResume: false, canStop: false });
            return snapshot();
          }
          if (reachedLimit()) break;
          if (review.options.mode === 'live'
            && review.options.scheduledBreaks
            && verifiedInBurst >= review.options.liveBurstActions) {
            verifiedInBurst = 0;
            publish({ status: 'quiet', current: null });
            await waitWithinReview(review.options.quietMinutes * 60_000);
            await awaitResume(signal);
            if (!signal.aborted) publish({ status: 'running' });
            continue;
          }
          const delay = Math.round(minDelayMs + random() * (maxDelayMs - minDelayMs));
          publish({ status: 'waiting', current: null });
          await waitWithinReview(delay);
          if (!signal.aborted && state.status !== 'paused') publish({ status: 'running' });
        }
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const expired = now() >= review.expiresAt;
        publish({ status: expired ? 'expired' : 'completed',
          reason: expired ? 'presence-session-expired' : null, current: null,
          canPause: false, canResume: false, canStop: false });
        return snapshot();
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') {
          publish({ status: 'stopped', reason: 'presence-session-stopped', current: null,
            canPause: false, canResume: false, canStop: false });
          return snapshot();
        }
        publish({ status: 'needs-attention', reason: error?.message || 'presence-session-failed', current: null,
          canPause: false, canResume: false, canStop: false });
        return snapshot();
      } finally {
        controller = null;
        pauseGate = null;
      }
    });
  }

  return Object.freeze({
    createReview,
    start,
    snapshot,
    pause() {
      if (!controller || !['running', 'searching', 'waiting', 'quiet'].includes(state.status)) return false;
      publish({ status: 'paused', canPause: false, canResume: true, canStop: true });
      return true;
    },
    resume() {
      if (!controller || state.status !== 'paused') return false;
      publish({ status: 'running', canPause: true, canResume: false, canStop: true });
      pauseGate?.();
      return true;
    },
    stop() {
      if (!controller || !active()) return false;
      publish({ status: 'stopping', canPause: false, canResume: false, canStop: false });
      controller.abort('Stopped');
      pauseGate?.();
      return true;
    },
  });
}
