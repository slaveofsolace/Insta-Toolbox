import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGrowthCampaign,
  dueGrowthUnfollows,
  growthOutcomeVerified,
  rankGrowthCandidates,
  recordGrowthOutcome,
} from '../extension/presence-growth.js';

test('growth candidates require observed two-way seed relationships', () => {
  const result = rankGrowthCandidates({
    account: 'owner',
    following: ['seed_a', 'seed_b', 'already'],
    followers: ['existing_follower'],
    seeds: [
      { username: 'seed_a', followers: ['alice', 'bob', 'owner', 'existing_follower'],
        following: ['alice', 'bob', 'one_way', 'owner', 'existing_follower'] },
      { username: 'seed_b', followers: ['alice', 'carol', 'already'],
        following: ['alice', 'carol', 'already', 'seed_a'] },
    ],
  });
  assert.deepEqual(result.map(({ username, via }) => [username, via]), [
    ['alice', ['seed_a', 'seed_b']],
    ['bob', ['seed_a']],
    ['carol', ['seed_b']],
  ]);
});

test('partial lists never turn missing edges into candidate proof', () => {
  const result = rankGrowthCandidates({ account: 'owner', following: ['seed'],
    seeds: [{ username: 'seed', followers: ['alice'], following: ['bob'] }] });
  assert.deepEqual(result, []);
});

test('conflicting observed Instagram IDs cannot establish a mutual connection', () => {
  const result = rankGrowthCandidates({ account: 'owner', following: ['seed'],
    seeds: [{ username: 'seed',
      followers: [{ username: 'alice', instagramId: '123' }],
      following: [{ username: 'alice', instagramId: '456' }],
    }] });
  assert.deepEqual(result, []);
});

test('conflicting IDs across seeds remove the candidate instead of boosting its rank', () => {
  const seeds = ['seed_a', 'seed_b'].map((username, index) => ({ username,
    followers: [{ username: 'alice', instagramId: String(index + 1) }],
    following: [{ username: 'alice', instagramId: String(index + 1) }],
  }));
  assert.deepEqual(rankGrowthCandidates({ account: 'owner', following: ['seed_a', 'seed_b'], seeds }), []);
});

test('only verified campaign follows become due, once and on the right account', () => {
  const day = 86_400_000;
  const start = day * 200;
  const campaign = createGrowthCampaign({ account: 'owner', targets: ['alice', 'bob'],
    delayDays: 7, createdAt: start, id: 'test-id' });
  assert.deepEqual(dueGrowthUnfollows(campaign, { account: 'owner', now: start + 8 * day }), []);
  const afterFollow = recordGrowthOutcome(campaign, { action: 'follow', username: 'alice', verifiedAt: start });
  assert.deepEqual(dueGrowthUnfollows(afterFollow, { account: 'other', now: start + 8 * day }), []);
  assert.deepEqual(dueGrowthUnfollows(afterFollow, { account: 'owner', now: start + 7 * day - 1 }), []);
  assert.deepEqual(dueGrowthUnfollows(afterFollow, { account: 'owner', now: start + 7 * day }), ['alice']);
  const finished = recordGrowthOutcome(afterFollow, { action: 'unfollow', username: 'alice', verifiedAt: start + 7 * day });
  assert.deepEqual(dueGrowthUnfollows(finished, { account: 'owner', now: start + 8 * day }), []);
  assert.equal(recordGrowthOutcome(finished, { action: 'follow', username: 'alice', verifiedAt: start + 8 * day }), finished);
});

test('campaigns have a finite exact target set and a seven to fourteen day delay', () => {
  for (const delayDays of [0, 6, 15, 20]) {
    assert.throws(() => createGrowthCampaign({ account: 'owner', targets: ['alice'], delayDays,
      createdAt: 1, id: 'test-id' }), /growth-campaign-invalid/);
  }
  assert.throws(() => createGrowthCampaign({ account: 'owner', targets: ['owner'], delayDays: 7,
    createdAt: 1, id: 'test-id' }), /growth-campaign-invalid/);
});

test('a private follow request is not recorded as a follow to unfollow later', () => {
  assert.equal(growthOutcomeVerified('follow', 'followed'), true);
  assert.equal(growthOutcomeVerified('follow', 'follow-requested'), false);
  assert.equal(growthOutcomeVerified('unfollow', 'unfollowed'), true);
});
