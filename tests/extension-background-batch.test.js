import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadBackground({ profileResponses, performResponses, stored }) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'insta-aio-batch-'));
  const libraryRoot = path.join(temporaryRoot, 'lib');
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    copyFile(new URL('../extension/background.js', import.meta.url), path.join(temporaryRoot, 'background.js')),
    copyFile(new URL('../src/core/bridge-protocol.js', import.meta.url), path.join(libraryRoot, 'bridge-protocol.js')),
    copyFile(new URL('../src/core/controlled-account-action.js', import.meta.url), path.join(libraryRoot, 'controlled-account-action.js')),
    copyFile(new URL('../src/core/controlled-dm-unsend.js', import.meta.url), path.join(libraryRoot, 'controlled-dm-unsend.js')),
  ]);

  let runtimeListener = null;
  const navigations = [];
  const performed = [];
  let currentUrl = 'https://www.instagram.com/';

  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '2.0.3' }),
      onMessage: { addListener(listener) { runtimeListener = listener; } },
    },
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, stored[key]]));
        },
        async set(values) {
          Object.assign(stored, structuredClone(values));
        },
      },
    },
    tabs: {
      async get(tabId) {
        return {
          id: tabId, active: true, status: 'complete', url: currentUrl,
        };
      },
      async query() {
        return [{
          id: 7, active: true, status: 'complete', url: currentUrl,
        }];
      },
      async update(tabId, { url }) {
        navigations.push(url);
        currentUrl = url;
        return { id: tabId, url, status: 'complete' };
      },
      async sendMessage(_tabId, message) {
        if (message.kind === 'insta-aio-inspect-session') return { authenticated: true };
        if (message.kind === 'insta-aio-inspect-profile') {
          const response = profileResponses[message.username];
          if (!response) throw new Error(`No profile fixture for ${message.username}`);
          return response;
        }
        if (message.kind === 'insta-aio-perform-reviewed-profile-action') {
          performed.push(message.item);
          const response = performResponses[message.item.username];
          return response || { result: 'unfollowed', relationship: 'not-following' };
        }
        throw new Error(`Unexpected tab message: ${message.kind}`);
      },
    },
  };

  const url = `${pathToFileURL(path.join(temporaryRoot, 'background.js')).href}?test=${Date.now()}${Math.random()}`;
  await import(url);
  assert.equal(typeof runtimeListener, 'function');

  function deliver(request, sender) {
    return new Promise((resolve) => {
      const result = runtimeListener(request, sender, resolve);
      if (result !== true) queueMicrotask(() => resolve(undefined));
    });
  }

  return {
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
    deliver,
    navigations,
    performed,
  };
}

const sender = { url: 'https://www.instagram.com/', tab: { id: 7, url: 'https://www.instagram.com/' } };

function baseStored() {
  return {
    bridgePairings: [],
    bridgeReplayNonces: [],
    pendingJobs: [],
    accountActionLedger: [],
    dmActionLedger: [],
    threadUnsendLedger: [],
    pendingLiveIntent: null,
    liveArm: null,
    pendingDmIntent: null,
    dmArm: null,
    batchArm: null,
    batchRun: null,
    // Fastest pacing the runner allows, so the test stays quick.
    batchLimits: {
      dailyActionLimit: 50,
      dailyDmLimit: 50,
      minDelayMs: 1,
      maxDelayMs: 1,
    },
  };
}

