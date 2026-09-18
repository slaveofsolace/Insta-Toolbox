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

const REVIEW_TTL_MS = 15 * 60_000;
const MAX_ACTIONS = 50;
const MIN_ACTIONS = 1;
const reviews = new WeakSet();
const consumed = new WeakSet();

const fail = (reason) => { throw new Error(reason); };
const text = (value) => typeof value === 'string' ? value.trim() : '';
const count = (value, fallback = 10) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= MIN_ACTIONS && number <= MAX_ACTIONS
    ? number : fallback;
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
  return Object.freeze({
    actions: Object.freeze(actions),
    maxActions: count(source.maxActions),
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
  let state = Object.freeze({
    status: 'idle', reason: null, accountId: null, current: null,
    completed: 0, skipped: 0, uncertain: 0, maxActions: 0,
    enabledActions: Object.freeze([]), results: Object.freeze([]), canPause: false,
    canResume: false, canStop: false,
  });

  const publish = (patch = {}) => {
    const nextResults = patch.results || state.results;
    state = Object.freeze({ ...state, ...patch, results: Object.freeze([...nextResults].slice(0, 50)) });
    onUpdate(snapshot());
    return state;
  };
  const snapshot = () => clone(state);
  const active = () => controller && ['running', 'waiting', 'paused', 'stopping'].includes(state.status);
  const context = (accountId) => {
    const value = nativeActions.inspectContext();
    if (value?.accountVerified !== true || value.usable !== true || value.accountId !== accountId
      || value.challenge || value.actionBlocked || value.rateLimited || value.sessionExpired
      || value.frozen || value.discarded) fail('presence-context-changed');
    return value;
  };
  const sleep = async (ms, signal) => {
    if (wait) return wait(ms, signal);
    await new Promise((resolve, reject) => {
      let timer = null;
      const done = () => { signal?.removeEventListener?.('abort', abort); if (timer !== null) clearTimeout(timer); resolve(); };
      const abort = () => { if (timer !== null) clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
      if (signal?.aborted) return abort();
      signal?.addEventListener?.('abort', abort, { once: true });
      timer = setTimeout(done, ms);
    });
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

  function createReview({ accountId, options, expiresAt = now() + REVIEW_TTL_MS } = {}) {
    const normalized = normalizePresenceSessionOptions(options);
    const enabledActions = ACTION_ORDER.filter((action) => normalized.actions[action]);
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(text(accountId))) fail('presence-account-required');
    if (!enabledActions.length) fail('presence-action-required');
    const expiry = Math.min(Number(expiresAt) || 0, now() + REVIEW_TTL_MS);
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
      let cursor = 0;
      publish({
        status: 'running', reason: null, accountId: review.accountId, current: null,
        completed: 0, skipped: 0, uncertain: 0, maxActions: review.options.maxActions,
        enabledActions: review.enabledActions, results, canPause: true, canResume: false, canStop: true,
      });
      try {
        while (!signal.aborted && state.completed < review.options.maxActions && now() < review.expiresAt) {
          await awaitResume(signal);
          context(review.accountId);
          const action = review.enabledActions[cursor % review.enabledActions.length];
          cursor += 1;
          let candidate;
          try {
            candidate = await nativeActions.find(action, Object.freeze({ accountId: review.accountId,
              seen: new Set(seen), signal }));
          } catch (error) {
            if (signal.aborted) throw error;
            fail(error?.message || 'presence-discovery-failed');
          }
          if (!candidate) {
            empty.add(action);
            if (empty.size === review.enabledActions.length) break;
            continue;
          }
          if (!text(candidate.id) || candidate.action !== action || seen.has(candidate.id)) {
            fail('presence-target-invalid');
          }
          empty.delete(action);
          const actionId = `${action}:${candidate.id}`;
          publish({ status: 'running', current: { action, id: candidate.id,
            label: text(candidate.label) || PRESENCE_ACTION_LABELS[action] } });
          const assertCurrent = () => {
            if (signal.aborted || state.status === 'paused' || now() >= review.expiresAt) {
              fail('presence-grant-revoked');
            }
            context(review.accountId);
            return true;
          };
          let outcome;
          try {
            assertCurrent();
            outcome = await nativeActions.execute(action, candidate, Object.freeze({ signal, assertCurrent, actionId }));
          } catch (error) {
            if (signal.aborted) throw error;
            outcome = { verified: false, uncertain: true, reason: error?.message || 'presence-outcome-uncertain' };
          }
          seen.add(candidate.id);
          if (outcome?.verified === true) {
            results.unshift({ action, id: candidate.id, label: text(outcome.label) || text(candidate.label),
              status: 'completed', reason: text(outcome.reason) });
            publish({ completed: state.completed + 1, current: null, results });
          } else if (outcome?.skipped === true && outcome?.uncertain !== true) {
            results.unshift({ action, id: candidate.id, label: text(candidate.label),
              status: 'skipped', reason: text(outcome.reason) || 'No longer available' });
            publish({ skipped: state.skipped + 1, current: null, results });
          } else {
            results.unshift({ action, id: candidate.id, label: text(candidate.label),
              status: 'uncertain', reason: text(outcome?.reason) || 'Check Instagram before continuing' });
            publish({ status: 'needs-attention', reason: text(outcome?.reason) || 'presence-outcome-uncertain',
              uncertain: state.uncertain + 1, current: null, results,
              canPause: false, canResume: false, canStop: false });
            return snapshot();
          }
          if (state.completed >= review.options.maxActions) break;
          const delay = Math.round(minDelayMs + random() * (maxDelayMs - minDelayMs));
          publish({ status: 'waiting', current: null });
          await sleep(delay, signal);
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
      if (!controller || !['running', 'waiting'].includes(state.status)) return false;
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
