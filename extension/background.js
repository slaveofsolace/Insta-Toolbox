import {
  createBridgeHandshakeNonce,
  createSignedBridgeMessage,
  deriveBridgeSessionPairing,
  verifySignedBridgeMessage,
} from './lib/bridge-protocol.js';
import {
  accountIntentMatchesItem as intentMatchesItem,
  normalizeActionUsername as normalizeUsername,
  prepareControlledAccountIntent as prepareLiveAccountIntent,
  pruneControlledAccountState as pruneLiveState,
  publicAccountIntent as publicLiveIntent,
} from './lib/controlled-account-action.js';
import {
  dmIntentMatchesItem,
  prepareControlledDmIntent,
  pruneControlledDmState,
  publicDmIntent,
  verifiedControlledDmResult,
} from './lib/controlled-dm-unsend.js';

const MAX_REPLAY_NONCES = 512;
const MAX_PENDING_JOBS = 50;
const MAX_ACCOUNT_ACTION_LEDGER = 500;
const MAX_DM_ACTION_LEDGER = 500;
const MAX_THREAD_UNSEND_LEDGER = 100;
const DEFAULT_DAILY_ACTION_LIMIT = 100;
const DEFAULT_DAILY_DM_LIMIT = 50;
// Fixed safety ceilings. Instagram penalises fast bulk activity, so the
// batch runner stays well inside commonly reported action thresholds.
const MAX_DAILY_ACTION_LIMIT = 400;
const MAX_DAILY_DM_LIMIT = 300;
const MAX_BATCH_ITEMS = 250;
const RUN_CAPABILITY_TTL_MS = 20 * 60 * 1000;
const EXACT_ITEM_CAPABILITY_TTL_MS = 90 * 1000;
const DEFAULT_BATCH_MIN_DELAY_MS = 4_000;
const DEFAULT_BATCH_MAX_DELAY_MS = 11_000;
const MIN_ALLOWED_BATCH_DELAY_MS = 1_500;
const THREAD_UNSEND_PLAN_TTL_MS = 15 * 60 * 1000;
const THREAD_UNSEND_MIN_DELAY_MS = 1_000;
const THREAD_UNSEND_MAX_DELAY_MS = 2_000;
// After this many consecutive items the runner takes a longer cooldown.
const BATCH_REST_EVERY = 20;
const BATCH_REST_MS = 90_000;
let requestTail = Promise.resolve();
let activeBatchAbort = false;
const accountCapabilities = new Map();
const dmCapabilities = new Map();
const threadUnsendCapabilities = new Map();
const STORAGE_KEYS = Object.freeze({
  bridgePairings: 'instaToolboxBridgePairings',
  bridgeReplayNonces: 'instaToolboxBridgeReplayNonces',
  pendingJobs: 'instaToolboxPendingJobs',
  accountActionLedger: 'instaToolboxAccountActionLedger',
  dmActionLedger: 'instaToolboxDmActionLedger',
  threadUnsendLedger: 'instaToolboxThreadUnsendLedger',
  pendingLiveIntent: 'instaToolboxPendingLiveIntent',
  liveArm: 'instaToolboxLiveArm',
  pendingDmIntent: 'instaToolboxPendingDmIntent',
  dmArm: 'instaToolboxDmArm',
  batchArm: 'instaToolboxBatchArm',
  batchRun: 'instaToolboxBatchRun',
  batchLimits: 'instaToolboxBatchLimits',
});

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeBatchLimits(limits) {
  return {
    dailyActionLimit: clampInteger(
      limits?.dailyActionLimit,
      DEFAULT_DAILY_ACTION_LIMIT,
      1,
      MAX_DAILY_ACTION_LIMIT,
    ),
    dailyDmLimit: clampInteger(
      limits?.dailyDmLimit,
      DEFAULT_DAILY_DM_LIMIT,
      1,
      MAX_DAILY_DM_LIMIT,
    ),
    minDelayMs: clampInteger(
      limits?.minDelayMs,
      DEFAULT_BATCH_MIN_DELAY_MS,
      MIN_ALLOWED_BATCH_DELAY_MS,
      600_000,
    ),
    maxDelayMs: clampInteger(
      limits?.maxDelayMs,
      DEFAULT_BATCH_MAX_DELAY_MS,
      MIN_ALLOWED_BATCH_DELAY_MS,
      900_000,
    ),
  };
}

async function loadBridgeState() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    pairings: Array.isArray(stored[STORAGE_KEYS.bridgePairings])
      ? stored[STORAGE_KEYS.bridgePairings]
      : [],
    replayNonces: Array.isArray(stored[STORAGE_KEYS.bridgeReplayNonces])
      ? stored[STORAGE_KEYS.bridgeReplayNonces]
      : [],
    pendingJobs: Array.isArray(stored[STORAGE_KEYS.pendingJobs])
      ? stored[STORAGE_KEYS.pendingJobs]
      : [],
    accountActionLedger: Array.isArray(stored[STORAGE_KEYS.accountActionLedger])
      ? stored[STORAGE_KEYS.accountActionLedger]
      : [],
    dmActionLedger: Array.isArray(stored[STORAGE_KEYS.dmActionLedger])
      ? stored[STORAGE_KEYS.dmActionLedger]
      : [],
    threadUnsendLedger: Array.isArray(stored[STORAGE_KEYS.threadUnsendLedger])
      ? stored[STORAGE_KEYS.threadUnsendLedger]
      : [],
    pendingLiveIntent: stored[STORAGE_KEYS.pendingLiveIntent] || null,
    // Stored intent records never restore live authority after a worker restart.
    liveArm: null,
    pendingDmIntent: stored[STORAGE_KEYS.pendingDmIntent] || null,
    dmArm: null,
    batchArm: null,
    batchRun: stored[STORAGE_KEYS.batchRun] || null,
    batchLimits: normalizeBatchLimits(stored[STORAGE_KEYS.batchLimits]),
  };
}

async function saveBridgeState(state) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.bridgePairings]: state.pairings,
    [STORAGE_KEYS.bridgeReplayNonces]: state.replayNonces.slice(-MAX_REPLAY_NONCES),
    [STORAGE_KEYS.pendingJobs]: state.pendingJobs.slice(0, MAX_PENDING_JOBS),
    [STORAGE_KEYS.accountActionLedger]: state.accountActionLedger.slice(0, MAX_ACCOUNT_ACTION_LEDGER),
    [STORAGE_KEYS.dmActionLedger]: state.dmActionLedger.slice(0, MAX_DM_ACTION_LEDGER),
    [STORAGE_KEYS.threadUnsendLedger]: state.threadUnsendLedger.slice(0, MAX_THREAD_UNSEND_LEDGER),
    [STORAGE_KEYS.pendingLiveIntent]: state.pendingLiveIntent || null,
    [STORAGE_KEYS.liveArm]: state.liveArm || null,
    [STORAGE_KEYS.pendingDmIntent]: state.pendingDmIntent || null,
    [STORAGE_KEYS.dmArm]: state.dmArm || null,
    [STORAGE_KEYS.batchArm]: state.batchArm || null,
    [STORAGE_KEYS.batchRun]: state.batchRun || null,
    [STORAGE_KEYS.batchLimits]: normalizeBatchLimits(state.batchLimits),
  });
}

function errorPermission(type) {
  return String(type || '').startsWith('action.') ? 'action' : 'read';
}

async function activeInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function instagramTabById(tabId) {
  if (Number.isInteger(tabId)) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (new URL(tab.url || '').origin === 'https://www.instagram.com') return tab;
    } catch {
      return null;
    }
  }
  return activeInstagramTab();
}

async function intentInstagramTab() { return activeInstagramTab(); }

async function dmIntentInstagramTab() { return activeInstagramTab(); }