function batchTargetDigest(kind, action, items) {
  const source = JSON.stringify(items.map((item) => (
    kind === 'account'
      ? [String(item?.id || ''), String(item?.username || '').toLowerCase()]
      : [String(item?.id || ''), String(item?.messageId || ''), String(item?.threadId || '')]
  )));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${kind}:${action || ''}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function confirmedAccountBatch(action, items) {
  return {
    kind: 'insta-aio-start-batch',
    batchKind: 'account',
    action,
    items,
    confirmed: true,
    confirmation: {
      action,
      count: items.length,
      targetDigest: batchTargetDigest('account', action, items),
    },
  };
}

test('thread-wide Unsend has no arbitrary daily quota and still rejects duplicate plans', async () => {
  const stored = baseStored();
  stored.batchLimits = {
    dailyActionLimit: 50,
    dailyDmLimit: 3,
    minDelayMs: 1_500,
    maxDelayMs: 2_200,
  };
  const { cleanup, deliver } = await loadBackground({
    profileResponses: {},
    performResponses: {},
    stored,
  });
  const threadSender = {
    url: 'https://www.instagram.com/direct/t/thread-123/',
    tab: { id: 7, url: 'https://www.instagram.com/direct/t/thread-123/' },
  };
  const plan = {
    version: 2,
    threadId: 'thread-123',
    scope: 'oldest',
    limit: 2,
    detectedCount: 8,
    reviewedDigest: 'a1b2c3d4',
    expiresAt: Date.now() + 60_000,
  };
  try {
    const reserved = await deliver({ kind: 'insta-aio-reserve-thread-unsend', plan }, threadSender);
    assert.equal(reserved.error, undefined);
    assert.deepEqual(reserved.pacing, { minDelayMs: 1_000, maxDelayMs: 2_000 });
    assert.equal(stored.threadUnsendLedger.length, 0, 'capability is memory-only before a verified removal');

    const duplicate = await deliver({ kind: 'insta-aio-reserve-thread-unsend', plan }, threadSender);
    assert.equal(duplicate.error, 'thread-unsend-plan-already-reserved');

    const checkpoint = await deliver({
      kind: 'insta-aio-checkpoint-thread-unsend',
      reservationId: reserved.reservation.id,
      reviewedDigest: plan.reviewedDigest,
      threadId: plan.threadId,
      processed: 1,
      failed: 0,
    }, threadSender);
    assert.equal(checkpoint.error, undefined);
    assert.equal(checkpoint.reservation.processed, 1);
    assert.equal(checkpoint.reservation.status, 'running');
    assert.equal(stored.threadUnsendLedger.length, 1, 'each verified removal is checkpointed immediately');
    assert.equal(stored.threadUnsendLedger[0].processed, 1);

    const skippedCheckpoint = await deliver({
      kind: 'insta-aio-checkpoint-thread-unsend',
      reservationId: reserved.reservation.id,
      reviewedDigest: plan.reviewedDigest,
      threadId: plan.threadId,
      processed: 3,
      failed: 0,
    }, threadSender);
    assert.equal(skippedCheckpoint.error, 'thread-unsend-reservation-missing');
    assert.equal(stored.threadUnsendLedger[0].processed, 1, 'unproven increments cannot advance the ledger');

    const finalized = await deliver({
      kind: 'insta-aio-finalize-thread-unsend',
      reservationId: reserved.reservation.id,
      reviewedDigest: plan.reviewedDigest,
      threadId: plan.threadId,
      processed: 1,
      failed: 1,
      status: 'stopped',
    }, threadSender);
    assert.equal(finalized.error, undefined);
    assert.equal(finalized.reservation.processed, 1);
    assert.equal(finalized.reservation.failed, 1);
    assert.equal(finalized.reservation.status, 'stopped');
    assert.equal(finalized.reservation.recorded, true);
    assert.equal(stored.threadUnsendLedger.length, 1, 'finalization updates the checkpoint instead of duplicating it');
    assert.equal(stored.threadUnsendLedger[0].count, 2);

    const secondPlan = await deliver({
      kind: 'insta-aio-reserve-thread-unsend',
      plan: { ...plan, scope: 'all', limit: null, reviewedDigest: 'd4c3b2a1' },
    }, threadSender);
    assert.equal(secondPlan.error, undefined);
    assert.equal(secondPlan.reservation.count, null);
    assert.equal(secondPlan.reservation.scope, 'all');

    const uncheckpointedJump = await deliver({
      kind: 'insta-aio-finalize-thread-unsend',
      reservationId: secondPlan.reservation.id,
      reviewedDigest: 'd4c3b2a1',
      threadId: plan.threadId,
      processed: 1,
      failed: 0,
      status: 'completed',
    }, threadSender);
    assert.equal(uncheckpointedJump.error, 'thread-unsend-reservation-missing');
    assert.equal(stored.threadUnsendLedger.length, 1, 'finalization cannot invent an uncheckpointed removal');

    const zeroClick = await deliver({
      kind: 'insta-aio-finalize-thread-unsend',
      reservationId: secondPlan.reservation.id,
      reviewedDigest: 'd4c3b2a1',
      threadId: plan.threadId,
      processed: 0,
      failed: 1,
      status: 'error',
    }, threadSender);
    assert.equal(zeroClick.error, undefined);
    assert.equal(zeroClick.reservation.recorded, false);
    assert.equal(stored.threadUnsendLedger.length, 1, 'zero-click failure is not appended to the ledger');

    const wrongThread = await deliver({
      kind: 'insta-aio-reserve-thread-unsend',
      plan: { ...plan, threadId: 'thread-999', reviewedDigest: '11111111', limit: 1 },
    }, threadSender);
    assert.equal(wrongThread.error, 'thread-unsend-plan-invalid');
  } finally {
    await cleanup();
  }
});

test('a service-worker restart can record verified removals without restoring action authority', async () => {
  const stored = baseStored();
  const threadSender = {
    url: 'https://www.instagram.com/direct/t/thread-restart/',
    tab: { id: 7, url: 'https://www.instagram.com/direct/t/thread-restart/' },
  };
  const plan = {
    version: 2,
    threadId: 'thread-restart',
    scope: 'all',
    limit: null,
    reviewedDigest: '1234abcd',
    expiresAt: Date.now() + 60_000,
  };
  const firstWorker = await loadBackground({ profileResponses: {}, performResponses: {}, stored });
  let reservation;
  try {
    reservation = await firstWorker.deliver({ kind: 'insta-aio-reserve-thread-unsend', plan }, threadSender);
    assert.equal(reservation.error, undefined);
    assert.equal(stored.threadUnsendLedger.length, 0);
  } finally {
    await firstWorker.cleanup();
  }

  const restartedWorker = await loadBackground({ profileResponses: {}, performResponses: {}, stored });
  try {
    const checkpoint = await restartedWorker.deliver({
      kind: 'insta-aio-checkpoint-thread-unsend',
      plan,
      reservationId: reservation.reservation.id,
      reviewedDigest: plan.reviewedDigest,
      threadId: plan.threadId,
      processed: 1,
      failed: 0,
    }, threadSender);
    assert.equal(checkpoint.error, undefined);
    assert.equal(checkpoint.reservation.processed, 1);
    assert.equal(checkpoint.reservation.recoveredAfterWorkerRestart, true);
    assert.equal(checkpoint.reservation.authorityRestored, false);
    assert.equal(stored.threadUnsendLedger.length, 1);

    const final = await restartedWorker.deliver({
      kind: 'insta-aio-finalize-thread-unsend',
      reservationId: reservation.reservation.id,
      reviewedDigest: plan.reviewedDigest,
      threadId: plan.threadId,
      processed: 1,
      failed: 0,
      status: 'stopped',
    }, threadSender);
    assert.equal(final.error, undefined);
    assert.equal(final.reservation.status, 'stopped');
    assert.equal(stored.threadUnsendLedger.length, 1);
    assert.equal(stored.threadUnsendLedger[0].authorityRestored, false);
  } finally {
    await restartedWorker.cleanup();
  }
});

async function waitForRun(deliver, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await deliver({ kind: 'insta-aio-batch-status' }, sender);
    if (predicate(status.run)) return status.run;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('Batch did not reach the expected state in time.');
}

test('batch start requires an exact finite confirmation from the active Instagram tab', async () => {
  const stored = baseStored();
  const { cleanup, deliver } = await loadBackground({
    profileResponses: {},
    performResponses: {},
    stored,
  });
  try {
    const items = [
      { id: 'i-1', username: 'alpha' },
      { id: 'i-2', username: 'beta' },
      { id: 'i-3', username: 'gamma' },
    ];
    const wrong = await deliver({
      ...confirmedAccountBatch('unfollow', items),
      confirmation: {
        action: 'unfollow',
        count: 2,
        targetDigest: batchTargetDigest('account', 'unfollow', items),
      },
    }, sender);
    assert.equal(wrong.error, 'batch-confirmation-mismatch');
    assert.equal(stored.batchArm, null);

    const missingTab = await deliver(
      confirmedAccountBatch('unfollow', items),
      { url: 'https://www.instagram.com/', tab: {} },
    );
    assert.equal(missingTab.error, 'instagram-tab-required');

    assert.equal(stored.batchRun, null);
  } finally {
    await cleanup();
  }
});

test('batch run navigates, verifies, and acts on each account exactly once', async () => {
  const stored = baseStored();
  const { cleanup, deliver, navigations, performed } = await loadBackground({
    profileResponses: {
      alpha: { username: 'alpha', relationship: 'following', resolutionToken: 'token-alpha' },
      beta: { username: 'beta', relationship: 'following', resolutionToken: 'token-beta' },
    },
    performResponses: {},
    stored,
  });
  try {
    const items = [{ id: 'i-1', username: 'alpha' }, { id: 'i-2', username: 'beta' }];
    const started = await deliver(confirmedAccountBatch('unfollow', items), sender);
    assert.equal(started.error, undefined);
    assert.equal(started.run.total, 2);

    const run = await waitForRun(deliver, (value) => value?.status === 'completed');
    assert.equal(run.completed, 2);
    assert.equal(run.failed, 0);
    assert.equal(run.skipped, 0);

    assert.deepEqual(navigations, [
      'https://www.instagram.com/alpha/',
      'https://www.instagram.com/beta/',
    ]);
    assert.deepEqual(performed.map((item) => item.username), ['alpha', 'beta']);
    assert.deepEqual(performed.map((item) => item.resolutionToken), ['token-alpha', 'token-beta']);
    for (const item of performed) {
      assert.equal(item.action, 'unfollow');
      assert.equal(item.expectedRelationship, 'following');
    }
    // The arm is consumed by the run and cannot authorise a second one.
    assert.equal(stored.batchArm, null);
    assert.equal(stored.accountActionLedger.length, 2);
    assert.ok(stored.accountActionLedger.every((entry) => entry.status === 'succeeded'));
  } finally {
    await cleanup();
  }
});

test('batch skips a target whose relationship no longer matches without stopping the run', async () => {
  const stored = baseStored();
  const { cleanup, deliver, performed } = await loadBackground({
    profileResponses: {
      alpha: { username: 'alpha', relationship: 'not-following', resolutionToken: 'token-alpha' },
      beta: { username: 'beta', relationship: 'following', resolutionToken: 'token-beta' },
    },
    performResponses: {},
    stored,
  });
  try {
    const items = [{ id: 'i-1', username: 'alpha' }, { id: 'i-2', username: 'beta' }];
    await deliver(confirmedAccountBatch('unfollow', items), sender);

    const run = await waitForRun(deliver, (value) => value?.status === 'completed');
    assert.equal(run.skipped, 1);
    assert.equal(run.completed, 1);
    // Only the still-valid target was touched.
    assert.deepEqual(performed.map((item) => item.username), ['beta']);
  } finally {
    await cleanup();
  }
});

test('batch stops the whole run when Instagram signals a rate limit', async () => {
  const stored = baseStored();
  const { cleanup, deliver, performed } = await loadBackground({
    profileResponses: {
      alpha: { username: 'alpha', relationship: 'following', resolutionToken: 'token-alpha' },
      beta: { username: 'beta', relationship: 'following', resolutionToken: 'token-beta' },
      gamma: { username: 'gamma', relationship: 'following', resolutionToken: 'token-gamma' },
    },
    performResponses: {
      beta: { rateLimited: true, reason: 'rate-limited' },
    },
    stored,
  });
  try {
    const items = [
      { id: 'i-1', username: 'alpha' },
      { id: 'i-2', username: 'beta' },
      { id: 'i-3', username: 'gamma' },
    ];
    await deliver(confirmedAccountBatch('unfollow', items), sender);

    const run = await waitForRun(deliver, (value) => value?.status === 'stopped');
    assert.equal(run.stopReason, 'rate-limited');
    // gamma was never attempted after the safe stop.
    assert.deepEqual(performed.map((item) => item.username), ['alpha', 'beta']);
  } finally {
    await cleanup();
  }
});

test('a slow-loading profile is retried rather than silently skipped', async () => {
  const stored = baseStored();
  // The first two inspections land before Instagram has hydrated the header,
  // exactly as they would on a slow connection.
  let attempts = 0;
  const profileResponses = {};
  Object.defineProperty(profileResponses, 'alpha', {
    enumerable: true,
    get() {
      attempts += 1;
      return attempts > 2
        ? { username: 'alpha', relationship: 'following', resolutionToken: 'token-alpha' }
        : { unexpectedUi: true, reason: 'inspector-unavailable' };
    },
  });

  const { cleanup, deliver, performed } = await loadBackground({
    profileResponses,
    performResponses: {},
    stored,
  });
  try {
    const items = [{ id: 'i-1', username: 'alpha' }];
    await deliver(confirmedAccountBatch('unfollow', items), sender);

    const run = await waitForRun(deliver, (value) => value?.status === 'completed');
    assert.equal(run.completed, 1, 'the target was acted on once it resolved');
    assert.equal(run.skipped, 0);
    assert.ok(attempts > 2, 'the runner retried before giving up');
    assert.deepEqual(performed.map((item) => item.username), ['alpha']);
  } finally {
    await cleanup();
  }
});

test('starting a batch without an exact confirmation is rejected', async () => {
  const stored = baseStored();
  const { cleanup, deliver } = await loadBackground({
    profileResponses: {},
    performResponses: {},
    stored,
  });
  try {
    const response = await deliver({
      kind: 'insta-aio-start-batch',
      batchKind: 'account',
      action: 'unfollow',
      items: [{ id: 'i-1', username: 'alpha' }],
    }, sender);
    assert.equal(response.error, 'batch-confirmation-mismatch');
  } finally {
    await cleanup();
  }
});

test('batch pacing is clamped without exposing quota controls', async () => {
  const stored = baseStored();
  const { cleanup, deliver } = await loadBackground({
    profileResponses: {},
    performResponses: {},
    stored,
  });
  try {
    const response = await deliver({
      kind: 'insta-aio-batch-limits',
      limits: {
        dailyActionLimit: 100_000,
        dailyDmLimit: 100_000,
        minDelayMs: 1,
        maxDelayMs: 5_000,
      },
    }, sender);
    assert.equal(response.limits.minDelayMs, 1_500);
    assert.equal(response.limits.maxDelayMs, 5_000);
  } finally {
    await cleanup();
  }
});
