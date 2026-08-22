import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const [actionLabelsSource, inspectorSource] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
]);

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}

function createInspector({ origin = 'https://www.instagram.com' } = {}) {
  const document = {
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    AbortController,
    URL,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    clearTimeout,
    console,
    crypto: webcrypto,
    document,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location: {
      href: `${origin}/demo_creator/`,
      origin,
      pathname: '/demo_creator/',
    },
    setTimeout,
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(inspectorSource, context);
  return context.InstaAioInstagramInspector;
}

test('authenticated follower check uses only the exact supplied read endpoints and paginates both lists', async () => {
  const inspector = createInspector();
  const requests = [];
  const delays = [];
  const progress = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.pathname === '/api/v1/web/search/topsearch/') {
      return response({
        users: [
          { user: { pk: '999', username: 'not_demo' } },
          { user: { pk: '12345', username: 'Demo.Creator' } },
        ],
      });
    }
    if (url.pathname === '/api/v1/friendships/12345/followers/' && !url.searchParams.has('max_id')) {
      return response({
        users: [
          { username: 'mutual.one', full_name: 'Mutual One' },
          { username: 'follower.only', full_name: 'Follower Only' },
        ],
        next_max_id: 'followers-page-2',
      });
    }
    if (url.pathname === '/api/v1/friendships/12345/followers/'
      && url.searchParams.get('max_id') === 'followers-page-2') {
      return response({ users: [{ username: 'mutual.two', full_name: 'Mutual Two' }] });
    }
    if (url.pathname === '/api/v1/friendships/12345/following/') {
      return response({
        users: [
          { username: 'mutual.one', full_name: 'Mutual One' },
          { username: 'mutual.two', full_name: 'Mutual Two' },
          { username: 'following.only', full_name: 'Following Only' },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  };

  const result = await inspector.fetchFollowerComparison({
    fetchImpl,
    now: () => 1_800_000_000_000,
    onProgress: (entry) => progress.push(entry),
    random: () => 0.5,
    sleepImpl: async (ms) => { delays.push(ms); },
    username: '@Demo.Creator',
  });

  assert.equal(result.username, 'demo.creator');
  assert.equal(result.userId, '12345');
  assert.deepEqual([...result.followers].map((account) => account.username), [
    'follower.only', 'mutual.one', 'mutual.two',
  ]);
  assert.deepEqual([...result.following].map((account) => account.username), [
    'following.only', 'mutual.one', 'mutual.two',
  ]);
  assert.deepEqual({ ...result.complete }, { followers: true, following: true });
  assert.deepEqual({ ...result.pages }, { followers: 2, following: 1 });
  assert.deepEqual(delays, [1_150]);
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url.searchParams.get('query'), 'demo.creator');
  for (const { url, options } of requests) {
    assert.equal(url.origin, 'https://www.instagram.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'include');
    assert.deepEqual({ ...options.headers }, { 'X-IG-App-ID': '936619743392459' });
  }
  assert.equal(requests[1].url.searchParams.get('count'), '50');
  assert.equal(requests[2].url.searchParams.get('max_id'), 'followers-page-2');
});

test('authenticated follower check requires an exact username search result', async () => {
  const inspector = createInspector();
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async () => response({ users: [{ user: { pk: '55', username: 'similar_name' } }] }),
      username: 'target_name',
    }),
    (error) => error.code === 'username-not-found',
  );
});

test('Mutual Checker retries a premature final Followers page once and unions the missing account', async () => {
  const inspector = createInspector();
  const baseFollowers = Array.from({ length: 100 }, (_, index) => ({ username: `follower.${index}` }));
  let followerCalls = 0;
  const progress = [];
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({
          users: [{ user: {
            pk: '77', username: 'target_name', follower_count: 101, following_count: 1,
          } }],
        });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({
          users: followerCalls === 1
            ? baseFollowers
            : [...baseFollowers.slice(1), { username: 'follower.100' }],
        });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    onProgress: (entry) => progress.push(entry),
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 2);
  assert.equal(result.followers.length, 101);
  assert.equal(result.complete.followers, true);
  assert.ok(progress.some((entry) => entry.phase === 'reconciling'
    && entry.found === 100
    && entry.passFound === 0
    && entry.expectedCount === 101));
  assert.ok(progress.some((entry) => entry.phase === 'reconciling'
    && entry.found === 101
    && entry.passFound === 100));
});

