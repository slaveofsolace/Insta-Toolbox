import { normalizeHandle } from '../src/core/presence.js';

export const PRESENCE_PREFERENCES_KEY = 'instaToolboxPresencePreferencesV1';
export const PRESENCE_PREFERENCES_VERSION = 1;
const FIELDS = new Set(['schemaVersion', 'followLimit', 'protectedHandles', 'window', 'skipPrivate']);
const MAX_HANDLES = 500;
const MAX_HANDLE_TEXT = 16_500;
const plain = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const entry = (value, key) => Object.getOwnPropertyDescriptor(value, key);
const own = (value, key) => Object.hasOwn(value, key);
const data = (value, key) => entry(value, key)?.value;
const clone = value => structuredClone(value);
const validMinute = value => Number.isSafeInteger(value) && value >= 0 && value <= 1439;
function fail(code) { const error = new Error(code); error.code = code; throw error; }

export function defaultPresencePreferences() {
  return { schemaVersion: PRESENCE_PREFERENCES_VERSION, followLimit: 6,
    protectedHandles: [], window: { start: 540, end: 1200 }, skipPrivate: true };
}

function handles(value, strict, issues) {
  let values;
  if (typeof value === 'string' && value.length <= MAX_HANDLE_TEXT) values = value.split(/[\s,;]+/).filter(Boolean);
  else if (Array.isArray(value)) values = Array.from({ length: Math.min(value.length, MAX_HANDLES + 1) },
    (_, index) => data(value, String(index)));
  if (!values || values.length > MAX_HANDLES) {
    if (strict) fail('presence-preferences-protection-invalid');
    issues.push('protected-handles-invalid');
    values = values?.slice(0, MAX_HANDLES) || [];
  }
  const result = [];
  for (const value of values) {
    try {
      const username = normalizeHandle(value);
      if (!result.includes(username)) result.push(username);
    } catch {
      if (strict) fail('presence-preferences-protection-invalid');
      if (!issues.includes('protected-handles-invalid')) issues.push('protected-handles-invalid');
    }
  }
  return result;
}

function normalize(value, strict = false) {
  const preferences = defaultPresencePreferences(), issues = [];
  if (value == null && !strict) return { preferences, issues, writable: true };
  if (!plain(value)) {
    if (strict) fail('presence-preferences-record-invalid');
    return { preferences, issues: ['record-invalid'], writable: true };
  }
  const version = data(value, 'schemaVersion');
  if (own(value, 'schemaVersion') && version !== 0 && version !== PRESENCE_PREFERENCES_VERSION) {
    if (strict) fail('presence-preferences-version-unsupported');
    return { preferences, issues: ['version-unsupported'], writable: false };
  }
  if (version !== PRESENCE_PREFERENCES_VERSION) issues.push('older-record');
  if (strict && Object.keys(value).some(key => !FIELDS.has(key))) fail('presence-preferences-field-invalid');
  if (own(value, 'followLimit')) {
    const limit = data(value, 'followLimit');
    if (Number.isSafeInteger(limit) && limit >= 0 && limit <= 50) preferences.followLimit = limit;
    else if (strict) fail('presence-preferences-allowance-invalid');
    else issues.push('allowance-invalid');
  }
  if (own(value, 'protectedHandles')) preferences.protectedHandles = handles(data(value, 'protectedHandles'), strict, issues);
  if (own(value, 'window')) {
    const window = data(value, 'window');
    if (plain(window) && validMinute(data(window, 'start')) && validMinute(data(window, 'end'))
      && data(window, 'start') !== data(window, 'end')) {
      if (strict && Object.keys(window).some(key => !['start', 'end'].includes(key))) fail('presence-preferences-hours-invalid');
      preferences.window = { start: data(window, 'start'), end: data(window, 'end') };
    } else if (strict) fail('presence-preferences-hours-invalid');
    else issues.push('hours-invalid');
  }
  if (own(value, 'skipPrivate')) {
    if (typeof data(value, 'skipPrivate') === 'boolean') preferences.skipPrivate = data(value, 'skipPrivate');
    else if (strict) fail('presence-preferences-privacy-invalid');
    else issues.push('privacy-invalid');
  }
  return { preferences, issues, writable: true };
}

/** Read only these editable choices; repairs are reported, never auto-written. */
export function normalizePresencePreferences(value) { return normalize(value); }

/** Validate edits before they enter the persistence queue. */
export function validatePresencePreferences(value) { return normalize(value, true).preferences; }

