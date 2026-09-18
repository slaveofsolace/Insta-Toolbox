import { normalizeHandle, normalizeProfile } from '../src/core/presence.js';

const numericId = (value) => typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value) ? value : null;
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function unavailable(reason) {
  return freeze({ status: 'unavailable', executable: false, reason, inputs: null });
}
function viewerIdentity(viewer) {
  if (viewer?.accountVerified !== true || viewer.restriction
    || viewer.identityKind !== 'verified-viewer-username'
    || viewer.evidence !== 'visible-account-picker-and-navigation') return null;
  try {
    const username = normalizeHandle(viewer.accountId);
    const key = `iguser-v1-${[...username].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
    return viewer.accountKey === key ? { username, key } : null;
  } catch { return null; }
}

function captureRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100_000) return null;
  const identities = new Map();
  const names = new Map();
  const ambiguousIds = new Set();
  const ambiguousNames = new Set();
  let unresolved = 0;
  for (const row of rows) {
    let username;
    try { username = normalizeHandle(row?.username); } catch { unresolved += 1; continue; }
    const id = numericId(row?.instagramId);
    if (!id || row.instagramIdAmbiguous === true || row.source !== 'authenticated-instagram-web') {
      unresolved += 1;
      ambiguousNames.add(username);
      if (id) ambiguousIds.add(id);
      continue;
    }
    if (identities.has(id) && identities.get(id) !== username) {
      ambiguousIds.add(id);
      ambiguousNames.add(identities.get(id));
      ambiguousNames.add(username);
    }
    if (names.has(username) && names.get(username) !== id) {
      ambiguousIds.add(id);
      ambiguousIds.add(names.get(username));
      ambiguousNames.add(username);
    }
    identities.set(id, username);
    names.set(username, id);
  }
  const accounts = [...identities].filter(([id, username]) => (
    !ambiguousIds.has(id) && !ambiguousNames.has(username)
  )).map(([id, username]) => ({ id, username }));
  return { accounts, unresolved: unresolved + identities.size - accounts.length };
}

/** Dependencies must remain in the trusted runtime closure, never page messages. */
export function createPresenceNativeInputs({ fetchFollowerComparison, inspectViewer, now = Date.now } = {}) {
  if (typeof fetchFollowerComparison !== 'function' || typeof inspectViewer !== 'function'
    || typeof now !== 'function') throw new TypeError('Trusted checker and viewer adapters are required.');
  const receipts = new WeakMap();
  const seenResults = new WeakSet();
  let generation = 0;
  function inspect() {
    try { return viewerIdentity(inspectViewer()); } catch { return null; }
  }

  async function captureComparison({ username, retryRateLimits = false, signal, onProgress } = {}) {
    const token = ++generation;
    const start = now();
    const before = inspect();
    // Only these options reach the native checker; callers cannot inject a fetch implementation.
    const result = await fetchFollowerComparison({ username, retryRateLimits, signal, onProgress });
    const end = now();
    const after = inspect();
    if (result && typeof result === 'object') {
      if (seenResults.has(result)) return result;
      seenResults.add(result);
    }
    if (token !== generation || signal?.aborted || !before || !after
      || before.key !== after.key || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || end < start || !result || typeof result !== 'object') return result;
    let subject;
    try { subject = normalizeHandle(result.username); } catch { return result; }
    const requested = (() => { try { return normalizeHandle(username); } catch { return null; } })();
    const accountId = numericId(result.subjectInstagramId);
    const observedAt = Date.parse(result.capturedAt);
    if (subject !== before.username || requested !== subject || !accountId
      || result.source !== 'authenticated-instagram-web'
      || !Number.isSafeInteger(observedAt) || observedAt < start || observedAt > end) return result;
    const followers = captureRows(result.followers);
    const following = captureRows(result.following);
    if (!followers || !following) return result;
    receipts.set(result, freeze({
      token, accountId, username: subject, viewerKey: before.key, observedAt,
      followers, following,
      complete: { followers: result.complete?.followers === true, following: result.complete?.following === true },
    }));
    return result;
  }

  function prepareProductionInputs({ capture, profile = {} } = {}) {
    const receipt = capture && typeof capture === 'object' ? receipts.get(capture) : null;
    if (!receipt || receipt.token !== generation) return unavailable('fresh-runtime-capture-required');
    const viewer = inspect();
    if (!viewer || viewer.key !== receipt.viewerKey) return unavailable('viewer-changed-or-unavailable');
    if (profile.goal !== undefined && profile.goal !== 'maintain') return unavailable('routine-source-unavailable');
    if ((profile.accountId !== undefined && profile.accountId !== receipt.accountId)
      || (profile.username !== undefined && normalizeHandle(profile.username) !== receipt.username)) {
      return unavailable('profile-account-mismatch');
    }
    const normalized = normalizeProfile({ ...profile, accountId: receipt.accountId, username: receipt.username, goal: 'maintain' });
    const clock = now();
    const expiresAt = receipt.observedAt + Math.min(30, normalized.evidenceMaxAgeMinutes) * 60_000;
    if (!Number.isSafeInteger(clock) || clock < receipt.observedAt || clock >= expiresAt) return unavailable('capture-expired');
    const followingIds = new Map(receipt.following.accounts.map((row) => [row.id, row.username]));
    const followingNames = new Map(receipt.following.accounts.map((row) => [row.username, row.id]));
    const negativeEvidence = receipt.complete.following && receipt.following.unresolved === 0;
    let identityConflicts = 0;
    const candidates = [];
    for (const follower of receipt.followers.accounts) {
      if ((followingIds.has(follower.id) && followingIds.get(follower.id) !== follower.username)
        || (followingNames.has(follower.username) && followingNames.get(follower.username) !== follower.id)) {
        identityConflicts += 1;
        continue;
      }
      candidates.push({
        accountId: receipt.accountId, targetId: follower.id, username: follower.username,
        relation: followingIds.has(follower.id) ? 'following' : negativeEvidence ? 'not-following' : 'unknown',
        source: 'mutual-checker', followsMe: true, followsMeEvidence: 'direct',
        isPrivate: null, observedAt: receipt.observedAt, topics: [],
      });
    }
    const truncated = candidates.length > 2_000;
    return freeze({
      status: 'ready-for-review', executable: false, live: false,
      accountBinding: { accountId: receipt.accountId, username: receipt.username, basis: 'current-viewer-and-original-checker-result' },
      expiresAt,
      inputs: { profile: normalized, candidates: candidates.slice(0, 2_000), history: [], usage: {} },
      evidence: {
        followersComplete: receipt.complete.followers, followingComplete: receipt.complete.following,
        negativeFollowingEvidence: negativeEvidence, privacy: 'unavailable',
        unresolvedFollowers: receipt.followers.unresolved, unresolvedFollowing: receipt.following.unresolved,
        identityConflicts, truncated, omitted: Math.max(0, candidates.length - 2_000),
      },
    });
  }

  return Object.freeze({ captureComparison, prepareProductionInputs, invalidate() { generation += 1; } });
}