async function inspectProfileInTab(tabId, username) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-toolbox-inspect-profile',
      username,
    });
  } catch {
    return { unexpectedUi: true, reason: 'inspector-unavailable' };
  }
}

async function inspectDmItemInTab(tabId, item) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-toolbox-inspect-reviewed-dm-item',
      item: {
        conversationId: item.conversationId,
        contentDigest: item.contentDigest,
        messageId: item.messageId,
        sentByMe: item.sentByMe === true,
        timestamp: item.timestamp,
      },
    });
  } catch {
    return { unexpectedUi: true, reason: 'inspector-unavailable' };
  }
}

function directThreadId(value) {
  const text = String(value || '').replaceAll('\\', '/');
  const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
  if (directMatch) return directMatch[1];
  const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
  const exportMatch = finalSegment.match(/_([0-9]+)$/);
  return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
}

function validateThreadUnsendReservation(request, sender, now = Date.now()) {
  const plan = request?.plan;
  const threadId = String(plan?.threadId || '').trim();
  const observedThreadId = directThreadId(sender?.tab?.url || sender?.url);
  const scope = ['all', 'newest', 'oldest'].includes(plan?.scope) ? plan.scope : '';
  const count = scope === 'all' ? null : Number(plan?.limit);
  const expiresAt = Number(plan?.expiresAt);
  const reviewedDigest = String(plan?.reviewedDigest || '');
  if (
    plan?.version !== 2
    || !/^[^/?#\\]{1,256}$/.test(threadId)
    || threadId !== observedThreadId
    || !scope
    || (scope !== 'all' && (!Number.isInteger(count) || count < 1 || count > 5_000))
    || !/^[0-9a-f]{8}$/.test(reviewedDigest)
    || !Number.isFinite(expiresAt)
    || expiresAt <= now
    || expiresAt > now + THREAD_UNSEND_PLAN_TTL_MS
  ) return { error: 'thread-unsend-plan-invalid' };
  return { count, expiresAt, reviewedDigest, scope, threadId, version: 2 };
}

async function reserveThreadUnsendPlan(request, sender, now = Date.now()) {
  const plan = validateThreadUnsendReservation(request, sender, now);
  if (plan.error) return plan;
  for (const [id, capability] of threadUnsendCapabilities) {
    if (capability.expiresAt <= now) threadUnsendCapabilities.delete(id);
  }
  const day = accountActionDay(now);
  const duplicate = [...threadUnsendCapabilities.values()].find((entry) => (
    entry.threadId === plan.threadId
    && entry.reviewedDigest === plan.reviewedDigest
  ));
  if (duplicate) return { error: 'thread-unsend-plan-already-reserved' };
  const reservation = {
    id: `thread-unsend-${createBridgeHandshakeNonce()}`,
    day,
    threadId: plan.threadId,
    reviewedDigest: plan.reviewedDigest,
    count: plan.count,
    scope: plan.scope,
    status: 'reserved',
    reservedAt: new Date(now).toISOString(),
    expiresAt: plan.expiresAt,
    processed: 0,
    failed: 0,
  };
  threadUnsendCapabilities.set(reservation.id, reservation);
  return {
    reservation: {
      ...reservation,
      expiresAt: new Date(reservation.expiresAt).toISOString(),
    },
    pacing: {
      minDelayMs: THREAD_UNSEND_MIN_DELAY_MS,
      maxDelayMs: THREAD_UNSEND_MAX_DELAY_MS,
    },
  };
}

function validateThreadUnsendResultRequest(request, sender) {
  const threadId = String(request?.threadId || '').trim();
  const observedThreadId = directThreadId(sender?.tab?.url || sender?.url);
  const reservationId = String(request?.reservationId || '');
  const reviewedDigest = String(request?.reviewedDigest || '');
  const processed = Number(request?.processed);
  const failed = Number(request?.failed || 0);
  if (
    !/^thread-unsend-[A-Za-z0-9_-]{8,256}$/.test(reservationId)
    || !/^[^/?#\\]{1,256}$/.test(threadId)
    || threadId !== observedThreadId
    || !/^[0-9a-f]{8}$/.test(reviewedDigest)
    || !Number.isInteger(processed)
    || processed < 0
    || processed > 5_000
    || !Number.isInteger(failed)
    || failed < 0
    || failed > 5_000
  ) return { error: 'thread-unsend-result-invalid' };
  return { failed, processed, reservationId, reviewedDigest, threadId };
}

function threadUnsendLedgerResult(reservation, patch, now) {
  return {
    ...reservation,
    expiresAt: new Date(reservation.expiresAt).toISOString(),
    processed: patch.processed,
    failed: patch.failed,
    status: patch.status,
    finishedAt: patch.finishedAt || null,
    lastVerifiedAt: patch.lastVerifiedAt || null,
    recorded: patch.processed > 0,
  };
}

async function writeThreadUnsendLedger(result, suppliedState = null) {
  const state = suppliedState || await loadBridgeState();
  const index = state.threadUnsendLedger.findIndex((entry) => entry?.id === result.id);
  if (index >= 0) state.threadUnsendLedger[index] = result;
  else state.threadUnsendLedger.unshift(result);
  await saveBridgeState(state);
}

async function checkpointThreadUnsendPlan(request, sender, now = Date.now()) {
  const resultRequest = validateThreadUnsendResultRequest(request, sender);
  if (resultRequest.error || resultRequest.processed < 1) {
    return { error: resultRequest.error || 'thread-unsend-result-invalid' };
  }
  let reservation = threadUnsendCapabilities.get(resultRequest.reservationId);
  let state = null;
  let recoveredAfterWorkerRestart = false;
  if (!reservation) {
    state = await loadBridgeState();
    const prior = state.threadUnsendLedger.find((entry) => (
      entry?.id === resultRequest.reservationId
      && entry.threadId === resultRequest.threadId
      && entry.reviewedDigest === resultRequest.reviewedDigest
      && entry.status === 'running'
    ));
    if (prior) {
      reservation = prior;
    } else {
      const recoveryPlan = validateThreadUnsendReservation({ plan: request?.plan }, sender, now);
      if (recoveryPlan.error || resultRequest.processed !== 1) {
        return { error: 'thread-unsend-reservation-missing' };
      }
      reservation = {
        id: resultRequest.reservationId,
        day: accountActionDay(now),
        threadId: recoveryPlan.threadId,
        reviewedDigest: recoveryPlan.reviewedDigest,
        count: recoveryPlan.count,
        scope: recoveryPlan.scope,
        status: 'running',
        reservedAt: null,
        expiresAt: recoveryPlan.expiresAt,
        processed: 0,
        failed: 0,
        recoveredAfterWorkerRestart: true,
        authorityRestored: false,
      };
      recoveredAfterWorkerRestart = true;
    }
  }
  if (
    reservation.threadId !== resultRequest.threadId
    || reservation.reviewedDigest !== resultRequest.reviewedDigest
    || resultRequest.processed !== Number(reservation.processed || 0) + 1
    || (reservation.count !== null && resultRequest.processed > reservation.count)
  ) return { error: 'thread-unsend-reservation-missing' };
  if (threadUnsendCapabilities.has(resultRequest.reservationId)) {
    reservation.processed = resultRequest.processed;
    reservation.failed = resultRequest.failed;
  }
  const checkpoint = threadUnsendLedgerResult(reservation, {
    processed: resultRequest.processed,
    failed: resultRequest.failed,
    status: 'running',
    lastVerifiedAt: new Date(now).toISOString(),
  }, now);
  if (recoveredAfterWorkerRestart) checkpoint.recoveredAfterWorkerRestart = true;
  await writeThreadUnsendLedger(checkpoint, state);
  return { reservation: checkpoint };
}

async function finalizeThreadUnsendPlan(request, sender, now = Date.now()) {
  const resultRequest = validateThreadUnsendResultRequest(request, sender);
  if (resultRequest.error) return resultRequest;
  const {
    failed, processed, reservationId, reviewedDigest, threadId,
  } = resultRequest;
  const resultStatus = ['completed', 'stopped', 'error'].includes(request?.status)
    ? request.status
    : 'error';
  let reservation = threadUnsendCapabilities.get(reservationId);
  let state = null;
  const recoveredFromLedger = !reservation;
  if (!reservation) {
    state = await loadBridgeState();
    reservation = state.threadUnsendLedger.find((entry) => (
      entry?.id === reservationId
      && entry.threadId === threadId
      && entry.reviewedDigest === reviewedDigest
      && entry.status === 'running'
    ));
  }
  if (!reservation) return { error: 'thread-unsend-reservation-missing' };
  if (
    reservation.threadId !== threadId
    || reservation.reviewedDigest !== reviewedDigest
    || processed !== Number(reservation.processed || 0)
    || (reservation.count !== null && processed > reservation.count)
  ) return { error: 'thread-unsend-reservation-missing' };
  if (!recoveredFromLedger) threadUnsendCapabilities.delete(reservationId);
  const result = threadUnsendLedgerResult(reservation, {
    processed,
    failed,
    status: resultStatus === 'completed'
    ? 'succeeded'
    : resultStatus === 'stopped'
      ? 'stopped'
      : processed > 0 ? 'uncertain' : 'failed',
    finishedAt: new Date(now).toISOString(),
    lastVerifiedAt: processed > 0 ? new Date(now).toISOString() : null,
  }, now);
  if (processed === 0) return { reservation: result };
  await writeThreadUnsendLedger(result, state);
  return { reservation: result };
}

function validateReviewedJob(job, expectedKind) {
  if (job?.kind !== expectedKind || !job.id || !Array.isArray(job.items)) {
    return 'invalid-reviewed-job';
  }
  if (job.mode !== 'dry-run') return 'live-execution-disabled';
  if (job.status !== 'ready' || !job.items.length) return 'job-not-ready';
  if (expectedKind === 'insta-toolbox-reviewed-action-job' && !job.confirmedAt) {
    return 'job-not-confirmed';
  }
  if (expectedKind === 'insta-toolbox-reviewed-dm-job' && !job.reviewConfirmedAt) {
    return 'job-not-confirmed';
  }
  return null;
}

async function inspectAccountJob(job) {
  const tab = await activeInstagramTab();
  if (!tab?.id) {
    return {
      jobId: job.id,
      status: 'stopped',
      stopReason: 'instagram-tab-unavailable',
      results: [],
    };
  }
  const results = [];
  for (const item of job.items) {
    let observation;
    try {
      observation = await chrome.tabs.sendMessage(tab.id, {
        kind: 'insta-toolbox-inspect-profile',
        username: item.username,
      });
    } catch {
      observation = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    const matches = (
      observation?.username === item.username
      && !observation.ambiguous
      && !observation.unexpectedUi
      && !observation.sessionExpired
      && !observation.challenge
      && !observation.actionBlocked
      && !observation.rateLimited
    );
    results.push({
      itemId: item.id,
      username: item.username,
      action: item.action,
      status: matches ? 'resolved-no-click' : 'safe-stopped',
      observation,
    });
    if (!matches) break;
  }
  const failed = results.find((result) => result.status === 'safe-stopped');
  return {
    jobId: job.id,
    status: failed ? 'stopped' : 'dry-run-complete',
    stopReason: failed
      ? failed.observation?.reason
        || (failed.observation?.username !== failed.username ? 'wrong-profile' : 'ambiguous-ui')
      : null,
    results,
  };
}

async function inspectDmJob(job) {
  const tab = await activeInstagramTab();
  if (!tab?.id) {
    return {
      jobId: job.id,
      status: 'stopped',
      stopReason: 'instagram-tab-unavailable',
      results: [],
    };
  }

  const results = [];
  for (const item of job.items) {
    let observation;
    try {
      observation = await chrome.tabs.sendMessage(tab.id, {
        kind: 'insta-toolbox-inspect-reviewed-dm-item',
        item: {
          conversationId: item.conversationId,
          contentDigest: item.contentDigest,
          messageId: item.messageId,
          sentByMe: item.sentByMe,
          timestamp: item.timestamp,
        },
      });
    } catch {
      observation = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    const matches = (
      item.sentByMe === true
      && observation?.conversationId === item.conversationId
      && observation?.messageId === item.messageId
      && Number(observation?.timestamp) === Number(item.timestamp)
      && observation?.contentDigest === item.contentDigest
      && observation?.sentByMe === true
      && observation?.exactIdentityAvailable === true
      && observation?.ownershipAvailable === true
      && Boolean(observation?.resolutionToken)
      && !observation?.ambiguous
      && !observation?.unexpectedUi
      && !observation?.sessionExpired
      && !observation?.challenge
      && !observation?.actionBlocked
      && !observation?.rateLimited
    );
    results.push({
      itemId: item.id,
      conversationId: item.conversationId,
      messageId: item.messageId,
      status: matches ? 'resolved-no-click' : 'safe-stopped',
      observation,
    });
    if (!matches) break;
  }

  const failed = results.find((result) => result.status === 'safe-stopped');
  return {
    jobId: job.id,
    status: failed ? 'stopped' : 'dry-run-complete',
    stopReason: failed
      ? failed.observation?.reason || 'exact-message-identity-unavailable'
      : null,
    results,
  };
}

function accountActionDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function accountActionAttemptId(jobId, intent) {
  return `${jobId}:${intent.itemId}:${intent.action}:${intent.username}`;
}

function extensionReservationConflict(state, jobId, intent, now = Date.now()) {
  const ledger = Array.isArray(state.accountActionLedger) ? state.accountActionLedger : [];
  const counted = new Set(['reserved', 'succeeded', 'uncertain']);
  const id = accountActionAttemptId(jobId, intent);
  const existing = ledger.find((entry) => entry.id === id && counted.has(entry.status));
  if (existing) return { reason: 'extension-duplicate-attempt', existing };

  const day = accountActionDay(now);
  const duplicateTarget = ledger.find((entry) => (
    entry.day === day
    && entry.action === intent.action
    && entry.username === intent.username
    && counted.has(entry.status)
  ));
  if (duplicateTarget) return { reason: 'extension-duplicate-account-action', existing: duplicateTarget };

  return null;
}

function reserveExtensionAction(state, jobId, intent, tabId, now = Date.now()) {
  const conflict = extensionReservationConflict(state, jobId, intent, now);
  if (conflict) return { ok: false, ...conflict };
  const record = {
    id: accountActionAttemptId(jobId, intent),
    jobId,
    itemId: intent.itemId,
    action: intent.action,
    username: intent.username,
    tabId,
    day: accountActionDay(now),
    status: 'reserved',
    reservedAt: new Date(now).toISOString(),
    finalizedAt: null,
    result: null,
  };
  state.accountActionLedger.unshift(record);
  return { ok: true, record };
}

function finalizeExtensionAction(state, attemptId, result, succeeded, now = Date.now()) {
  const record = state.accountActionLedger.find((entry) => entry.id === attemptId);
  if (!record) throw new Error('Extension action reservation is missing.');
  record.status = succeeded ? 'succeeded' : 'uncertain';
  record.finalizedAt = new Date(now).toISOString();
  record.result = succeeded
    ? String(result?.result || 'completed')
    : String(result?.reason || 'live-action-not-confirmed');
}

function dmActionAttemptId(jobId, intent) {
  return `${jobId}:${intent.itemId}:${intent.conversationId}:${intent.messageId}`;
}

function extensionDmReservationConflict(state, jobId, intent, now = Date.now()) {
  const ledger = Array.isArray(state.dmActionLedger) ? state.dmActionLedger : [];
  const counted = new Set(['reserved', 'succeeded', 'uncertain']);
  const id = dmActionAttemptId(jobId, intent);
  const existing = ledger.find((entry) => entry.id === id && counted.has(entry.status));
  if (existing) return { reason: 'extension-duplicate-dm-attempt', existing };

  const duplicateMessage = ledger.find((entry) => (
    entry.conversationId === intent.conversationId
    && entry.messageId === intent.messageId
    && counted.has(entry.status)
  ));
  if (duplicateMessage) return { reason: 'extension-duplicate-dm-message', existing: duplicateMessage };

  return null;
}

function reserveExtensionDmAction(state, jobId, intent, pairingId, tabId, now = Date.now()) {
  const conflict = extensionDmReservationConflict(state, jobId, intent, now);
  if (conflict) return { ok: false, ...conflict };
  const record = {
    id: dmActionAttemptId(jobId, intent),
    jobId,
    itemId: intent.itemId,
    conversationId: intent.conversationId,
    messageId: intent.messageId,
    pairingId,
    tabId,
    day: accountActionDay(now),
    status: 'reserved',
    reservedAt: new Date(now).toISOString(),
    finalizedAt: null,
    result: null,
  };
  state.dmActionLedger.unshift(record);
  return { ok: true, record };
}

function finalizeExtensionDmAction(state, attemptId, result, succeeded, now = Date.now()) {
  const record = state.dmActionLedger.find((entry) => entry.id === attemptId);
  if (!record) throw new Error('Extension DM reservation is missing.');
  record.status = succeeded ? 'succeeded' : 'uncertain';
  record.finalizedAt = new Date(now).toISOString();
  record.result = succeeded
    ? String(result?.result || 'unsent')
    : String(result?.reason || 'live-dm-not-confirmed');
}

function matchingDmAttempt(state, pairing, jobId, item) {
  return state.dmActionLedger.find((entry) => (
    entry.jobId === jobId
    && entry.itemId === item?.id
    && entry.conversationId === String(item?.conversationId || '')
    && entry.messageId === String(item?.messageId || '')
    && entry.pairingId === pairing.pairingId
    && ['succeeded', 'uncertain'].includes(entry.status)
  )) || null;
}

function exactCapabilityKey(pairingId, jobId, itemId) {
  return `${String(pairingId || '')}:${String(jobId || '')}:${String(itemId || '')}`;
}

function pruneTransientCapabilities(now = Date.now()) {
  for (const [key, capability] of accountCapabilities) {
    if (capability.expiresAt <= now) accountCapabilities.delete(key);
  }
  for (const [key, capability] of dmCapabilities) {
    if (capability.expiresAt <= now) dmCapabilities.delete(key);
  }
}

function accountConfirmationMatches(confirmation, intent) {
  return Boolean(
    confirmation?.confirmed === true
    && Number(confirmation.count) === 1
    && confirmation.action === intent?.action
    && normalizeUsername(confirmation.username) === intent?.username,
  );
}

function dmConfirmationMatches(confirmation, intent) {
  return Boolean(
    confirmation?.confirmed === true
    && confirmation.action === 'unsend'
    && Number(confirmation.count) === 1
    && String(confirmation.conversationId || '') === intent?.conversationId
    && String(confirmation.messageId || '') === intent?.messageId,
  );
}

function consumeTransientCapability(map, key, matches, now = Date.now()) {
  pruneTransientCapabilities(now);
  const capability = map.get(key);
  if (!capability || !matches(capability)) return null;
  map.delete(key);
  return capability;
}

async function dmLiveReadiness(state, pairing, jobId, item, confirmation, now = Date.now()) {
  pruneControlledDmState(state, now);
  const intent = state.pendingDmIntent;
  if (!dmIntentMatchesItem(intent, jobId, item) || intent?.pairingId !== pairing.pairingId) {
    return { authorized: false, reason: 'dm-live-intent-required' };
  }
  if (!dmConfirmationMatches(confirmation, intent)) {
    return { authorized: false, reason: 'dm-exact-confirmation-required', intent: publicDmIntent(intent) };
  }
  if (!item?.resolutionToken) {
    return { authorized: false, reason: 'exact-dm-resolution-required' };
  }
  const reservationConflict = extensionDmReservationConflict(state, jobId, intent, now);
  if (reservationConflict) {
    return { authorized: false, reason: reservationConflict.reason };
  }
  const tab = await dmIntentInstagramTab();
  if (!tab?.id || directThreadId(tab.url) !== directThreadId(intent.conversationId)) {
    return { authorized: false, reason: 'wrong-conversation' };
  }
  const key = exactCapabilityKey(pairing.pairingId, jobId, item.id);
  dmCapabilities.set(key, {
    conversationId: intent.conversationId,
    expiresAt: now + EXACT_ITEM_CAPABILITY_TTL_MS,
    messageId: intent.messageId,
    resolutionToken: item.resolutionToken,
    tabId: tab.id,
  });
  return {
    authorized: true,
    expiresAt: new Date(now + EXACT_ITEM_CAPABILITY_TTL_MS).toISOString(),
    intent: publicDmIntent(intent),
  };
}

async function performLiveDmUnsend(state, pairing, jobId, item) {
  const intent = state.pendingDmIntent;
  if (!dmIntentMatchesItem(intent, jobId, item) || intent?.pairingId !== pairing.pairingId) {
    return { authorized: false, reason: 'dm-live-intent-required' };
  }
  const key = exactCapabilityKey(pairing.pairingId, jobId, item?.id);
  const capability = consumeTransientCapability(dmCapabilities, key, (candidate) => (
    candidate.conversationId === intent.conversationId
    && candidate.messageId === intent.messageId
    && candidate.resolutionToken === item?.resolutionToken
  ));
  if (!capability) return { authorized: false, reason: 'dm-exact-confirmation-required' };
  const tab = await instagramTabById(capability.tabId);
  if (!tab?.id || tab.id !== capability.tabId
    || directThreadId(tab.url) !== directThreadId(intent.conversationId)) {
    return { authorized: false, reason: 'wrong-conversation' };
  }
  const reservation = reserveExtensionDmAction(
    state,
    jobId,
    intent,
    pairing.pairingId,
    tab.id,
  );
  if (!reservation.ok) return { authorized: false, reason: reservation.reason };

  // Reserve and consume the one-shot DM capability durably before the first page control is used.
  state.dmArm = null;
  state.pendingDmIntent = null;
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, {
      kind: 'insta-toolbox-perform-reviewed-dm-unsend',
      item: {
        conversationId: intent.conversationId,
        contentDigest: intent.contentDigest,
        messageId: intent.messageId,
        resolutionToken: item.resolutionToken,
        sentByMe: true,
        timestamp: intent.timestamp,
      },
    });
  } catch {
    result = { unexpectedUi: true, reason: 'live-dm-inspector-unavailable' };
  }

  const succeeded = verifiedControlledDmResult(intent, result);
  finalizeExtensionDmAction(state, reservation.record.id, result, succeeded);
  state.pendingJobs.unshift({
    kind: 'insta-toolbox-reviewed-dm-job',
    jobId,
    receivedAt: new Date().toISOString(),
    mode: 'live',
    result: {
      jobId,
      status: succeeded ? 'completed' : 'stopped',
      stopReason: succeeded ? null : result?.reason || 'live-dm-not-confirmed',
      results: [{
        itemId: intent.itemId,
        conversationId: intent.conversationId,
        messageId: intent.messageId,
        status: succeeded ? 'completed' : 'safe-stopped',
      }],
    },
  });
  await saveBridgeState(state);
  return result || { unexpectedUi: true, reason: 'empty-live-dm-result' };
}

function profileUsernameFromUrl(value) {
  try {
    return normalizeUsername(new URL(value || '').pathname.split('/').filter(Boolean)[0]);
  } catch {
    return '';
  }
}

async function accountLiveReadiness(state, pairing, jobId, item, confirmation, now = Date.now()) {
  pruneLiveState(state, now);
  const intent = state.pendingLiveIntent;
  if (!intentMatchesItem(intent, jobId, item) || intent?.pairingId !== pairing.pairingId) {
    return { authorized: false, reason: 'live-intent-required' };
  }
  if (!accountConfirmationMatches(confirmation, intent)) {
    return { authorized: false, reason: 'exact-account-confirmation-required', intent: publicLiveIntent(intent) };
  }
  if (
    !item?.resolutionToken
    || !['following', 'not-following'].includes(item.expectedRelationship)
  ) {
    return { authorized: false, reason: 'exact-profile-resolution-required' };
  }
  const reservationConflict = extensionReservationConflict(state, jobId, intent, now);
  if (reservationConflict) {
    return {
      authorized: false,
      reason: reservationConflict.reason,
    };
  }
  const tab = await intentInstagramTab();
  if (!tab?.id || profileUsernameFromUrl(tab.url) !== intent.username) {
    return { authorized: false, reason: 'wrong-profile' };
  }
  const key = exactCapabilityKey(pairing.pairingId, jobId, item.id);
  accountCapabilities.set(key, {
    action: intent.action,
    expiresAt: now + EXACT_ITEM_CAPABILITY_TTL_MS,
    resolutionToken: item.resolutionToken,
    tabId: tab.id,
    username: intent.username,
  });
  return {
    authorized: true,
    expiresAt: new Date(now + EXACT_ITEM_CAPABILITY_TTL_MS).toISOString(),
    intent: publicLiveIntent(intent),
  };
}

async function performLiveAccountAction(state, pairing, jobId, item) {
  const intent = state.pendingLiveIntent;
  if (!intentMatchesItem(intent, jobId, item) || intent?.pairingId !== pairing.pairingId) {
    return { authorized: false, reason: 'live-intent-required' };
  }
  const key = exactCapabilityKey(pairing.pairingId, jobId, item?.id);
  const capability = consumeTransientCapability(accountCapabilities, key, (candidate) => (
    candidate.action === intent.action
    && candidate.username === intent.username
    && candidate.resolutionToken === item?.resolutionToken
  ));
  if (!capability) return { authorized: false, reason: 'exact-account-confirmation-required' };
  const tab = await instagramTabById(capability.tabId);
  if (!tab?.id || tab.id !== capability.tabId || profileUsernameFromUrl(tab.url) !== intent.username) {
    return { authorized: false, reason: 'wrong-profile' };
  }
  const reservation = reserveExtensionAction(state, jobId, intent, tab.id);
  if (!reservation.ok) {
    return { authorized: false, reason: reservation.reason };
  }

  // The transient capability was consumed above. Reserve durably before the
  // first page control is used so retries cannot duplicate the mutation.
  state.liveArm = null;
  state.pendingLiveIntent = null;
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, {
      kind: 'insta-toolbox-perform-reviewed-profile-action',
      item: {
        action: intent.action,
        expectedRelationship: item.expectedRelationship,
        resolutionToken: item.resolutionToken,
        username: intent.username,
      },
    });
  } catch {
    result = { unexpectedUi: true, reason: 'live-action-inspector-unavailable' };
  }

  const succeeded = Boolean(result?.result)
    && !result?.ambiguous
    && !result?.unexpectedUi
    && !result?.sessionExpired
    && !result?.challenge
    && !result?.actionBlocked
    && !result?.rateLimited;
  finalizeExtensionAction(state, reservation.record.id, result, succeeded);
  state.pendingJobs.unshift({
    kind: 'insta-toolbox-reviewed-action-job',
    jobId,
    receivedAt: new Date().toISOString(),
    mode: 'live',
    result: {
      jobId,
      status: succeeded ? 'completed' : 'stopped',
      stopReason: succeeded ? null : result?.reason || 'live-action-not-confirmed',
      results: [{
        itemId: intent.itemId,
        username: intent.username,
        action: intent.action,
        status: succeeded ? 'completed' : 'safe-stopped',
      }],
    },
  });
  await saveBridgeState(state);
  return result || { unexpectedUi: true, reason: 'empty-live-action-result' };
}