test('Mutual Checker finishes partial instead of hanging when Instagram keeps one account hidden', async () => {
  const inspector = createInspector();
  const followers = Array.from({ length: 100 }, (_, index) => ({ username: `follower.${index}` }));
  let followerCalls = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: {
          pk: '77', username: 'target_name', follower_count: 101, following_count: 1,
        } }] });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ users: followers });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 2);
  assert.equal(result.followers.length, 100);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
});

test('Mutual Checker does not repeat a large list after Instagram ends below the profile count', async () => {
  const inspector = createInspector();
  const followers = Array.from({ length: 2_070 }, (_, index) => ({ username: `follower.${index}` }));
  let followerCalls = 0;
  const progress = [];
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: {
          pk: '77', username: 'target_name', follower_count: 2_104, following_count: 1,
        } }] });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ users: followers });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    onProgress: (entry) => progress.push(entry),
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 1);
  assert.equal(result.followers.length, 2_070);
  assert.equal(result.expectedCounts.followers, 2_104);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
  assert.equal(progress.some((entry) => entry.phase === 'reconciling' && entry.listType === 'followers'), false);
});

test('authenticated follower check stops on rate limits before requesting another list', async () => {
  const inspector = createInspector();
  let calls = 0;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async (input) => {
        calls += 1;
        const url = new URL(input);
        if (url.pathname.includes('topsearch')) {
          return response({ users: [{ user: { pk: '88', username: 'target_name' } }] });
        }
        return response({ message: 'Please wait a few minutes before you try again.' }, 429);
      },
      username: 'target_name',
    }),
    (error) => error.code === 'rate-limited',
  );
  assert.equal(calls, 2);
});

test('authenticated follower check marks bounded pagination as partial instead of claiming completion', async () => {
  const inspector = createInspector();
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      return response({ users: [{ username: `${url.pathname.includes('/followers/') ? 'follower' : 'following'}.one` }], next_max_id: 'next' });
    },
    maxPages: 1,
    sleepImpl: async () => {},
    username: 'target_name',
  });
  assert.deepEqual({ ...result.complete }, { followers: false, following: false });
  assert.deepEqual({ ...result.reasons }, { followers: 'page-limit', following: 'page-limit' });
});

test('authenticated follower check refuses to run outside instagram.com', async () => {
  const inspector = createInspector({ origin: 'https://example.com' });
  await assert.rejects(
    inspector.fetchFollowerComparison({ fetchImpl: async () => response({}), username: 'target_name' }),
    (error) => error.code === 'wrong-origin',
  );
});

test('authenticated follower check maps an aborted browser request to an explicit safe stop', async () => {
  const inspector = createInspector();
  const controller = new AbortController();
  const pending = inspector.fetchFollowerComparison({
    fetchImpl: async (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('browser abort');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    signal: controller.signal,
    username: 'target_name',
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'stopped');
});

test('authenticated follower check enforces its hard deadline during a pending request', async () => {
  const inspector = createInspector();
  let cleared = false;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      clearTimer: () => { cleared = true; },
      fetchImpl: async (_input, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('deadline abort');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
      maxDurationMs: 1_000,
      setTimer(callback) {
        queueMicrotask(callback);
        return 1;
      },
      username: 'target_name',
    }),
    (error) => error.code === 'time-limit',
  );
  assert.equal(cleared, true);
});

test('authenticated follower check retries a hung fetch twice before preserving the previous result', async () => {
  const inspector = createInspector();
  const progress = [];
  let calls = 0;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async () => {
        calls += 1;
        return new Promise(() => {});
      },
      onProgress: (entry) => progress.push(entry),
      requestTimeoutMs: 5,
      retryBaseMs: 0,
      sleepImpl: async () => {},
      username: 'target_name',
    }),
    (error) => error.code === 'request-timeout'
      && /3 attempts/.test(error.message)
      && /previous comparison is unchanged/i.test(error.message),
  );
  assert.equal(calls, 3);
  assert.deepEqual(
    progress.filter((entry) => entry.phase === 'retrying').map((entry) => ({
      attempt: entry.attempt,
      listType: entry.listType,
      pages: entry.pages,
    })),
    [
      { attempt: 2, listType: null, pages: 0 },
      { attempt: 3, listType: null, pages: 0 },
    ],
  );
});

