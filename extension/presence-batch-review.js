import { compilePlan, normalizeProfile, PRESENCE_VERSION } from '../src/core/presence.js';

export const PRESENCE_BATCH_CAPABILITIES = Object.freeze({
  reviewDraft: true,
  live: false,
  scheduledExecution: false,
});

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(value, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain record.`);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function reject(reason) {
  return freeze({
    kind: 'presence-batch-review-draft', version: 1,
    status: 'unavailable', executable: false, reason,
    capabilities: PRESENCE_BATCH_CAPABILITIES,
    queueDraft: null, confirmationDraft: null,
  });
}

/** Build presentation data only. Neither a plan nor this draft is action authority. */
export function createPresenceBatchDraft({ reviewedPlan, current, selectedTargetIds, now } = {}) {
  record(reviewedPlan, 'Reviewed plan');
  record(current, 'Current observations');
  if (!Number.isSafeInteger(now) || now <= 0) throw new TypeError('A current timestamp is required.');
  if (reviewedPlan.kind !== 'presence-review'
    || reviewedPlan.version !== PRESENCE_VERSION || reviewedPlan.executable !== false) {
    return reject('presence-review-required');
  }
  const { createdAt, expiresAt } = reviewedPlan;
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt)
    || createdAt <= 0 || expiresAt <= createdAt || expiresAt - createdAt > 15 * 60_000) {
    return reject('invalid-review-lifetime');
  }
  if (now < createdAt || now >= expiresAt) return reject('review-expired');
  if (!Array.isArray(reviewedPlan.targets) || !reviewedPlan.targets.length
    || reviewedPlan.targets.length > 100) return reject('finite-targets-required');
  if (!Array.isArray(selectedTargetIds) || !selectedTargetIds.length
    || selectedTargetIds.length > 100
    || selectedTargetIds.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,29}$/.test(id))
    || new Set(selectedTargetIds).size !== selectedTargetIds.length) {
    return reject('exact-selection-required');
  }

  // Recompile observations rather than accepting previously simulated decisions.
  const fresh = compilePlan({
    profile: current.profile, candidates: current.candidates,
    history: current.history, usage: current.usage, now,
  });
  if (reviewedPlan.accountId !== fresh.accountId) return reject('account-changed');
  if (!same(normalizeProfile(reviewedPlan.profile), fresh.profile)) return reject('routine-changed');
  if (reviewedPlan.activeWindow !== true || fresh.activeWindow !== true) return reject('outside-active-window');
  if (!same(reviewedPlan.targets, fresh.targets)) return reject('targets-changed');
  const selectedSet = new Set(selectedTargetIds);
  const targets = fresh.targets.filter((target) => selectedSet.has(target.targetId));
  if (targets.length !== selectedSet.size) return reject('selection-outside-review');
  const action = targets[0].action;
  if (!['follow', 'unfollow'].includes(action) || targets.some((target) => target.action !== action)) {
    return reject('single-action-required');
  }

  const selected = targets.map((target) => target.username);
  const partial = (current.candidates || []).some((candidate) => (
    selectedSet.has(candidate.targetId) && candidate.followsMeEvidence === 'partial-list'
  ));
  const source = 'presence';
  const requested = selected.length;
  const skipped = [];
  for (const decision of fresh.decisions) {
    if (fresh.targets.some((target) => target.targetId === decision.targetId)) continue;
    const existing = skipped.find((entry) => entry.reason === decision.reason);
    if (existing) existing.count += 1;
    else skipped.push({ count: 1, reason: decision.reason });
  }
  const queueDraft = {
    action, omitted: fresh.targets.length - targets.length, removed: 0,
    requested, partial, selected, skipped, source,
    signature: JSON.stringify({ action, requested, selected, source, partial }),
  };
  return freeze({
    kind: 'presence-batch-review-draft', version: 1,
    status: 'review-required', executable: false,
    capabilities: PRESENCE_BATCH_CAPABILITIES,
    liveUnavailableReason: 'presence-trusted-runtime-required',
    accountId: fresh.accountId, createdAt: now, expiresAt,
    bindings: targets.map(({ targetId, username, action: targetAction }) => ({
      accountId: fresh.accountId, targetId, username, action: targetAction,
    })),
    queueDraft,
    confirmationDraft: {
      kind: 'account', action,
      items: targets.map((target, index) => ({
        id: `presence-${action}-${target.targetId}-${index}`, username: target.username,
      })),
      description: `${selected.length} reviewed ${action} target${selected.length === 1 ? '' : 's'}. Nothing has run.`,
    },
  });
}