// ---------------------------------------------------------------------------
// Batch runner
//
// The audited controlled path stays one-shot: every item below still runs a
// complete inspect -> exact-resolution -> reserve -> perform -> finalize cycle
// against the live DOM. The batch layer binds one ordinary confirmation to an
// exact finite target digest, and it stops the whole run the moment
// Instagram signals a challenge, rate limit, block, or an unexpected surface.
// ---------------------------------------------------------------------------

function batchTargetDigest(kind, action, items) {
  const source = JSON.stringify((items || []).map((item) => (
    kind === 'account'
      ? [String(item?.id || ''), normalizeUsername(item?.username)]
      : [String(item?.id || ''), String(item?.messageId || ''), String(item?.threadId || '')]
  )));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${kind}:${action || ''}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function sessionStopReason(observation) {
  if (observation?.sessionExpired) return 'session-expired';
  if (observation?.challenge) return 'challenge-required';
  if (observation?.actionBlocked) return 'action-blocked';
  if (observation?.rateLimited) return 'rate-limited';
  return null;
}

function jitteredDelay(limits) {
  const min = Math.min(limits.minDelayMs, limits.maxDelayMs);
  const max = Math.max(limits.minDelayMs, limits.maxDelayMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function tabSettled(tabId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (tab.status === 'complete') return true;
    await sleep(250);
  }
  return false;
}

// Follow/unfollow targets live on their own profile pages, so the armed tab is
// navigated to each target before the exact-resolution check runs.
async function navigateToProfile(tabId, username) {
  const target = `https://www.instagram.com/${username}/`;
  try {
    const tab = await chrome.tabs.get(tabId);
    const current = normalizeUsername(new URL(tab.url || '').pathname);
    if (current === username) return true;
    await chrome.tabs.update(tabId, { url: target });
  } catch {
    return false;
  }
  if (!await tabSettled(tabId)) return false;
  // Instagram hydrates its profile header after load; give it a moment.
  await sleep(1_200);
  return true;
}

async function runBatchAccountItem(state, tabId, jobId, item, limits) {
  if (!item.username) {
    return { status: 'skipped', reason: 'invalid-username', fatal: false };
  }
  if (!await navigateToProfile(tabId, item.username)) {
    return { status: 'skipped', reason: 'profile-navigation-failed', fatal: false };
  }
  // Instagram hydrates the profile header after load, and the content script may
  // not have re-injected yet. A single attempt would report the target as
  // unresolvable and silently skip it, which on a slow connection could drop
  // most of a batch. Retry briefly before believing the target is not there.
  let observation = await inspectProfileInTab(tabId, item.username);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (sessionStopReason(observation)) break;
    if (observation?.username === item.username && observation?.resolutionToken) break;
    await sleep(1_000);
    observation = await inspectProfileInTab(tabId, item.username);
  }
  const stop = sessionStopReason(observation);
  if (stop) return { status: 'stopped', stopReason: stop, fatal: true };

  const expectedRelationship = item.action === 'follow' ? 'not-following' : 'following';
  if (
    observation?.username !== item.username
    || observation?.relationship !== expectedRelationship
    || observation?.ambiguous
    || observation?.unexpectedUi
    || !observation?.resolutionToken
  ) {
    return {
      status: 'skipped',
      reason: observation?.username !== item.username
        ? 'wrong-profile'
        : observation?.reason || 'relationship-mismatch',
      fatal: false,
    };
  }

  const intent = {
    action: item.action,
    itemId: item.id,
    jobId,
    username: item.username,
  };
  const reservation = reserveExtensionAction(state, jobId, intent, tabId);
  if (!reservation.ok) {
    return {
      status: 'skipped',
      reason: reservation.reason,
      fatal: reservation.reason === 'extension-daily-limit',
    };
  }
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-toolbox-perform-reviewed-profile-action',
      item: {
        action: item.action,
        expectedRelationship,
        resolutionToken: observation.resolutionToken,
        username: item.username,
      },
    });
  } catch {
    result = { unexpectedUi: true, reason: 'live-action-inspector-unavailable' };
  }

  const succeeded = Boolean(result?.result)
    && !result?.ambiguous
    && !result?.unexpectedUi
    && !result?.sessionExpired
    && !result?.challenge
    && !result?.actionBlocked
    && !result?.rateLimited;
  finalizeExtensionAction(state, reservation.record.id, result, succeeded);
  await saveBridgeState(state);

  const resultStop = sessionStopReason(result);
  if (resultStop) return { status: 'stopped', stopReason: resultStop, fatal: true };
  return succeeded
    ? { status: 'completed', result: String(result.result), fatal: false }
    : { status: 'failed', reason: result?.reason || 'live-action-not-confirmed', fatal: false };
}

