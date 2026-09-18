import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESENCE_PREFERENCES_KEY, createPresencePreferenceStore, defaultPresencePreferences,
  normalizePresencePreferences, validatePresencePreferences,
} from '../extension/presence-preferences.js';

const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
function storage(initial) {
  const records = new Map([['unrelated-appearance', { theme: 'dark' }]]);
  if (initial !== undefined) records.set(PRESENCE_PREFERENCES_KEY, structuredClone(initial));
  const writes = [], reads = [];
  return { records, writes, reads,
    read: async key => { reads.push(key); return structuredClone(records.get(key)); },
    write: async (key, value) => { writes.push([key, structuredClone(value)]); records.set(key, structuredClone(value)); },
  };
}

test('defaults contain only the current editable routine choices', () => {
  assert.deepEqual(defaultPresencePreferences(), { schemaVersion: 1, followLimit: 6, protectedHandles: [],
    window: { start: 540, end: 1200 }, skipPrivate: true });
  const first = defaultPresencePreferences(); first.window.start = 0; first.protectedHandles.push('changed');
  assert.equal(defaultPresencePreferences().window.start, 540); assert.deepEqual(defaultPresencePreferences().protectedHandles, []);
});

test('normalization accepts versionless and version-zero choices without retaining profile or run data', () => {
  for (const version of [undefined, 0]) {
    const saved = { ...(version === undefined ? {} : { schemaVersion: version }), followLimit: 12,
      protectedHandles: '@First, SECOND;@first', window: { start: 1320, end: 120 }, skipPrivate: false,
      accountId: '77', targetIds: ['88'], receipt: {}, authority: 'token', plan: {}, history: [], enabled: true };
    const result = normalizePresencePreferences(saved);
    assert.deepEqual(result.preferences, { schemaVersion: 1, followLimit: 12, protectedHandles: ['first', 'second'],
      window: { start: 1320, end: 120 }, skipPrivate: false });
    assert.deepEqual(result.issues, ['older-record']); assert.equal(result.writable, true);
  }
});

test('malformed choices fall back field by field and report discarded protections', () => {
  const result = normalizePresencePreferences({ schemaVersion: 1, followLimit: 51,
    protectedHandles: ['@Safe', 'not/a/name', 'direct', 123], window: { start: 300, end: 300 }, skipPrivate: 'false' });
  assert.deepEqual(result.preferences, { ...defaultPresencePreferences(), protectedHandles: ['safe'] });
  assert.deepEqual(result.issues, ['allowance-invalid', 'protected-handles-invalid', 'hours-invalid', 'privacy-invalid']);
  for (const input of [[], 'text', 12, new Date()]) {
    assert.deepEqual(normalizePresencePreferences(input).issues, ['record-invalid']);
  }
});

test('unknown future versions are not interpreted or writable', () => {
  const result = normalizePresencePreferences({ schemaVersion: 2, followLimit: 40, protectedHandles: ['future'] });
  assert.deepEqual(result.preferences, defaultPresencePreferences());
  assert.deepEqual(result.issues, ['version-unsupported']); assert.equal(result.writable, false);
});

test('saved getters are never invoked when reading malformed preferences', () => {
  let invoked = 0;
  const source = { schemaVersion: 1, get followLimit() { invoked += 1; return 9; },
    window: { get start() { invoked += 1; return 10; }, end: 900 } };
  assert.deepEqual(normalizePresencePreferences(source).issues, ['allowance-invalid', 'hours-invalid']);
  assert.equal(invoked, 0);
  const protectedHandles = ['safe'];
  Object.defineProperty(protectedHandles, '1', { get() { invoked += 1; return 'hidden'; } });
  const result = normalizePresencePreferences({ schemaVersion: 1, protectedHandles });
  assert.deepEqual(result.preferences.protectedHandles, ['safe']);
  assert.deepEqual(result.issues, ['protected-handles-invalid']); assert.equal(invoked, 0);
});

test('strict validation accepts zero allowance, overnight hours and all 500 protected handles', () => {
  const result = validatePresencePreferences({ followLimit: 0, window: { start: 1380, end: 60 }, skipPrivate: false,
    protectedHandles: Array.from({ length: 500 }, (_, i) => `account_${i}`) });
  assert.equal(result.followLimit, 0); assert.equal(result.protectedHandles.length, 500);
  assert.equal(result.skipPrivate, false);
});

