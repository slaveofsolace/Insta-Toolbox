import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const harness = await readFile(new URL('../scripts/overlay-qa.mjs', import.meta.url), 'utf8');
const runner = await readFile(new URL('../scripts/run-overlay-qa.mjs', import.meta.url), 'utf8');
const helperStart = harness.indexOf('function withTimeout(');
const helperEnd = harness.indexOf('\nfunction listen(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'bootstrap helpers are present');

function bootstrapHarness() {
  let now = 0;
  let nextTimer = 0;
  let resolveLoad;
  let rejectLoad;
  const timers = new Map();
  const logs = [];
  const webContents = new EventEmitter();
  const load = new Promise((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject; });
  const browserWindow = {
    webContents,
    loadURL() {
      webContents.emit('did-start-loading');
      return load;
    },
  };
  const context = vm.createContext({
    Date: { now: () => now },
    bootstrapTimeoutMs: 30_000,
    report: (message) => logs.push(message),
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, deadline: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(`${harness.slice(helperStart, helperEnd)}\nthis.bootstrap = bootstrapFixture;`, context);
  return {
    browserWindow,
    logs,
    timers,
    resolveLoad,
    rejectLoad,
    start: () => context.bootstrap(browserWindow, 'http://127.0.0.1:1234/fixture.html'),
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.deadline <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    assertClean() {
      assert.equal(timers.size, 0, 'deadline timer is released');
      assert.equal(webContents.eventNames().length, 0, 'startup listeners are released');
    },
  };
}

test('overlay bootstrap permits a cold start longer than five seconds within a finite deadline', async () => {
  const fixture = bootstrapHarness();
  const result = fixture.start();
  fixture.advance(6_000);
  fixture.browserWindow.webContents.emit('dom-ready');
  fixture.advance(14_000);
  fixture.browserWindow.webContents.emit('did-finish-load');
  fixture.resolveLoad();
  await result;
  assert.match(fixture.logs.join('\n'), /deadline 30000ms/);
  assert.match(fixture.logs.join('\n'), /\+6000ms DOM ready/);
  assert.match(fixture.logs.join('\n'), /\+20000ms complete/);
  fixture.assertClean();
});

test('overlay bootstrap remains bounded and preserves timeout diagnostics', async () => {
  const fixture = bootstrapHarness();
  const result = fixture.start();
  const rejected = assert.rejects(result, /first fixture load timed out after 30000ms/);
  fixture.advance(30_000);
  await rejected;
  assert.match(fixture.logs.join('\n'), /BOOTSTRAP \+30000ms failed:/);
  fixture.assertClean();
});

test('overlay bootstrap immediately reports main-frame load failure instead of waiting for its deadline', async () => {
  const fixture = bootstrapHarness();
  const result = fixture.start();
  const rejected = assert.rejects(result, /load failed -102: ERR_CONNECTION_REFUSED/);
  fixture.browserWindow.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', '', true);
  await rejected;
  assert.match(fixture.logs.join('\n'), /failed: Overlay fixture load failed -102/);
  fixture.assertClean();
});

test('overlay bootstrap reports renderer crashes and cleans its listeners', async () => {
  const fixture = bootstrapHarness();
  const result = fixture.start();
  const rejected = assert.rejects(result, /renderer exited: crashed \(7\)/);
  fixture.browserWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 7 });
  await rejected;
  assert.match(fixture.logs.join('\n'), /failed: Overlay fixture renderer exited: crashed/);
  fixture.assertClean();
});

test('overlay bootstrap handles a rejected load and a completion/failure race without retained listeners', async () => {
  const rejectedFixture = bootstrapHarness();
  const rejected = assert.rejects(rejectedFixture.start(), /load rejected/);
  rejectedFixture.rejectLoad(new Error('load rejected'));
  await rejected;
  rejectedFixture.assertClean();

  const fixture = bootstrapHarness();
  const result = fixture.start();
  const crashed = assert.rejects(result, /renderer exited: crashed \(7\)/);
  fixture.browserWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 7 });
  fixture.resolveLoad();
  await crashed;
  fixture.assertClean();
});

test('overlay bootstrap ignores subframe failures but retains startup and outer watchdog limits', async () => {
  const fixture = bootstrapHarness();
  const result = fixture.start();
  fixture.browserWindow.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', '', false);
  fixture.resolveLoad();
  await result;
  fixture.assertClean();
  assert.match(harness, /const bootstrapTimeoutMs = 30_000;/);
  assert.match(harness, /await bootstrapFixture\(browserWindow, scenarioUrl\(baseUrl, overlayQaScenarios\[0\]\)\)/);
  assert.match(harness, /report\(`FAIL \$\{error\?\.stack \|\| error\}`\)/);
  assert.match(harness, /readiness timed out after 15 seconds/);
  assert.match(runner, /const childWatchdogMs = 5 \* 60 \* 1000;/);
});