async function runBatchDmItem(state, pairingId, tabId, jobId, item, limits) {
  const observation = await inspectDmItemInTab(tabId, {
    conversationId: item.conversationId,
    contentDigest: item.contentDigest,
    messageId: item.messageId,
    sentByMe: true,
    timestamp: item.timestamp,
  });
  const stop = sessionStopReason(observation);
  if (stop) return { status: 'stopped', stopReason: stop, fatal: true };

  if (
    observation?.conversationId !== String(item.conversationId)
    || observation?.messageId !== String(item.messageId)
    || Number(observation?.timestamp) !== Number(item.timestamp)
    || observation?.contentDigest !== item.contentDigest
    || observation?.sentByMe !== true
    || observation?.exactIdentityAvailable !== true
    || observation?.ownershipAvailable !== true
    || observation?.ambiguous
    || observation?.unexpectedUi
    || !observation?.resolutionToken
  ) {
    return {
      status: 'skipped',
      reason: observation?.reason || 'exact-dm-resolution-required',
      fatal: false,
    };
  }

  const intent = {
    conversationId: String(item.conversationId),
    contentDigest: item.contentDigest,
    itemId: item.id,
    jobId,
    messageId: String(item.messageId),
    timestamp: Number(item.timestamp),
  };
  const reservation = reserveExtensionDmAction(state, jobId, intent, pairingId, tabId);
  if (!reservation.ok) {
    return {
      status: 'skipped',
      reason: reservation.reason,
      fatal: reservation.reason === 'extension-daily-dm-limit',
    };
  }
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-toolbox-perform-reviewed-dm-unsend',
      item: {
        conversationId: intent.conversationId,
        contentDigest: intent.contentDigest,
        messageId: intent.messageId,
        resolutionToken: observation.resolutionToken,
        sentByMe: true,
        timestamp: intent.timestamp,
      },
    });
  } catch {
    result = { unexpectedUi: true, reason: 'live-dm-inspector-unavailable' };
  }

  const succeeded = verifiedControlledDmResult(intent, result);
  finalizeExtensionDmAction(state, reservation.record.id, result, succeeded);
  await saveBridgeState(state);

  const resultStop = sessionStopReason(result);
  if (resultStop) return { status: 'stopped', stopReason: resultStop, fatal: true };
  return succeeded
    ? { status: 'completed', result: 'unsent', fatal: false }
    : { status: 'failed', reason: result?.reason || 'live-dm-not-confirmed', fatal: false };
}