test('authenticated follower check retries a hung JSON body and succeeds without duplicate rows', async () => {
  const inspector = createInspector();
  const progress = [];
  let searchBodies = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        searchBodies += 1;
        if (searchBodies < 3) return { ok: true, status: 200, json: async () => new Promise(() => {}) };
        return response({ users: [{ user: { pk: '44', username: 'target_name' } }] });
      }
      return response({
        users: [
          { username: 'same.person', full_name: 'Same Person' },
          { username: 'same.person', full_name: 'Same Person' },
        ],
      });
    },
    onProgress: (entry) => progress.push(entry),
    requestTimeoutMs: 5,
    retryBaseMs: 0,
    sleepImpl: async () => {},
    username: 'target_name',
  });
  assert.equal(searchBodies, 3);
  assert.equal(result.followers.length, 1);
  assert.equal(result.following.length, 1);
  assert.deepEqual(
    progress.filter((entry) => entry.phase === 'retrying').map((entry) => entry.attempt),
    [2, 3],
  );
});

test('authenticated follower check stops immediately when aborted during retry backoff', async () => {
  const inspector = createInspector();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError('offline');
      },
      onProgress(entry) {
        if (entry.phase === 'retrying') queueMicrotask(() => controller.abort());
      },
      retryBaseMs: 250,
      signal: controller.signal,
      username: 'target_name',
    }),
    (error) => error.code === 'stopped',
  );
  assert.equal(calls, 1);
});

test('follower comparison export provides a readable UTF-8 report and preserves schema-1 JSON', () => {
  const inspector = createInspector();
  const workspace = {
    subjectUsername: 'Demo.Creator',
    followers: [{ username: 'friend.one' }, { username: 'incoming.only' }],
    following: [{ username: 'friend.one' }, { username: 'outgoing.only' }],
    complete: { followers: true, following: true },
    verified: { followers: true, following: true },
    source: { followers: 'authenticated-web', following: 'authenticated-web' },
  };
  const comparison = {
    mutuals: [{ username: 'friend.one', displayName: 'Friend One' }],
    notFollowingMeBack: [{ username: 'outgoing.only', displayName: 'Outgoing Only' }],
    iDoNotFollowBack: [{ username: 'incoming.only', displayName: 'Incoming Only' }],
  };
  const generatedAt = '2026-08-22T12:34:56.000Z';
  const report = inspector.followerComparisonReport(workspace, comparison, generatedAt);
  assert.match(report, /^INSTA TOOLBOX MUTUAL CHECK\r\n/m);
  assert.match(report, /Account: @demo\.creator/);
  assert.match(report, /Generated: 2026-08-22T12:34:56\.000Z/);
  assert.match(report, /Completeness: Complete/);
  assert.match(report, /Followers: 2\r\nFollowing: 2\r\nMutual followers: 1/);
  assert.match(report, /NOT FOLLOWING YOU BACK\r\n-+\r\n1\. @outgoing\.only — Outgoing Only/);
  assert.match(report, /YOU DO NOT FOLLOW BACK\r\n-+\r\n1\. @incoming\.only — Incoming Only/);
  assert.match(report, /MUTUAL FOLLOWERS\r\n-+\r\n1\. @friend\.one — Friend One/);

  const record = inspector.followerComparisonRecord(workspace, comparison, generatedAt);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.kind, 'insta-aio-comparison');
  assert.equal(record.generatedAt, generatedAt);
  assert.equal(record.notFollowingMeBack[0].username, 'outgoing.only');
});

test('follower comparison report formats large counts and does not claim a partial API list missed its end', () => {
  const inspector = createInspector();
  const workspace = {
    subjectUsername: 'demo.creator',
    followers: Array.from({ length: 2_070 }, (_, index) => ({ username: `follower.${index}` })),
    following: Array.from({ length: 101 }, (_, index) => ({ username: `following.${index}` })),
    complete: { followers: false, following: true },
    verified: { followers: true, following: true },
    source: { followers: 'authenticated-web', following: 'authenticated-web' },
  };
  const report = inspector.followerComparisonReport(workspace, {
    mutuals: [], notFollowingMeBack: [], iDoNotFollowBack: [],
  });
  assert.match(report, /Followers: 2,070\r\nFollowing: 101/);
  assert.match(report, /Partial — one or both saved lists may omit accounts/);
  assert.doesNotMatch(report, /did not reach a verified end/);
});
