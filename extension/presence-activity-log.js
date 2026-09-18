const VERSION = 1;
const DEFAULT_LIMIT = 500;
const OUTCOMES = new Set([
  'started', 'completed', 'skipped', 'uncertain', 'paused', 'resumed',
  'stopped', 'expired', 'needs-attention', 'quiet',
]);

const clean = (value, limit) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

const timestamp = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const at = timestamp(value.at);
  const eventId = clean(value.eventId, 160);
  const outcome = clean(value.outcome, 32);
  if (!at || !eventId || !OUTCOMES.has(outcome)) return null;
  return Object.freeze({
    eventId,
    at,
    kind: value.kind === 'action' ? 'action' : 'session',
    action: clean(value.action, 48),
    target: clean(value.target, 120),
    outcome,
    detail: clean(value.detail, 240),
  });
}

export function normalizePresenceActivityLog(value, { limit = DEFAULT_LIMIT } = {}) {
  const safeLimit = Number.isInteger(limit) && limit >= 10 && limit <= 2_000
    ? limit : DEFAULT_LIMIT;
  const rows = Array.isArray(value?.entries) ? value.entries : [];
  const entries = [];
  const seen = new Set();
  for (const candidate of rows) {
    const entry = normalizeEntry(candidate);
    if (!entry || seen.has(entry.eventId)) continue;
    seen.add(entry.eventId);
    entries.push(entry);
    if (entries.length >= safeLimit) break;
  }
  return Object.freeze({ version: VERSION, entries: Object.freeze(entries) });
}

export function createPresenceActivityLog({
  read = () => null,
  write = () => {},
  onWriteError = () => {},
  now = Date.now,
  limit = DEFAULT_LIMIT,
} = {}) {
  if (typeof read !== 'function' || typeof write !== 'function'
    || typeof onWriteError !== 'function' || typeof now !== 'function') {
    throw new Error('presence-log-adapter-required');
  }
  let record = normalizePresenceActivityLog(read(), { limit });
  let writeQueue = Promise.resolve();
  let latestWrite = Promise.resolve();
  const listeners = new Set();

  const snapshot = () => structuredClone(record);
  const publish = () => {
    const value = snapshot();
    for (const listener of listeners) listener(value);
    return value;
  };
  const persist = () => {
    const value = snapshot();
    latestWrite = writeQueue.then(() => write(value));
    writeQueue = latestWrite.catch((error) => {
      onWriteError(error);
    });
    return latestWrite;
  };

  function append(value = {}) {
    const at = timestamp(value.at) || timestamp(now());
    const seed = clean(value.eventId, 160)
      || `${at}:${clean(value.kind, 24)}:${clean(value.action, 48)}:${clean(value.outcome, 32)}`;
    const entry = normalizeEntry({ ...value, at, eventId: seed });
    if (!entry) throw new Error('presence-log-entry-invalid');
    if (record.entries.some(row => row.eventId === entry.eventId)) return entry;
    record = normalizePresenceActivityLog({ entries: [entry, ...record.entries] }, { limit });
    publish();
    void persist();
    return entry;
  }

  function clear() {
    record = normalizePresenceActivityLog(null, { limit });
    publish();
    void persist();
  }

  return Object.freeze({
    append,
    clear,
    snapshot,
    settled: () => latestWrite,
    exportRecord() {
      return Object.freeze({
        schemaVersion: VERSION,
        kind: 'insta-toolbox-presence-log',
        generatedAt: new Date(now()).toISOString(),
        entries: snapshot().entries,
      });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new Error('presence-log-listener-required');
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  });
}