async function startBatch(request, sender, pairingId = null) {
  const state = await loadBridgeState();
  const now = Date.now();
  if (!Number.isInteger(sender?.tab?.id)) return { error: 'instagram-tab-required' };
  if (state.batchRun?.status === 'running') return { error: 'batch-already-running' };

  const kind = request?.batchKind === 'dm' ? 'dm' : 'account';
  const action = kind === 'account' ? String(request?.action || '') : null;
  if (kind === 'account' && !['follow', 'unfollow'].includes(action)) {
    return { error: 'batch-action-invalid' };
  }
  const items = Array.isArray(request?.items) ? request.items.slice(0, MAX_BATCH_ITEMS) : [];
  if (!items.length) return { error: 'batch-items-required' };
  const confirmation = request?.confirmation;
  const targetDigest = batchTargetDigest(kind, action, items);
  if (request?.confirmed !== true
    || Number(confirmation?.count) !== items.length
    || (confirmation?.action ?? null) !== action
    || confirmation?.targetDigest !== targetDigest) {
    return { error: 'batch-confirmation-mismatch' };
  }
  const capability = {
    kind,
    action,
    count: items.length,
    jobId: String(request?.jobId || `batch-${now}`),
    tabId: sender.tab.id,
    targetDigest,
    expiresAt: new Date(now + RUN_CAPABILITY_TTL_MS).toISOString(),
  };

  const limits = normalizeBatchLimits(state.batchLimits);
  const runId = `run-${now}`;
  state.batchRun = {
    id: runId,
    kind: capability.kind,
    action: capability.action,
    jobId: capability.jobId,
    status: 'running',
    total: items.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    startedAt: new Date(now).toISOString(),
    finishedAt: null,
    stopReason: null,
    currentIndex: 0,
    currentLabel: '',
    nextActionAt: null,
    results: [],
  };
  // The arm authorises exactly this run; it cannot be replayed for another.
  // A previous persisted arm is migration-only. The capability above lives in
  // this call and is consumed by this exact run; it is never saved for replay.
  state.batchArm = null;
  activeBatchAbort = false;
  await saveBridgeState(state);

  // Run detached so the caller gets an immediate acknowledgement and can poll.
  void executeBatch(runId, capability, items, limits, pairingId);
  return { run: { ...state.batchRun }, state: overlayState(state) };
}