function capturePatch(value) {
  if (!plain(value) || Object.keys(value).some(key => !FIELDS.has(key))) fail('presence-preferences-field-invalid');
  const patch = {};
  for (const key of Object.keys(value)) {
    if (!own(entry(value, key), 'value')) fail('presence-preferences-field-invalid');
    patch[key] = data(value, key);
  }
  if (own(patch, 'window')) {
    if (!plain(patch.window) || Object.keys(patch.window).some(key => !['start', 'end'].includes(key))) fail('presence-preferences-hours-invalid');
    for (const key of Object.keys(patch.window)) {
      if (!validMinute(data(patch.window, key))) fail('presence-preferences-hours-invalid');
    }
    if (own(patch.window, 'start') && own(patch.window, 'end')
      && data(patch.window, 'start') === data(patch.window, 'end')) fail('presence-preferences-hours-invalid');
    patch.window = Object.fromEntries(Object.keys(patch.window).map(key => [key, data(patch.window, key)]));
  }
  // Check individual fields now; the complete hours pair is checked after merging.
  const withoutWindow = { ...patch }; delete withoutWindow.window;
  validatePresencePreferences(withoutWindow);
  if (own(patch, 'protectedHandles')) patch.protectedHandles = handles(patch.protectedHandles, true, []);
  return clone(patch);
}

function requireExplicitRepairs(issues, patch) {
  const damagedFields = {
    'allowance-invalid': 'followLimit',
    'protected-handles-invalid': 'protectedHandles',
    'hours-invalid': 'window',
    'privacy-invalid': 'skipPrivate',
  };
  const required = issues.includes('record-invalid')
    ? ['followLimit', 'protectedHandles', 'window', 'skipPrivate']
    : issues.flatMap(issue => damagedFields[issue] ? [damagedFields[issue]] : []);
  for (const field of required) {
    if (!own(patch, field)) fail('presence-preferences-repair-required');
    if (field === 'window' && (!own(patch.window, 'start') || !own(patch.window, 'end'))) {
      fail('presence-preferences-repair-required');
    }
  }
}

/**
 * read(key) and write(key, value) touch one private preference key only.
 * withLock(operation), when supplied, must serialize this key across tabs.
 * The local queue alone orders calls to this store instance, not other tabs.
 */
export function createPresencePreferenceStore({ read, write, withLock = null, timeoutMs = 10_000 } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function'
    || (withLock !== null && typeof withLock !== 'function')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail('presence-preferences-adapter-invalid');
  let tail = Promise.resolve(), writeFailure = null;
  function enqueue(operation) {
    const result = tail.then(async () => {
      let active = true, phase = 'lock', timer;
      const guard = () => { if (!active) fail('presence-preferences-operation-expired'); };
      const invoke = async () => {
        guard(); phase = 'read';
        let stored;
        try { stored = await read(PRESENCE_PREFERENCES_KEY); }
        catch { fail('presence-preferences-read-failed'); }
        guard();
        const current = normalizePresencePreferences(stored);
        if (!operation) return { ...current,
          issues: writeFailure ? [...current.issues, 'write-outcome-uncertain'] : current.issues,
          writable: current.writable && !writeFailure };
        if (writeFailure) throw writeFailure;
        if (!current.writable) fail('presence-preferences-version-unsupported');
        requireExplicitRepairs(current.issues, operation);
        const next = validatePresencePreferences({ ...current.preferences, ...operation,
          window: { ...current.preferences.window, ...(operation.window || {}) } });
        guard(); phase = 'write';
        try { await write(PRESENCE_PREFERENCES_KEY, clone(next)); }
        catch {
          writeFailure = new Error('presence-preferences-write-failed');
          writeFailure.code = writeFailure.message; throw writeFailure;
        }
        guard(); phase = 'done';
        return { preferences: next, issues: [], writable: true };
      };
      try {
        return clone(await Promise.race([
          Promise.resolve().then(() => withLock ? withLock(invoke) : invoke()),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error(`presence-preferences-${phase}-timeout`); error.code = error.message;
              if (phase === 'write') writeFailure = error;
              active = false; reject(error);
            }, timeoutMs);
          }),
        ]));
      } catch (error) {
        if (String(error?.code || '').startsWith('presence-preferences-')) throw error;
        fail('presence-preferences-lock-failed');
      } finally { active = false; clearTimeout(timer); }
    });
    tail = result.catch(() => {});
    return result;
  }
  return Object.freeze({
    load: () => enqueue(null),
    update(patch) {
      try { return enqueue(capturePatch(patch)); }
      catch (error) { return Promise.reject(error); }
    },
  });
}