test('strict validation rejects malformed fields, unknown controls and authority', () => {
  for (const followLimit of [-1, 51, 1.5, NaN, Infinity, '6', null]) {
    assert.throws(() => validatePresencePreferences({ followLimit }), /allowance-invalid/);
  }
  for (const window of [null, [], { start: -1, end: 20 }, { start: 20, end: 1440 }, { start: 20, end: 20 }]) {
    assert.throws(() => validatePresencePreferences({ window }), /hours-invalid/);
  }
  assert.throws(() => validatePresencePreferences({ protectedHandles: ['bad/name'] }), /protection-invalid/);
  assert.throws(() => validatePresencePreferences({ protectedHandles: Array(501).fill('same') }), /protection-invalid/);
  assert.throws(() => validatePresencePreferences({ protectedHandles: 'a'.repeat(16_501) }), /protection-invalid/);
  assert.throws(() => validatePresencePreferences({ skipPrivate: 1 }), /privacy-invalid/);
  assert.throws(() => validatePresencePreferences({ authority: 'none' }), /field-invalid/);
});

test('load never writes, migrates other keys, or restores any executable state', async () => {
  const data = storage({ followLimit: 9, protectedHandles: ['kept'], active: true, selectedTargets: ['77'], permissions: {} });
  const store = createPresencePreferenceStore(data);
  const result = await store.load();
  assert.equal(result.preferences.followLimit, 9); assert.deepEqual(result.issues, ['older-record']);
  assert.deepEqual(data.writes, []); assert.deepEqual(data.reads, [PRESENCE_PREFERENCES_KEY]);
  assert.deepEqual(data.records.get('unrelated-appearance'), { theme: 'dark' });
  for (const forbidden of ['active', 'selectedTargets', 'permissions']) assert.equal(JSON.stringify(result).includes(forbidden), false);
});

test('updates normalize handles, merge partial hours and persist only their dedicated key', async () => {
  const data = storage(defaultPresencePreferences()), store = createPresencePreferenceStore(data);
  const result = await store.update({ protectedHandles: '@One, @TWO;one', window: { start: 500 } });
  assert.deepEqual(result.preferences.protectedHandles, ['one', 'two']);
  assert.deepEqual(result.preferences.window, { start: 500, end: 1200 });
  assert.equal(data.writes.length, 1); assert.equal(data.writes[0][0], PRESENCE_PREFERENCES_KEY);
  assert.deepEqual(data.records.get('unrelated-appearance'), { theme: 'dark' });
  result.preferences.protectedHandles.push('outside');
  assert.deepEqual((await store.load()).preferences.protectedHandles, ['one', 'two']);
});

test('an explicit update strips stale execution fields without copying their values', async () => {
  const data = storage({ ...defaultPresencePreferences(), authority: 'not-a-preference', targets: ['201'],
    accountId: '77', receipts: {}, selectedTargetIds: ['201'], runState: 'running', enabled: true });
  const store = createPresencePreferenceStore(data);
  await store.update({ followLimit: 8 });
  assert.deepEqual(data.records.get(PRESENCE_PREFERENCES_KEY), { ...defaultPresencePreferences(), followLimit: 8 });
  assert.deepEqual(data.records.get('unrelated-appearance'), { theme: 'dark' });
});

test('unrelated updates cannot silently discard malformed saved protections', async () => {
  const saved = { ...defaultPresencePreferences(), protectedHandles: ['kept', 'bad/name'] };
  const data = storage(saved), store = createPresencePreferenceStore(data);
  const loaded = await store.load();
  assert.deepEqual(loaded.preferences.protectedHandles, ['kept']);
  assert.deepEqual(loaded.issues, ['protected-handles-invalid']);
  await assert.rejects(store.update({ followLimit: 10 }), error => error.code === 'presence-preferences-repair-required');
  assert.deepEqual(data.writes, []); assert.deepEqual(data.records.get(PRESENCE_PREFERENCES_KEY), saved);
  const repaired = await store.update({ protectedHandles: ['kept', 'replacement'], followLimit: 10 });
  assert.deepEqual(repaired.preferences.protectedHandles, ['kept', 'replacement']);
  assert.equal(repaired.preferences.followLimit, 10); assert.deepEqual(repaired.issues, []);
});

