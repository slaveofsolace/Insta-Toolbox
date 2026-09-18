import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxDiscovery, inboxThreadId } from '../extension/inbox-discovery.js';

const accountId = 'account_fixture';
const anchor = (href, hidden = false) => ({ isConnected: true, getAttribute: () => href, closest: () => hidden ? {} : null });
const container = (hrefs) => ({ isConnected: true, querySelectorAll: () => hrefs.map((href) => anchor(href)) });
const observe = (discovery, hrefs, patch = {}) => discovery.observe({ root: container(hrefs), section: 'primary', observedAccountId: accountId, ...patch });

test('thread URLs require the exact Instagram origin and numeric native thread path', () => {
  for (const href of ['/direct/t/123/', 'https://www.instagram.com/direct/t/123?source=inbox']) assert.equal(inboxThreadId(href), '123');
  const credentialUrl = new URL('https://www.instagram.com/direct/t/123/');
  credentialUrl.username = 'fixture';
  for (const href of ['/direct/t/nope/', '/direct/t/123/extra', 'https://instagram.com/direct/t/123/', 'https://www.instagram.com.evil.test/direct/t/123/', credentialUrl.href, '//evil.test/direct/t/123/', 'javascript:alert(1)', '/direct/inbox/', null]) assert.equal(inboxThreadId(href), null);
});

test('accumulates recycled windows and deduplicates by thread rather than live row position', () => {
  const discovery = createInboxDiscovery({ accountId });
  const row = anchor('/direct/t/101/');
  const root = { querySelectorAll: () => [row] };
  discovery.observe({ root, section: 'primary', observedAccountId: accountId });
  row.getAttribute = () => '/direct/t/102/';
  discovery.observe({ root, section: 'primary', observedAccountId: accountId });
  const state = observe(discovery, ['/direct/t/101/', '/direct/t/103/', '/profile/']);
  assert.deepEqual(state.conversations.map((entry) => entry.threadId), ['101', '102', '103']);
  assert.equal(state.complete, false);
  assert.equal('message' in state.conversations[0], false);
});

test('keeps section provenance and cannot infer completeness from repeated last rows', () => {
  const discovery = createInboxDiscovery({ accountId, sections: ['primary', 'general'] });
  observe(discovery, ['/direct/t/101/']);
  observe(discovery, ['/direct/t/101/']);
  const state = observe(discovery, ['/direct/t/101/'], { section: 'general' });
  assert.deepEqual(state.conversations[0].sections, ['primary', 'general']);
  assert.equal(state.complete, false);
  assert.equal(state.sections[0].samples, 2);
});

test('native completion proof must match account and section, be stable and have no pending load', () => {
  let proof = { kind: 'native-terminal-marker', accountId, section: 'primary', noPendingLoad: true, stable: true };
  const discovery = createInboxDiscovery({ accountId, proveTerminal: () => proof });
  assert.equal(observe(discovery, ['/direct/t/101/'], { loading: true }).complete, false);
  assert.equal(observe(discovery, ['/direct/t/101/']).complete, true);
  proof = { ...proof, accountId: 'other' };
  assert.equal(observe(discovery, ['/direct/t/101/']).complete, false);
});

test('abort and account switching preserve captured inventory and never mix accounts', () => {
  const discovery = createInboxDiscovery({ accountId }); observe(discovery, ['/direct/t/101/']);
  const controller = new AbortController(); controller.abort();
  const state = observe(discovery, ['/direct/t/102/'], { signal: controller.signal });
  assert.equal(state.reason, 'cancelled'); assert.equal(state.conversations.length, 1);
  const switched = createInboxDiscovery({ accountId }); observe(switched, ['/direct/t/101/']);
  const wrong = observe(switched, ['/direct/t/102/'], { observedAccountId: 'another_account' });
  assert.equal(wrong.reason, 'account-changed'); assert.equal(wrong.conversations.length, 1);
});

test('thread/sample bounds remain partial and do not overwrite previous discoveries', () => {
  const threads = createInboxDiscovery({ accountId, maxThreads: 1 });
  const capped = observe(threads, ['/direct/t/101/', '/direct/t/102/']);
  assert.equal(capped.reason, 'thread-limit'); assert.equal(capped.complete, false); assert.equal(capped.conversations.length, 1);
  const samples = createInboxDiscovery({ accountId, maxSamples: 1 });
  observe(samples, ['/direct/t/101/']);
  assert.equal(observe(samples, ['/direct/t/102/']).reason, 'sample-limit');
});

test('hidden or detached rows and missing containers do not become conversations', () => {
  const discovery = createInboxDiscovery({ accountId });
  const root = { querySelectorAll: () => [anchor('/direct/t/101/', true), { ...anchor('/direct/t/102/'), isConnected: false }] };
  assert.equal(discovery.observe({ root, section: 'primary', observedAccountId: accountId }).conversations.length, 0);
  assert.equal(discovery.observe({ root: null, section: 'primary', observedAccountId: accountId }).sections[0].reason, 'inbox-container-unavailable');
});

test('snapshot mutation cannot modify discovery records or completeness', () => {
  const discovery = createInboxDiscovery({ accountId }); const state = observe(discovery, ['/direct/t/101/']);
  state.conversations[0].threadId = '999'; state.conversations[0].sections.push('requests'); state.sections[0].complete = true;
  assert.deepEqual(discovery.snapshot().conversations, [{ threadId: '101', sections: ['primary'] }]);
  assert.equal(discovery.snapshot().complete, false);
});
