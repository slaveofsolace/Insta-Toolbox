import test from 'node:test';
import assert from 'node:assert/strict';
import { readLoadedInsights, summarizeLoadedPosts, formatInsightsReport } from '../extension/insights.js';

const options = { sourceUrl: 'https://www.instagram.com/example/', capturedAt: '2026-09-24T12:00:00.000Z' };

test('content insights deduplicate recycled post identities, not matching text', () => {
  const value = summarizeLoadedPosts([
    { url: '/p/one/', hashtags: ['#Café', '東京'], publishedAt: '2026-09-21T23:00:00Z', type: 'video' },
    { url: '/reels/one/', hashtags: ['CAFÉ', 'new'] },
    { url: '/p/two/', hashtags: ['café'], type: 'carousel' },
    { url: 'https://other.example/p/one/', type: 'photo' },
    { url: '/p/two/liked_by/' },
  ], options);
  assert.equal(value.posts.length, 2);
  assert.deepEqual(value.counts, { photo: 0, video: 1, carousel: 1, unknown: 0 });
  assert.equal(value.hashtags.find(row => row.tag === 'café').posts, 2);
  assert.equal(value.hashtags.find(row => row.tag === '東京').posts, 1);
  assert.equal(value.datedPosts, 1);
  assert.equal(value.weekdays[1], 1);
  assert.equal(value.timezone, 'UTC');
  assert.equal(value.coverage, 'loaded-posts-only');
});

test('unknown media and missing dates are not invented and report stays inert', () => {
  const report = summarizeLoadedPosts([{ url: '/p/abc/', hashtags: ['<script>', 'valid_123'], publishedAt: 'invalid' }], options);
  assert.equal(report.counts.unknown, 1);
  assert.equal(report.datedPosts, 0);
  assert.equal(report.posts[0].publishedAt, null);
  assert.deepEqual(report.hashtags, [{ tag: 'valid_123', posts: 1 }]);
  const text = formatInsightsReport(report);
  assert.match(text, /1 loaded posts — not complete account history/);
  assert.match(text, /Date unavailable/);
  assert.match(text, /https:\/\/www\.instagram\.com\/p\/abc\//);
  assert.doesNotMatch(text, /<script>/i);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
});

test('Insights never reads DMs, requests a remote service, or treats an empty sample as full history', () => {
  const document = { querySelectorAll() { return []; } };
  assert.throws(() => readLoadedInsights({ document, location: new URL('https://www.instagram.com/direct/inbox/') }), /profile or feed/);
  assert.throws(() => readLoadedInsights({ document, location: new URL('https://example.org/') }), /Instagram/);
  const report = readLoadedInsights({ document, location: new URL(options.sourceUrl), now: () => options.capturedAt });
  assert.equal(report.posts.length, 0);
  assert.equal(report.profile, null);
  assert.equal(report.coverage, 'loaded-posts-only');
  assert.equal(report.capturedAt, options.capturedAt);
  assert.throws(() => summarizeLoadedPosts(Array(1001).fill({}), options), /Too many/);
});

test('profile-grid permalinks remain readable without article wrappers or invented media details', () => {
  const link = (href, shown = true) => ({ isConnected: true, getClientRects: () => shown ? [{}] : [],
    closest: () => null, getAttribute: name => name === 'href' ? href : null });
  const links = [link('/p/grid_one/'), link('/reel/grid_two/'), link('/p/grid_one/'),
    link('/p/hidden/', false), link('https://other.example/p/no/'), link('/explore/')];
  const report = readLoadedInsights({ document: { querySelectorAll: selector => selector === 'main a[href]' ? links : [] },
    location: new URL(options.sourceUrl), now: () => options.capturedAt });
  assert.equal(report.posts.length, 2);
  assert.equal(report.counts.unknown, 2);
  assert.equal(report.datedPosts, 0);
  assert.equal(report.coverage, 'loaded-posts-only');
});
