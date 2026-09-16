import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), '..');
const results = path.join(root, 'test-results', 'background-acceptance');
const timeout = (promise, label, ms = 25_000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  })]).finally(() => clearTimeout(timer));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (typeof electron === 'string') {
  await mkdir(results, { recursive: true });
  const userData = path.join(results, 'profiles', String(process.pid));
  await mkdir(userData, { recursive: true });
  const childEnvironment = { ...process.env, INSTA_TOOLBOX_BACKGROUND_PROFILE: userData };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [filename], {
    cwd: root, windowsHide: true, stdio: 'inherit',
    env: childEnvironment,
  });
  console.log(`Background acceptance Electron PID ${child.pid}`);
  const watchdog = setTimeout(() => child.kill(), 180_000);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal) reject(new Error(`Background acceptance terminated: ${signal}`));
        else resolve(code ?? 1);
      });
    });
  } finally { clearTimeout(watchdog); }
} else {
  // Do not await readiness from the ESM entrypoint: Electron waits for module
  // evaluation before emitting ready.
  void (async () => {
  console.log(`Background acceptance main started (PID ${process.pid})`);
  const { app, BrowserWindow, session } = electron;
  const userData = path.resolve(process.env.INSTA_TOOLBOX_BACKGROUND_PROFILE || path.join(results, 'profiles', String(process.pid)));
  assert.ok(userData.startsWith(`${results}${path.sep}`), 'profile stays inside task output');
  app.setPath('userData', userData);
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  const windows = new Set();
  let server;
  const evidence = {
    schemaVersion: 1, capturedAt: new Date().toISOString(),
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform },
    restrictions: { localOnly: true, backgroundThrottling: true, offscreen: false, liveInstagram: false },
    cases: [], success: false,
  };
  const totalWatchdog = setTimeout(() => {
    console.error('Background acceptance process watchdog expired');
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    app.exit(1);
  }, 165_000);
  try {
    await mkdir(results, { recursive: true });
    const engine = await readFile(path.join(root, 'extension', 'action-labels.js'));
    evidence.engineSha256 = createHash('sha256').update(engine).digest('hex');
    const fixture = await readFile(path.join(root, 'tests', 'fixtures', 'background-dm.html'));
    const assets = new Map([
      ['/direct/t/background-fixture/', ['text/html; charset=utf-8', fixture]],
      ['/extension/action-labels.js', ['text/javascript; charset=utf-8', engine]],
    ]);
    evidence.adapterSha256 = {};
    for (const name of ['inbox-coordinator.js', 'inbox-worker.js']) {
      const source = await readFile(path.join(root, 'extension', name));
      assets.set(`/extension/${name}`, ['text/javascript; charset=utf-8', source]);
      evidence.adapterSha256[name] = createHash('sha256').update(source).digest('hex');
    }
    server = createServer((request, response) => {
      const host = String(request.headers.host || '').split(':')[0];
      const asset = assets.get(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      if (host !== '127.0.0.1' || !asset || request.method !== 'GET') {
        response.writeHead(404).end(); return;
      }
      response.writeHead(200, {
        'Content-Type': asset[0], 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'",
      });
      response.end(asset[1]);
    });
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    await timeout(app.whenReady(), 'Electron readiness', 15_000);

    async function runCase(name, options, interrupt = null) {
      const partition = `background-acceptance-${process.pid}-${name}`;
      const isolatedSession = session.fromPartition(partition);
      isolatedSession.setPermissionCheckHandler(() => false);
      isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolatedSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !details.url.startsWith(`http://127.0.0.1:${port}/`) });
      });
      const window = new BrowserWindow({
        show: false, paintWhenInitiallyHidden: false, width: 900, height: 700,
        webPreferences: {
          partition, contextIsolation: true, sandbox: true, nodeIntegration: false,
          backgroundThrottling: true, offscreen: false, webSecurity: true,
        },
      });
      windows.add(window);
      const errors = [];
      let windowFocuses = 0;
      window.on('focus', () => { windowFocuses += 1; });
      window.webContents.on('console-message', (event) => {
        if (event.level === 'error' || Number(event.level) >= 3) errors.push(event.message);
      });
      const evaluate = (expression) => timeout(window.webContents.executeJavaScript(expression, false), `${name} evaluation`, 5_000);
      const waitFor = async (expression, label, ms = 25_000) => {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          const value = await evaluate(expression);
          if (value) return value;
          await sleep(100);
        }
        throw new Error(`${name}: ${label} timed out`);
      };
      try {
        await timeout(window.loadURL(`http://127.0.0.1:${port}/direct/t/background-fixture/`), `${name} load`);
        const initial = await evaluate('({state:document.visibilityState,focused:document.hasFocus()})');
        assert.equal(initial.state, 'hidden', `${name}: actual renderer must be hidden`);
        assert.equal(initial.focused, false);
        assert.equal(window.isVisible(), false);
        assert.equal(window.isFocused(), false);
        const startedAt = Date.now();
        await evaluate(`backgroundFixture.start(${JSON.stringify(options)})`);
        if (interrupt) await interrupt({ window, evaluate, waitFor });
        const result = await waitFor('backgroundFixture.result && backgroundFixture.snapshot()', 'runner completion');
        const record = { name, durationMs: Date.now() - startedAt, ...result, windowFocuses, errors };
        evidence.cases.push(record);
        assert.equal(result.maxInFlight <= 1, true, `${name}: serialized mutations`);
        assert.equal(result.focusEvents, 0, `${name}: no renderer focus`);
        assert.equal(windowFocuses, 0, `${name}: no native focus`);
        assert.equal(window.isVisible(), false);
        assert.equal(window.isFocused(), false);
        assert.ok(result.visibilitySamples.every((sample) => sample.state === 'hidden' && !sample.focused));
        assert.equal(result.remainingReceived, 3);
        assert.deepEqual(errors, []);
        await writeFile(path.join(results, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
        console.log(`${name}: ${result.result.status}, ${result.result.processed} verified, ${result.dispatches} dispatched, ${record.durationMs}ms`);
        return record;
      } finally {
        if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
        window.destroy(); windows.delete(window);
      }
    }

    for (const speed of ['standard']) {
      const result = await runCase(`hidden-${speed}`, { speed });
      assert.equal(result.result.status, 'completed');
      assert.equal(result.result.processed, 3);
      assert.equal(result.dispatches, 3);
      assert.equal(result.ledger.length, 3);
    }
    const stopped = await runCase('hidden-stop', { speed: 'standard', stopAfter: 1 });
    assert.equal(stopped.result.status, 'stopped');
    assert.equal(stopped.result.processed, 1);
    assert.equal(stopped.dispatches, 1);
    const expired = await runCase('hidden-expiry', { speed: 'standard', ttlMs: 1_500 });
    assert.equal(expired.result.status, 'error');
    assert.match(expired.result.message, /expired/);
    assert.ok(expired.dispatches < 3);
    assert.ok(expired.dispatchTimes.every((at) => at < expired.expiresAt));

    const freezeAndResume = (afterDispatch = false) => async ({ window, evaluate, waitFor }) => {
      if (afterDispatch) await waitFor('backgroundFixture.dispatches === 1', 'first dispatch');
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
      await sleep(300);
      await window.webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' });
      await waitFor('backgroundFixture.result', 'interrupted settlement');
      const replay = await evaluate(`(async () => {
        const before = backgroundFixture.dispatches;
        const result = await InstaToolboxDmThreadUnsender.start({plan:backgroundFixture.plan});
        return {before,after:backgroundFixture.dispatches,reason:result.message};
      })()`);
      assert.equal(replay.before, replay.after);
      assert.match(replay.reason, /already used/);
    };
    const frozen = await runCase('actual-page-freeze', { speed: 'standard' }, freezeAndResume());
    assert.ok(frozen.freezeEvents >= 1, 'native browser freeze event observed');
    assert.ok(frozen.resumeEvents >= 1, 'native browser resume event observed');
    assert.equal(frozen.result.status, 'needs-attention');
    assert.equal(frozen.result.interruptionReason, 'page-frozen');
    assert.equal(frozen.dispatches, 0);
    const settled = await runCase('freeze-after-dispatch-verified', { speed: 'standard' }, freezeAndResume(true));
    assert.equal(settled.result.status, 'needs-attention');
    assert.equal(settled.result.processed, 1);
    assert.equal(settled.result.uncertain, 0);
    assert.equal(settled.dispatches, 1);
    assert.equal(settled.ledger.length, 1);
    assert.ok(settled.freezeEvents >= 1 && settled.resumeEvents >= 1);
    const uncertain = await runCase('freeze-after-dispatch-uncertain', { speed: 'standard', mutationDelayMs: 60_000 }, freezeAndResume(true));
    assert.equal(uncertain.result.status, 'needs-attention');
    assert.equal(uncertain.result.processed, 0);
    assert.equal(uncertain.result.uncertain, 1);
    assert.equal(uncertain.dispatches, 1);
    assert.equal(uncertain.ledger.length, 0);
    assert.ok(uncertain.freezeEvents >= 1 && uncertain.resumeEvents >= 1);
    const worker = await runCase('hidden-reviewed-worker', { speed: 'standard', worker: true });
    assert.equal(worker.result.status, 'completed');
    assert.equal(worker.result.processed, 3);
    assert.equal(worker.dispatches, 3);
    assert.equal(worker.workerCheckpoint.tasks[0].messageRemovals, 3);
    assert.equal(worker.workerCheckpoint.pendingMutation, null);
    assert.ok(worker.workerCheckpointCount >= 6);
    evidence.success = true;
    await writeFile(path.join(results, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Background acceptance passed (${evidence.cases.length} cases). Evidence: ${path.join(results, 'evidence.json')}`);
  } catch (error) {
    evidence.error = error.stack || String(error);
    await writeFile(path.join(results, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`).catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(totalWatchdog);
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    app.exit(process.exitCode || 0);
  }
  })();
}