async function executeBatch(runId, arm, items, limits, pairingId) {
  let index = 0;
  for (const rawItem of items) {
    if (activeBatchAbort) break;
    const state = await loadBridgeState();
    if (state.batchRun?.id !== runId || state.batchRun.status !== 'running') return;

    const item = {
      ...rawItem,
      id: String(rawItem?.id || `${runId}-${index}`),
      username: arm.kind === 'account' ? normalizeUsername(rawItem?.username) : null,
      action: arm.kind === 'account' ? arm.action : null,
    };
    state.batchRun.currentIndex = index;
    state.batchRun.currentLabel = arm.kind === 'account'
      ? `@${item.username}`
      : String(item.preview || item.messageId || '');
    await saveBridgeState(state);

    let outcome;
    try {
      outcome = arm.kind === 'account'
        ? await runBatchAccountItem(state, arm.tabId, arm.jobId, item, limits)
        : await runBatchDmItem(state, pairingId, arm.tabId, arm.jobId, item, limits);
    } catch {
      outcome = { status: 'failed', reason: 'batch-item-threw', fatal: false };
    }

    const after = await loadBridgeState();
    if (after.batchRun?.id !== runId) return;
    after.batchRun.results.unshift({
      index,
      label: arm.kind === 'account' ? item.username : item.messageId,
      status: outcome.status,
      reason: outcome.reason || outcome.stopReason || null,
      at: new Date().toISOString(),
    });
    after.batchRun.results = after.batchRun.results.slice(0, MAX_BATCH_ITEMS);
    if (outcome.status === 'completed') after.batchRun.completed += 1;
    else if (outcome.status === 'skipped') after.batchRun.skipped += 1;
    else after.batchRun.failed += 1;

    if (outcome.fatal) {
      after.batchRun.status = 'stopped';
      after.batchRun.stopReason = outcome.stopReason || outcome.reason || 'safe-stop';
      after.batchRun.finishedAt = new Date().toISOString();
      await saveBridgeState(after);
      return;
    }

    index += 1;
    const isLast = index >= items.length;
    let waitMs = 0;
    if (!isLast) {
      waitMs = jitteredDelay(limits);
      if (index % BATCH_REST_EVERY === 0) waitMs += BATCH_REST_MS;
      after.batchRun.nextActionAt = new Date(Date.now() + waitMs).toISOString();
    }
    await saveBridgeState(after);
    if (!isLast) await sleep(waitMs);
  }

  const final = await loadBridgeState();
  if (final.batchRun?.id !== runId) return;
  final.batchRun.status = activeBatchAbort ? 'aborted' : 'completed';
  final.batchRun.stopReason = activeBatchAbort ? 'stopped-by-user' : null;
  final.batchRun.nextActionAt = null;
  final.batchRun.finishedAt = new Date().toISOString();
  await saveBridgeState(final);
}

