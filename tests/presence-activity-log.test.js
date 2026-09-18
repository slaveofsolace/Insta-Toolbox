import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPresenceActivityLog,
  normalizePresenceActivityLog,
} from '../extension/presence-activity-log.js';

const NOW = Date.parse('2026-09-18T18:00:00Z');

test('activity log keeps bounded sanitized local results without message or session payloads', async () => {
  const writes = [];
  const log = createPresenceActivityLog({
    read: () => ({ version: 1, entries: [] }),
    write: value => { writes.push(value); },
    now: () => NOW,
    limit: 10,
  });
  log.append({
    eventId: 'run-1:1', kind: 'action', action: 'likePosts',
    target: '  Post\nABC  ', outcome: 'completed', detail: '  Post liked\u0000  ',
    cookie: 'must-not-persist', messageBody: 'must-not-persist',
  });
  await log.settled();
  const [entry] = log.snapshot().entries;
  assert.deepEqual(entry, {
    eventId: 'run-1:1', at: NOW, kind: 'action', action: 'likePosts',
    target: 'Post ABC', outcome: 'completed', detail: 'Post liked',
  });
  assert.equal(JSON.stringify(writes).includes('must-not-persist'), false);
});

test('activity log ignores copied duplicate events and bounds retained history', async () => {
  const log = createPresenceActivityLog({ read: () => null, write: () => {}, now: () => NOW, limit: 10 });
  for (let index = 0; index < 12; index += 1) {
    log.append({ eventId: `event-${index}`, at: NOW + index, kind: 'session', outcome: 'completed' });
  }
  log.append({ eventId: 'event-11', at: NOW + 99, kind: 'session', outcome: 'uncertain' });
  await log.settled();
  assert.equal(log.snapshot().entries.length, 10);
  assert.equal(log.snapshot().entries[0].eventId, 'event-11');
  assert.equal(log.snapshot().entries.filter(row => row.eventId === 'event-11').length, 1);
});

test('activity log rejects invalid records and exports the same redacted entries', async () => {
  const normalized = normalizePresenceActivityLog({ entries: [
    { eventId: '', at: NOW, outcome: 'completed' },
    { eventId: 'unknown', at: NOW, outcome: 'made-up' },
    { eventId: 'valid', at: NOW, outcome: 'paused', detail: 'Paused by operator' },
  ] });
  assert.equal(normalized.entries.length, 1);
  const log = createPresenceActivityLog({ read: () => normalized, write: () => {}, now: () => NOW });
  const exported = log.exportRecord();
  assert.equal(exported.kind, 'insta-toolbox-presence-log');
  assert.equal(exported.entries.length, 1);
  assert.equal(exported.entries[0].eventId, 'valid');
  log.clear();
  await log.settled();
  assert.equal(log.snapshot().entries.length, 0);
});

test('a failed write is reported without blocking the next activity save', async () => {
  let attempts = 0;
  const errors = [];
  const log = createPresenceActivityLog({
    read: () => null,
    write: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('storage unavailable');
    },
    onWriteError: error => errors.push(error.message),
    now: () => NOW,
  });
  log.append({ eventId: 'failed-write', kind: 'session', outcome: 'started' });
  await assert.rejects(log.settled(), /storage unavailable/);
  log.append({ eventId: 'recovered-write', at: NOW + 1, kind: 'session', outcome: 'completed' });
  await log.settled();
  assert.equal(attempts, 2);
  assert.deepEqual(errors, ['storage unavailable']);
});
