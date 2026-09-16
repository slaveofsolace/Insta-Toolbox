import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInboxInventory, parseMetaInboxInventory, parseNativeInboxThread, resolveInboxUsernames,
} from '../extension/inbox-inventory.js';

const response = (id = '101', users = [{ pk: '2', username: 'fixture_friend' }], patch = {}) => ({
  data: { get_slide_thread_nullable: { as_ig_direct_thread: {
    thread_id: id, viewer_id: '1', is_group: false, users,
    slide_messages: [{ text: 'private fixture content' }], ...patch,
  } } },
});

test('native metadata uses exact observed identity fields and omits message bodies', () => {
  const parsed = parseNativeInboxThread(response(), { expectedAccountId: '1' });
  assert.deepEqual(parsed, {
    threadId: '101', accountId: '1', participantUsernames: ['fixture_friend'],
    unresolvedParticipants: 0, isGroup: false, source: 'native-inbox-response', requiresLiveResolution: true,
  });
  assert.equal(JSON.stringify(parsed).includes('private fixture'), false);
  assert.throws(() => parseNativeInboxThread(response(), { expectedAccountId: '3' }), /account-changed/);
  assert.throws(() => parseNativeInboxThread(response(101), { expectedAccountId: '1' }), /identity-invalid/);
  assert.throws(() => parseNativeInboxThread({ data: { threads: [] } }, { expectedAccountId: '1' }), /unrecognized/);
});

test('inventory deduplicates, bounds storage, preserves membership conflict and never claims full coverage', () => {
  const inventory = createInboxInventory({ accountId: '1', maxThreads: 2 });
  inventory.observe(response());
  inventory.observe(response());
  inventory.observe(response('102'));
  inventory.observe(response('101', [{ pk: '4', username: 'another_fixture' }]));
  const saved = inventory.snapshot();
  assert.equal(saved.conversations.length, 2);
  assert.equal(saved.complete, false);
  assert.equal(saved.conversations[0].identityConflict, true);
  saved.conversations[0].participantUsernames.push('forged');
  assert.deepEqual(inventory.snapshot().conversations[0].participantUsernames, ['fixture_friend']);
  assert.equal(inventory.observe(response('103')).reason, 'inventory-limit');
  assert.equal(inventory.snapshot().conversations.length, 2);
});

test('selected handles resolve only unique direct conversation candidates, never groups or missing participants', () => {
  const inventory = createInboxInventory({ accountId: '1' });
  inventory.observe(response('101', [{ pk: '1', username: 'fixture_owner' }, { pk: '2', username: 'fixture_friend' }]));
  inventory.observe(response('102', [{ pk: '3', username: 'group_friend' }], { is_group: true }));
  inventory.observe(response('103', [{ pk: '4', username: 'incomplete_friend' }, { pk: '5' }]));
  assert.deepEqual(resolveInboxUsernames(inventory.snapshot(), '@Fixture_Friend, group_friend; incomplete_friend'), [
    { username: 'fixture_friend', state: 'candidate', threadId: '101', requiresLiveResolution: true },
    { username: 'group_friend', state: 'not-found', threadId: null, requiresLiveResolution: true },
    { username: 'incomplete_friend', state: 'not-found', threadId: null, requiresLiveResolution: true },
  ]);
  inventory.observe(response('104'));
  assert.equal(resolveInboxUsernames(inventory.snapshot(), 'fixture_friend')[0].state, 'ambiguous');
  assert.throws(() => resolveInboxUsernames(inventory.snapshot(), '<script>'), /username-invalid/);
});

test('Meta import deduplicates split files without treating archive paths or numeric suffixes as live IDs', () => {
  const data = { thread_path: 'inbox/fixture_123456', participants: [{ name: 'Fixture Friend' }], messages: [{ content: 'not retained' }] };
  const result = parseMetaInboxInventory([
    { sourceName: 'inbox/fixture_123456/message_1.json', data },
    { sourceName: 'inbox/fixture_123456/message_2.json', data },
  ]);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].threadId, null);
  assert.deepEqual(result.conversations[0].participantLabels, ['Fixture Friend']);
  assert.equal(result.complete, false);
  assert.equal(JSON.stringify(result).includes('not retained'), false);
});

test('export conflicts remain explicit and malformed/prototype-backed imports fail', () => {
  const file = (name) => ({ sourceName: 'inbox/fixture/message_1.json', data: { messages: [], participants: [{ name }] } });
  const result = parseMetaInboxInventory([file('Fixture One'), file('Fixture Two')]);
  assert.equal(result.conversations[0].identityConflict, true);
  assert.throws(() => parseMetaInboxInventory([{ ...file('Fixture'), sourceName: '../outside/message_1.json' }]), /path-invalid/);
  assert.throws(() => parseMetaInboxInventory([Object.create(file('Fixture'))]), /conversation-invalid/);
  assert.throws(() => parseNativeInboxThread(Object.create(response()), { expectedAccountId: '1' }), /unrecognized/);
});

test('temporary inventory can be cleared without retaining old targets or conflicts', () => {
  const inventory = createInboxInventory({ accountId: '1', maxThreads: 1 });
  inventory.observe(response());
  inventory.observe(response('101', [{ pk: '4', username: 'changed_fixture' }]));
  inventory.observe(response('102'));
  assert.equal(inventory.snapshot().reason, 'inventory-limit');
  const cleared = inventory.clear();
  assert.deepEqual(cleared.conversations, []);
  assert.equal(cleared.reason, 'coverage-unverified');
  assert.equal(inventory.observe(response('102')).conversations[0].identityConflict, false);
  assert.equal(resolveInboxUsernames(inventory.snapshot(), 'changed_fixture')[0].state, 'not-found');
});

test('export fallback deduplicates split files with Windows or browser path separators', () => {
  const data = { participants: [{ name: 'Fixture Friend' }], messages: [] };
  const parsed = parseMetaInboxInventory([
    { sourceName: 'inbox\\fixture\\message_1.json', data },
    { sourceName: 'inbox/fixture/message_2.json', data },
  ]);
  assert.equal(parsed.conversations.length, 1);
  assert.equal(parsed.conversations[0].threadId, null);
});