test('each damaged known field requires an explicit valid replacement', async () => {
  const cases = [
    { damaged: { followLimit: 100 }, unrelated: { skipPrivate: false }, repair: { followLimit: 10 } },
    { damaged: { skipPrivate: 'false' }, unrelated: { followLimit: 10 }, repair: { skipPrivate: false } },
    { damaged: { window: { start: 40, end: 40 } }, unrelated: { followLimit: 10 }, repair: { window: { start: 30, end: 90 } } },
  ];
  for (const { damaged, unrelated, repair } of cases) {
    const saved = { ...defaultPresencePreferences(), ...damaged };
    const data = storage(saved), store = createPresencePreferenceStore(data);
    await assert.rejects(store.update(unrelated), /repair-required/);
    assert.deepEqual(data.writes, []); assert.deepEqual(data.records.get(PRESENCE_PREFERENCES_KEY), saved);
    assert.deepEqual((await store.update(repair)).issues, []);
  }
});

test('damaged hours require the complete pair rather than a fallback half', async () => {
  const saved = { ...defaultPresencePreferences(), window: { start: 'unknown', end: 800 } };
  const data = storage(saved), store = createPresencePreferenceStore(data);
  await assert.rejects(store.update({ window: { start: 200 } }), /repair-required/);
  await assert.rejects(store.update({ window: { end: 900 } }), /repair-required/);
  assert.deepEqual(data.writes, []); assert.deepEqual(data.records.get(PRESENCE_PREFERENCES_KEY), saved);
  const repaired = await store.update({ window: { start: 200, end: 900 } });
  assert.deepEqual(repaired.preferences.window, { start: 200, end: 900 });
});

test('repairing one damaged field cannot erase another damaged field', async () => {
  const saved = { ...defaultPresencePreferences(), protectedHandles: ['bad/name'], skipPrivate: 'invalid' };
  const data = storage(saved), store = createPresencePreferenceStore(data);
  await assert.rejects(store.update({ protectedHandles: [] }), /repair-required/);
  await assert.rejects(store.update({ skipPrivate: true }), /repair-required/);
  assert.deepEqual(data.writes, []); assert.deepEqual(data.records.get(PRESENCE_PREFERENCES_KEY), saved);
  assert.deepEqual((await store.update({ protectedHandles: [], skipPrivate: true })).issues, []);
});

test('a wholly malformed record requires all editable choices and complete hours', async () => {
  for (const saved of ['unreadable', [], 42]) {
    const data = storage(saved), store = createPresencePreferenceStore(data);
    await assert.rejects(store.update({ followLimit: 8 }), /repair-required/);
    await assert.rejects(store.update({ followLimit: 8, protectedHandles: [], skipPrivate: true,
      window: { start: 20 } }), /repair-required/);
    assert.deepEqual(data.writes, []); assert.deepEqual(data.records.get(PRESENCE_PREFERENCES_KEY), saved);
    const replacement = { followLimit: 8, protectedHandles: ['kept'], skipPrivate: true, window: { start: 20, end: 800 } };
    assert.deepEqual((await store.update(replacement)).preferences, { schemaVersion: 1, ...replacement });
  }
});

test('older-record alone still migrates additively on an explicit single-field edit', async () => {
  const data = storage({ followLimit: 9, protectedHandles: ['kept'], window: { start: 200, end: 900 }, skipPrivate: false });
  const store = createPresencePreferenceStore(data);
  const updated = await store.update({ followLimit: 10 });
  assert.deepEqual(updated.preferences, { schemaVersion: 1, followLimit: 10,
    protectedHandles: ['kept'], window: { start: 200, end: 900 }, skipPrivate: false });
  assert.deepEqual(updated.issues, []);
});

test('queued updates copy their input immediately and merge against the latest completed write', async () => {
  const gate = deferred(), entered = deferred(); const data = storage(); let count = 0;
  const store = createPresencePreferenceStore({ ...data, write: async (...args) => {
    if (count++ === 0) { entered.resolve(); await gate.promise; }
    await data.write(...args);
  } });
  const first = store.update({ followLimit: 12 }); await entered.promise;
  const patch = { protectedHandles: ['second'], window: { start: 100 } };
  const second = store.update(patch); const loaded = store.load();
  patch.protectedHandles[0] = 'changed'; patch.window.start = 200;
  gate.resolve(); await first; const final = await second;
  assert.equal(final.preferences.followLimit, 12); assert.deepEqual(final.preferences.protectedHandles, ['second']);
  assert.equal(final.preferences.window.start, 100); assert.deepEqual((await loaded).preferences, final.preferences);
});