async function abortBatch() {
  activeBatchAbort = true;
  const state = await loadBridgeState();
  if (state.batchRun?.status === 'running') {
    state.batchRun.status = 'aborted';
    state.batchRun.stopReason = 'stopped-by-user';
    state.batchRun.nextActionAt = null;
    state.batchRun.finishedAt = new Date().toISOString();
    await saveBridgeState(state);
  }
  return { run: state.batchRun ? { ...state.batchRun } : null };
}

async function batchStatus() {
  const state = await loadBridgeState();
  return {
    run: state.batchRun ? { ...state.batchRun } : null,
    arm: null,
    limits: normalizeBatchLimits(state.batchLimits),
  };
}

async function updateBatchLimits(request) {
  const state = await loadBridgeState();
  state.batchLimits = normalizeBatchLimits({
    ...normalizeBatchLimits(state.batchLimits),
    ...(request?.limits || {}),
  });
  await saveBridgeState(state);
  return { limits: state.batchLimits };
}

async function cancelPendingAccountIntent() {
  const state = await loadBridgeState();
  state.pendingLiveIntent = null;
  state.liveArm = null;
  await saveBridgeState(state);
  return { state: overlayState(state) };
}

async function cancelPendingDmIntent() {
  const state = await loadBridgeState();
  state.pendingDmIntent = null;
  state.dmArm = null;
  await saveBridgeState(state);
  return { state: overlayState(state) };
}

async function routeVerifiedRequest(request, pairing, state) {
  pruneLiveState(state);
  pruneControlledDmState(state);
  if (request.type === 'bridge.ping') {
    return {
      responseType: 'read.bridge-status',
      payload: {
        extensionVersion: chrome.runtime.getManifest().version,
        permissions: pairing.permissions,
        controlledAccountActionsAvailable: true,
        controlledDmUnsendAvailable: true,
        exactConfirmationRequired: true,
        liveExecutionEnabled: false,
        pendingLiveIntent: publicLiveIntent(state.pendingLiveIntent),
        liveArm: null,
        pendingDmIntent: publicDmIntent(state.pendingDmIntent),
        dmArm: null,
      },
    };
  }

  if (request.type === 'action.account-live-intent') {
    const prepared = prepareLiveAccountIntent(request.payload?.job, pairing, state);
    if (prepared.error) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: prepared.error },
      };
    }
    state.pendingDmIntent = null;
    state.dmArm = null;
    return {
      responseType: 'action.account-live-intent-result',
      payload: prepared,
    };
  }

  if (request.type === 'action.dm-live-intent') {
    const prepared = prepareControlledDmIntent(request.payload?.job, pairing, state);
    if (prepared.error) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: prepared.error },
      };
    }
    state.pendingLiveIntent = null;
    state.liveArm = null;
    return {
      responseType: 'action.dm-live-intent-result',
      payload: prepared,
    };
  }

  if (request.type === 'action.account-session') {
    const intent = state.pendingLiveIntent;
    if (!intent || intent.jobId !== request.payload?.jobId || intent.pairingId !== pairing.pairingId) {
      return {
        responseType: 'action.account-session-result',
        payload: { unexpectedUi: true, reason: 'live-intent-required' },
      };
    }
    const tab = await intentInstagramTab(state);
    let result;
    try {
      result = tab?.id
        ? await chrome.tabs.sendMessage(tab.id, { kind: 'insta-toolbox-inspect-session' })
        : { unexpectedUi: true, reason: 'instagram-tab-unavailable' };
    } catch {
      result = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    return {
      responseType: 'action.account-session-result',
      payload: result,
    };
  }

  if (request.type === 'action.account-profile') {
    const intent = state.pendingLiveIntent;
    const username = normalizeUsername(request.payload?.username);
    if (
      !intent
      || intent.jobId !== request.payload?.jobId
      || intent.pairingId !== pairing.pairingId
      || username !== intent.username
    ) {
      return {
        responseType: 'action.account-profile-result',
        payload: { unexpectedUi: true, reason: 'live-intent-mismatch' },
      };
    }
    const tab = await intentInstagramTab(state);
    const result = tab?.id
      ? await inspectProfileInTab(tab.id, username)
      : { unexpectedUi: true, reason: 'instagram-tab-unavailable' };
    return {
      responseType: 'action.account-profile-result',
      payload: result,
    };
  }

  if (request.type === 'action.account-live-readiness') {
    return {
      responseType: 'action.account-live-readiness-result',
      payload: await accountLiveReadiness(
        state,
        pairing,
        request.payload?.jobId,
        request.payload?.item,
        request.payload?.confirmation,
      ),
    };
  }

  if (request.type === 'action.account-perform') {
    return {
      responseType: 'action.account-perform-result',
      payload: await performLiveAccountAction(
        state,
        pairing,
        request.payload?.jobId,
        request.payload?.item,
      ),
    };
  }

  if (request.type === 'action.dm-session') {
    const intent = state.pendingDmIntent;
    if (!intent || intent.jobId !== request.payload?.jobId || intent.pairingId !== pairing.pairingId) {
      return {
        responseType: 'action.dm-session-result',
        payload: { unexpectedUi: true, reason: 'dm-live-intent-required' },
      };
    }
    const tab = await dmIntentInstagramTab(state);
    let result;
    try {
      result = tab?.id
        ? await chrome.tabs.sendMessage(tab.id, { kind: 'insta-toolbox-inspect-session' })
        : { unexpectedUi: true, reason: 'instagram-tab-unavailable' };
    } catch {
      result = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    return { responseType: 'action.dm-session-result', payload: result };
  }

  if (request.type === 'action.dm-conversation') {
    const intent = state.pendingDmIntent;
    const conversationId = String(request.payload?.conversationId || '');
    if (
      !intent
      || intent.jobId !== request.payload?.jobId
      || intent.pairingId !== pairing.pairingId
      || conversationId !== intent.conversationId
    ) {
      return {
        responseType: 'action.dm-conversation-result',
        payload: { unexpectedUi: true, reason: 'dm-live-intent-mismatch' },
      };
    }
    const tab = await dmIntentInstagramTab(state);
    const expectedThreadId = directThreadId(intent.conversationId);
    const observedThreadId = directThreadId(tab?.url);
    const exact = Boolean(tab?.id && expectedThreadId && expectedThreadId === observedThreadId);
    return {
      responseType: 'action.dm-conversation-result',
      payload: exact
        ? { conversationId: intent.conversationId, unexpectedUi: false }
        : { ambiguous: true, reason: 'wrong-conversation' },
    };
  }

  if (request.type === 'action.dm-message') {
    const item = request.payload?.item;
    const jobId = request.payload?.jobId;
    const intent = state.pendingDmIntent;
    let tab = null;
    if (dmIntentMatchesItem(intent, jobId, item) && intent?.pairingId === pairing.pairingId) {
      tab = await dmIntentInstagramTab(state);
    } else {
      const attempt = matchingDmAttempt(state, pairing, jobId, item);
      if (attempt) {
        try {
          tab = await chrome.tabs.get(attempt.tabId);
          if (new URL(tab?.url || '').origin !== 'https://www.instagram.com') tab = null;
        } catch {
          tab = null;
        }
      }
    }
    const result = tab?.id
      ? await inspectDmItemInTab(tab.id, item)
      : { unexpectedUi: true, reason: 'dm-live-intent-mismatch' };
    return { responseType: 'action.dm-message-result', payload: result };
  }

  if (request.type === 'action.dm-live-readiness') {
    return {
      responseType: 'action.dm-live-readiness-result',
      payload: await dmLiveReadiness(
        state,
        pairing,
        request.payload?.jobId,
        request.payload?.item,
        request.payload?.confirmation,
      ),
    };
  }

  if (request.type === 'action.dm-perform') {
    return {
      responseType: 'action.dm-perform-result',
      payload: await performLiveDmUnsend(
        state,
        pairing,
        request.payload?.jobId,
        request.payload?.item,
      ),
    };
  }

  if (request.type === 'read.visible-accounts') {
    const tab = await activeInstagramTab();
    if (!tab?.id) {
      return {
        responseType: 'read.visible-accounts-result',
        payload: { error: 'instagram-tab-unavailable', accounts: [] },
      };
    }
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        kind: 'insta-toolbox-capture-visible-accounts',
      });
    } catch {
      result = { error: 'inspector-unavailable', accounts: [] };
    }
    return {
      responseType: 'read.visible-accounts-result',
      payload: result,
    };
  }

  if (request.type === 'action.account-job') {
    const job = request.payload?.job;
    const invalid = validateReviewedJob(job, 'insta-toolbox-reviewed-action-job');
    if (invalid) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: invalid },
      };
    }
    const result = await inspectAccountJob(job);
    state.pendingJobs.unshift({
      kind: job.kind,
      jobId: job.id,
      receivedAt: new Date().toISOString(),
      mode: 'dry-run',
      result,
    });
    return {
      responseType: 'action.dry-run-result',
      payload: result,
    };
  }

  if (request.type === 'action.dm-job') {
    const job = request.payload?.job;
    const invalid = validateReviewedJob(job, 'insta-toolbox-reviewed-dm-job');
    if (invalid) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: invalid },
      };
    }
    const result = await inspectDmJob(job);
    state.pendingJobs.unshift({
      kind: job.kind,
      jobId: job.id,
      receivedAt: new Date().toISOString(),
      mode: 'dry-run',
      result,
    });
    return {
      responseType: 'action.dry-run-result',
      payload: result,
    };
  }

  return {
    responseType: `${errorPermission(request.type)}.bridge-error`,
    payload: { reason: 'unsupported-message-type' },
  };
}

