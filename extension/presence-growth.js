const DAY_MS = 86_400_000;
const USERNAME = /^[a-z0-9._]{1,30}$/;
const RESERVED = new Set(['about', 'accounts', 'api', 'developer', 'direct', 'emails',
  'explore', 'legal', 'privacy', 'reels', 'settings', 'stories', 'terms', 'web']);

export function growthUsername(value) {
  const name = String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  return USERNAME.test(name) && !RESERVED.has(name) ? name : '';
}

const names = (rows) => new Set((Array.isArray(rows) ? rows : [])
  .map((row) => growthUsername(typeof row === 'string' ? row : row?.username))
  .filter(Boolean));

function observedAccounts(rows) {
  const accounts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const username = growthUsername(typeof row === 'string' ? row : row?.username);
    if (!username) continue;
    const id = typeof row === 'object' && row !== null
      && /^[1-9]\d{0,29}$/.test(String(row.instagramId || '')) ? String(row.instagramId) : '';
    const prior = accounts.get(username);
    accounts.set(username, prior === null || (prior && id && prior !== id) ? null : prior || id);
  }
  return accounts;
}

// A candidate needs an observed two-way relationship with a selected seed.
// Missing rows in a partial Instagram list are unknown, never negative proof.
export function rankGrowthCandidates({ account, seeds, following = [], followers = [], limit = 50 } = {}) {
  const self = growthUsername(account);
  const alreadyFollowing = names(following);
  const alreadyFollowers = names(followers);
  const seenSeeds = new Set();
  const selectedSeeds = new Set((Array.isArray(seeds) ? seeds : [])
    .map((source) => growthUsername(source?.username)).filter(Boolean));
  const candidates = new Map();
  for (const source of Array.isArray(seeds) ? seeds.slice(0, 3) : []) {
    const seed = growthUsername(source?.username);
    if (!seed || seed === self || seenSeeds.has(seed) || !alreadyFollowing.has(seed)) continue;
    seenSeeds.add(seed);
    const seedFollowers = observedAccounts(source.followers);
    for (const [candidate, followingId] of observedAccounts(source.following)) {
      const followerId = seedFollowers.get(candidate);
      if (followerId === undefined || followerId === null || followingId === null
        || (followerId && followingId && followerId !== followingId)
        || candidate === self || selectedSeeds.has(candidate)
        || alreadyFollowing.has(candidate) || alreadyFollowers.has(candidate)) continue;
      const identity = followingId || followerId;
      const item = candidates.get(candidate) || { username: candidate, via: [], instagramId: identity };
      if (item.invalid || (item.instagramId && identity && item.instagramId !== identity)) {
        candidates.set(candidate, { ...item, invalid: true });
        continue;
      }
      if (!item.instagramId) item.instagramId = identity;
      item.via.push(seed);
      candidates.set(candidate, item);
    }
  }
  return [...candidates.values()].filter((item) => !item.invalid)
    .map(({ username, via }) => Object.freeze({ username, via: Object.freeze(via.sort()) }))
    .sort((a, b) => b.via.length - a.via.length || a.username.localeCompare(b.username))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 50)));
}

export function createGrowthCampaign({ account, targets, delayDays, createdAt = Date.now(), id } = {}) {
  const owner = growthUsername(account);
  const days = Number(delayDays);
  const unique = [...names(targets)];
  if (!owner || !Number.isInteger(days) || days < 7 || days > 14
    || !unique.length || unique.length > 50 || unique.includes(owner)
    || !Number.isSafeInteger(createdAt) || createdAt <= 0 || !String(id || '').trim()) {
    throw new Error('growth-campaign-invalid');
  }
  return {
    schemaVersion: 1,
    id: String(id),
    account: owner,
    createdAt,
    delayDays: days,
    targets: unique,
    followed: {},
    unfollowed: {},
  };
}

export function recordGrowthOutcome(campaign, { action, username, verifiedAt = Date.now() } = {}) {
  const target = growthUsername(username);
  if (!campaign || !target || !campaign.targets?.includes(target)
    || !Number.isSafeInteger(verifiedAt) || verifiedAt <= 0) return campaign;
  if (action === 'follow') {
    if (campaign.followed?.[target]) return campaign;
    return { ...campaign, followed: { ...campaign.followed, [target]: verifiedAt } };
  }
  if (action === 'unfollow' && campaign.followed?.[target] && !campaign.unfollowed?.[target]) {
    return { ...campaign, unfollowed: { ...campaign.unfollowed, [target]: verifiedAt } };
  }
  return campaign;
}

export function growthOutcomeVerified(action, result) {
  return (action === 'follow' && result === 'followed')
    || (action === 'unfollow' && result === 'unfollowed');
}

export function dueGrowthUnfollows(campaign, { account, now = Date.now() } = {}) {
  if (!campaign || growthUsername(account) !== campaign.account || !Number.isFinite(now)) return [];
  return (campaign.targets || []).filter((target) => {
    const followedAt = Number(campaign.followed?.[target]);
    return Number.isSafeInteger(followedAt) && followedAt > 0
      && followedAt + campaign.delayDays * DAY_MS <= now && !campaign.unfollowed?.[target];
  });
}