test('the injected shared lock prevents lost patches across separate store instances', async () => {
  const data = storage(); let tail = Promise.resolve(), locks = 0;
  const withLock = operation => { const result = tail.then(async () => { locks += 1; return operation(); }); tail = result.catch(() => {}); return result; };
  const first = createPresencePreferenceStore({ ...data, withLock });
  const second = createPresencePreferenceStore({ ...data, withLock });
  await Promise.all([first.update({ followLimit: 14 }), second.update({ skipPrivate: false })]);
  const final = await first.load();
  assert.equal(final.preferences.followLimit, 14); assert.equal(final.preferences.skipPrivate, false); assert.equal(locks, 3);
});

test('invalid edits and future-version records are preserved without writes', async () => {
  const data = storage({ schemaVersion: 9, anotherSetting: 'keep' }), store = createPresencePreferenceStore(data);
  await assert.rejects(store.update({ followLimit: 9 }), /version-unsupported/);
  await assert.rejects(store.update({ targets: ['123'] }), /field-invalid/);
  await assert.rejects(store.update({ window: { start: 0, end: 0 } }), /hours-invalid/);
  assert.deepEqual(data.writes, []);
  assert.deepEqual(data.records.get(PRESENCE_PREFERENCES_KEY), { schemaVersion: 9, anotherSetting: 'keep' });
});

test('read failures are explicit and a later read may recover', async () => {
  let failed = true; const data = storage();
  const store = createPresencePreferenceStore({ ...data, read: async key => { if (failed) throw new Error('private storage detail'); return data.read(key); } });
  await assert.rejects(store.load(), error => error.code === 'presence-preferences-read-failed' && !error.message.includes('private'));
  failed = false; assert.deepEqual((await store.load()).preferences, defaultPresencePreferences());
});

test('a rejected write fences newer writes and reports loaded preferences as not writable', async () => {
  const data = storage(); let writes = 0;
  const store = createPresencePreferenceStore({ ...data, write: async () => { writes += 1; throw new Error('storage-detail'); } });
  await assert.rejects(store.update({ followLimit: 8 }), /write-failed/);
  await assert.rejects(store.update({ followLimit: 10 }), /write-failed/);
  assert.equal(writes, 1);
  const result = await store.load();
  assert.equal(result.writable, false); assert.deepEqual(result.issues, ['write-outcome-uncertain']);
});

test('a timed-out write cannot be overtaken by a newer update when it later settles', async () => {
  const write = deferred(), data = storage(); let writes = 0;
  const store = createPresencePreferenceStore({ ...data, timeoutMs: 15,
    write: async (key, value) => { writes += 1; await write.promise; await data.write(key, value); } });
  await assert.rejects(store.update({ followLimit: 8 }), /write-timeout/);
  await assert.rejects(store.update({ followLimit: 10 }), /write-timeout/);
  write.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(writes, 1); assert.equal(data.records.get(PRESENCE_PREFERENCES_KEY).followLimit, 8);
});

test('a timed-out lock callback cannot perform a delayed read or write', async () => {
  let resume; const data = storage();
  const store = createPresencePreferenceStore({ ...data, timeoutMs: 15, withLock: operation => new Promise(resolve => { resume = () => resolve(operation()); }) });
  await assert.rejects(store.update({ followLimit: 8 }), /lock-timeout/);
  resume(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(data.reads, []); assert.deepEqual(data.writes, []);
});

test('read timeout cannot continue into a write after its result arrives', async () => {
  const gate = deferred(), data = storage();
  const store = createPresencePreferenceStore({ ...data, timeoutMs: 15, read: () => gate.promise });
  await assert.rejects(store.update({ followLimit: 8 }), /read-timeout/);
  gate.resolve(defaultPresencePreferences()); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(data.writes, []);
});

test('adapter and edit accessor failures do not launch storage work', async () => {
  for (const options of [{}, { read: () => {}, write: () => {}, timeoutMs: 0 }, { read: () => {}, write: () => {}, withLock: true }]) {
    assert.throws(() => createPresencePreferenceStore(options), /adapter-invalid/);
  }
  const data = storage(), store = createPresencePreferenceStore(data); let invoked = 0;
  await assert.rejects(store.update({ get followLimit() { invoked += 1; return 4; } }), /field-invalid/);
  assert.equal(invoked, 0); assert.deepEqual(data.reads, []); assert.deepEqual(data.writes, []);
});