async function handleBridgeRequest(input) {
  const state = await loadBridgeState();
  const request = input.message;
  const pairingIndex = state.pairings.findIndex((candidate) => (
    candidate.pairingId === request?.pairingId
  ));
  if (pairingIndex < 0) return { error: 'pairing-not-found' };
  const pairing = state.pairings[pairingIndex];
  const usedNonces = new Set(state.replayNonces
    .filter((entry) => entry.pairingId === pairing.pairingId)
    .map((entry) => entry.nonce));
  const verified = await verifySignedBridgeMessage(request, pairing, {
    origin: input.origin,
    usedNonces,
  });
  if (!verified.ok) return { error: verified.reason };

  state.replayNonces.push({
    pairingId: pairing.pairingId,
    nonce: request.nonce,
    usedAt: new Date().toISOString(),
  });

  if (request.type === 'bridge.pair') {
    if (pairing.pairedAt) return { error: 'pairing-code-consumed' };
    const extensionNonce = createBridgeHandshakeNonce();
    const response = await createSignedBridgeMessage(
      pairing,
      'read.pairing-complete',
      { extensionNonce },
      { requestId: request.requestId },
    );
    state.pairings[pairingIndex] = await deriveBridgeSessionPairing(pairing, {
      clientNonce: request.payload?.clientNonce,
      extensionNonce,
    });
    await saveBridgeState(state);
    return { message: response };
  }

  if (!pairing.pairedAt) return { error: 'pairing-incomplete' };
  const routed = await routeVerifiedRequest(request, pairing, state);
  const response = await createSignedBridgeMessage(
    pairing,
    routed.responseType,
    routed.payload,
    { requestId: request.requestId },
  );
  await saveBridgeState(state);
  return { message: response };
}

function bridgeSenderOrigin(sender) {
  try {
    return new URL(sender?.url || sender?.tab?.url || '').origin;
  } catch {
    return null;
  }
}

function overlayState(state) {
  pruneLiveState(state);
  pruneControlledDmState(state);
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    controlledAccountActionsAvailable: true,
    controlledDmUnsendAvailable: true,
    exactConfirmationRequired: true,
    liveExecutionEnabled: false,
    pendingLiveIntent: publicLiveIntent(state.pendingLiveIntent),
    liveArm: null,
    pendingDmIntent: publicDmIntent(state.pendingDmIntent),
    dmArm: null,
    pairings: state.pairings.map((pairing) => ({
      origin: pairing.origin,
      permissions: Array.isArray(pairing.permissions) ? [...pairing.permissions] : [],
      pairedAt: pairing.pairedAt || null,
    })),
    recentRuns: state.pendingJobs.slice(0, 12).map((job) => ({
      kind: job.kind,
      jobId: job.jobId,
      receivedAt: job.receivedAt,
      mode: job.mode === 'live' ? 'live' : 'dry-run',
      status: job.result?.status || 'stopped',
      stopReason: job.result?.stopReason || null,
      results: (job.result?.results || []).slice(0, 25).map((result) => ({
        username: result.username || null,
        action: result.action || null,
        conversationId: result.conversationId || null,
        messageId: result.messageId || null,
        status: result.status || 'safe-stopped',
      })),
    })),
  };
}

function isInstagramSender(sender) {
  return bridgeSenderOrigin(sender) === 'https://www.instagram.com';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.kind === 'insta-toolbox-overlay-state') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    loadBridgeState()
      .then(async (state) => {
        pruneLiveState(state);
        await saveBridgeState(state);
        sendResponse({ state: overlayState(state) });
      })
      .catch(() => sendResponse({ error: 'overlay-state-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-cancel-account-action') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => cancelPendingAccountIntent());
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'live-intent-cancel-failed' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-cancel-dm-unsend') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => cancelPendingDmIntent());
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'dm-live-intent-cancel-failed' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-start-batch') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => startBatch(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'batch-start-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-batch-status') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    batchStatus()
      .then(sendResponse)
      .catch(() => sendResponse({ error: 'batch-status-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-abort-batch') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    abortBatch()
      .then(sendResponse)
      .catch(() => sendResponse({ error: 'batch-abort-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-batch-limits') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => updateBatchLimits(request));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'batch-limits-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-reserve-thread-unsend') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => reserveThreadUnsendPlan(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'thread-unsend-reservation-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-finalize-thread-unsend') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => finalizeThreadUnsendPlan(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'thread-unsend-finalization-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-toolbox-checkpoint-thread-unsend') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => checkpointThreadUnsendPlan(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'thread-unsend-checkpoint-unavailable' }));
    return true;
  }
  if (request?.kind !== 'insta-toolbox-bridge-request') return false;
  const origin = bridgeSenderOrigin(sender);
  if (!origin || origin !== request.origin) {
    sendResponse({ error: 'origin-mismatch' });
    return false;
  }
  const operation = requestTail.then(() => handleBridgeRequest({
    message: request.message,
    origin,
  }));
  requestTail = operation.catch(() => {});
  operation.then(sendResponse).catch(() => sendResponse({ error: 'bridge-internal-error' }));
  return true;
});
