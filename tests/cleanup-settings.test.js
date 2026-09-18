import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../extension/cleanup-settings.js', import.meta.url), 'utf8'), context);
const settings = context.InstaToolboxCleanupSettings;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('cleanup preferences add defaults without restoring authority or old global unlocks', () => {
  const old = { liveActionEnabled: true, dailyDmLimit: 50, token: 'not-authority', speed: 'fast' };
  const normalized = settings.normalize(old);
  assert.equal(normalized.speed, 'standard');
  assert.equal(normalized.messageScope, 'all');
  assert.equal(normalized.workerCount, 1);
  assert.equal('token' in normalized, false);
  assert.equal('liveActionEnabled' in normalized, false);
  assert.equal(old.dailyDmLimit, 50);
});

test('userscript reaction cleanup is supported without enabling unfinished adapters elsewhere', () => {
  for (const surface of ['userscript', 'extension', 'desktop', 'pwa']) {
    const effective = settings.effective({ speed: 'fast', removeOwnReactions: true, execution: 'background', workerCount: 2, notifications: true }, surface);
    assert.deepEqual(plain(effective), { ...plain(settings.defaults()), speed: 'standard', showSummary: true,
      removeOwnReactions: surface === 'userscript',
      execution: surface === 'userscript' ? 'background' : 'foreground',
      workerCount: surface === 'userscript' ? 2 : 1 });
    assert.equal(settings.capabilities(surface).fast, false);
    assert.equal(settings.capabilities(surface).reactions, surface === 'userscript');
    if (surface !== 'userscript') assert.ok(settings.capabilities(surface).reasons.reactions);
  }
});

test('finite scopes, workers and enum values are normalized without mutating input', () => {
  for (const limit of [0, -1, 251, Infinity, NaN, 1.5, null]) assert.equal(settings.normalize({ messageLimit: limit }).messageLimit, 1);
  assert.equal(settings.normalize({ messageLimit: 250, messageScope: 'oldest', workerCount: 2 }).messageLimit, 250);
  assert.equal(settings.normalize({ workerCount: 5 }).workerCount, 5);
  assert.equal(settings.normalize({ workerCount: 6 }).workerCount, 1);
  assert.equal(settings.normalize({ scheduling: 'parallel', speed: 'turbo' }).scheduling, 'serial');
  assert.deepEqual(plain(settings.normalize([])), plain(settings.defaults()));
});

test('shared appearance validation preserves supported settings and rejects invalid opacity', () => {
  const source = { theme: 'dark', density: 'compact', opacity: .76, blur: 'none', accent: 'blue', launcherSize: 'large' };
  assert.deepEqual(plain(settings.normalizeAppearance(source)), source);
  assert.equal(settings.normalizeAppearance({ opacity: null }).opacity, .88);
  assert.equal(settings.normalizeAppearance({ opacity: .3 }).opacity, .55);
  assert.equal(settings.normalizeAppearance({ opacity: 9 }).opacity, 1);
  assert.equal(settings.normalizeAppearance({ theme: 'bogus' }, { theme: 'light' }).theme, 'light');
});
