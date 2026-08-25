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

import {
  createBridgePairing,
  createSignedBridgeMessage,
  verifySignedBridgeMessage,
} from '../src/core/bridge-protocol.js';
import {
  confirmReviewedActionJob,
  createReviewedActionJob,
} from '../src/core/action-jobs.js';
import { createQueueItem } from '../src/core/queue.js';

test('background consumes one transient exact confirmation before dispatching a live action', async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'insta-toolbox-background-'));
  const libraryRoot = path.join(temporaryRoot, 'lib');
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    copyFile(new URL('../extension/background.js', import.meta.url), path.join(temporaryRoot, 'background.js')),
    copyFile(new URL('../src/core/bridge-protocol.js', import.meta.url), path.join(libraryRoot, 'bridge-protocol.js')),
    copyFile(new URL('../src/core/controlled-account-action.js', import.meta.url), path.join(libraryRoot, 'controlled-account-action.js')),
    copyFile(new URL('../src/core/controlled-dm-unsend.js', import.meta.url), path.join(libraryRoot, 'controlled-dm-unsend.js')),
  ]);

  const origin = 'http://127.0.0.1:4173';
  const { pairing: unpaired } = createBridgePairing({
    origin,
    permissions: ['read', 'action'],
  });
  const pairing = {
    ...unpaired,
    pairedAt: new Date().toISOString(),
  };
  const settings = {
    liveActionEnabled: true,
    liveActionBatchLimit: 1,
  };
  const draft = createReviewedActionJob([
    createQueueItem('controlled_target', 'follow'),
  ], { settings });
  const job = confirmReviewedActionJob(draft, {
    phrase: draft.confirmationPhrase,
    mode: 'live',
    settings,
  });

  const legacyBridgePairings = [{ pairingId: 'legacy-v2-pairing' }];
  const legacyPendingJobs = [{ jobId: 'legacy-v2-job' }];
  const stored = {
    bridgePairings: structuredClone(legacyBridgePairings),
    pendingJobs: structuredClone(legacyPendingJobs),
    instaToolboxBridgePairings: [pairing],
    instaToolboxBridgeReplayNonces: [],
    instaToolboxPendingJobs: [],
    instaToolboxAccountActionLedger: [],
    instaToolboxPendingLiveIntent: null,
    instaToolboxLiveArm: null,
  };
  let runtimeListener = null;
  let liveDispatches = 0;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.4.0' }),
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        },
      },
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
        return { id: tabId, active: true, url: 'https://www.instagram.com/controlled_target/' };
      },
      async query() {
        return [{ id: 7, active: true, url: 'https://www.instagram.com/controlled_target/' }];
      },
      async sendMessage(_tabId, message) {
        if (message.kind === 'insta-toolbox-inspect-session') return { authenticated: true };
        if (message.kind === 'insta-toolbox-inspect-profile') {
          return {
            username: 'controlled_target',
            relationship: 'not-following',
            resolutionToken: 'exact-profile-token',
          };
        }
        if (message.kind === 'insta-toolbox-perform-reviewed-profile-action') {
          liveDispatches += 1;
          assert.equal(stored.instaToolboxLiveArm, null);
          assert.equal(stored.instaToolboxPendingLiveIntent, null);
          assert.equal(stored.instaToolboxAccountActionLedger.length, 1);
          assert.equal(stored.instaToolboxAccountActionLedger[0].status, 'reserved');
          assert.equal(stored.instaToolboxAccountActionLedger[0].username, 'controlled_target');
          assert.equal(stored.instaToolboxAccountActionLedger[0].action, 'follow');
          assert.deepEqual(message.item, {
            action: 'follow',
            expectedRelationship: 'not-following',
            resolutionToken: 'exact-profile-token',
            username: 'controlled_target',
          });
          return { result: 'followed', relationship: 'following' };
        }
        throw new Error(`Unexpected tab message: ${message.kind}`);
      },
    },
  };

  const backgroundUrl = `${pathToFileURL(path.join(temporaryRoot, 'background.js')).href}?test=${Date.now()}`;
  await import(backgroundUrl);
  assert.equal(typeof runtimeListener, 'function');

  function deliver(request, sender) {
    return new Promise((resolve) => {
      const result = runtimeListener(request, sender, resolve);
      if (result !== true) queueMicrotask(() => resolve(undefined));
    });
  }

  const responseNonces = new Set();
  async function bridge(type, payload = {}) {
    const message = await createSignedBridgeMessage(pairing, type, payload);
    const response = await deliver({
      kind: 'insta-toolbox-bridge-request',
      origin,
      message,
    }, {
      url: `${origin}/index.html`,
      tab: { url: `${origin}/index.html` },
    });
    assert.equal(response.error, undefined);
    const verified = await verifySignedBridgeMessage(response.message, pairing, {
      origin,
      usedNonces: responseNonces,
    });
    assert.equal(verified.ok, true);
    return verified.message;
  }

  const intentResponse = await bridge('action.account-live-intent', { job });
  assert.equal(intentResponse.type, 'action.account-live-intent-result');
  assert.equal(intentResponse.payload.ready, true);

  const beforeConfirmation = await deliver({ kind: 'insta-toolbox-overlay-state' }, {
    url: 'https://www.instagram.com/controlled_target/',
    tab: { id: 7, url: 'https://www.instagram.com/controlled_target/' },
  });
  assert.equal(beforeConfirmation.state.pendingLiveIntent.username, 'controlled_target');
  assert.equal(Object.hasOwn(beforeConfirmation.state.pendingLiveIntent, 'pairingId'), false);

  const item = job.items[0];
  assert.equal((await bridge('action.account-session', { jobId: job.id })).payload.authenticated, true);
  const profile = (await bridge('action.account-profile', {
    jobId: job.id,
    username: 'controlled_target',
  })).payload;
  assert.equal(profile.resolutionToken, 'exact-profile-token');
  const executionItem = {
    ...item,
    expectedRelationship: profile.relationship,
    resolutionToken: profile.resolutionToken,
  };
  const unconfirmed = (await bridge('action.account-live-readiness', {
    jobId: job.id,
    item: executionItem,
  })).payload;
  assert.equal(unconfirmed.authorized, false);
  assert.equal(unconfirmed.reason, 'exact-account-confirmation-required');
  const readiness = (await bridge('action.account-live-readiness', {
    confirmation: {
      confirmed: true,
      action: 'follow',
      count: 1,
      username: 'controlled_target',
    },
    jobId: job.id,
    item: executionItem,
  })).payload;
  assert.equal(readiness.authorized, true);

  const performed = (await bridge('action.account-perform', {
    jobId: job.id,
    item: executionItem,
  })).payload;
  assert.equal(performed.result, 'followed');
  assert.equal(liveDispatches, 1);
  assert.equal(stored.instaToolboxLiveArm, null);
  assert.equal(stored.instaToolboxPendingLiveIntent, null);
  assert.equal(stored.instaToolboxPendingJobs[0].mode, 'live');
  assert.equal(stored.instaToolboxPendingJobs[0].result.status, 'completed');
  assert.equal(stored.instaToolboxAccountActionLedger.length, 1);
  assert.equal(stored.instaToolboxAccountActionLedger[0].status, 'succeeded');
  assert.equal(stored.instaToolboxAccountActionLedger[0].result, 'followed');
  assert.deepEqual(stored.bridgePairings, legacyBridgePairings, 'v3 leaves legacy pairings untouched');
  assert.deepEqual(stored.pendingJobs, legacyPendingJobs, 'v3 leaves legacy jobs untouched');

  const replayReadiness = (await bridge('action.account-live-readiness', {
    jobId: job.id,
    item: executionItem,
  })).payload;
  assert.equal(replayReadiness.authorized, false);
  assert.equal(replayReadiness.reason, 'live-intent-required');
  assert.equal(liveDispatches, 1);

  delete globalThis.chrome;
  await rm(temporaryRoot, { recursive: true, force: true });
});
