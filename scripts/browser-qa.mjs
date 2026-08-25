import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import { createAppServer } from './serve.mjs';

const mode = process.argv.includes('--update')
  ? 'update'
  : process.argv.includes('--check')
    ? 'check'
    : '';

if (!mode) {
  throw new Error('Choose exactly one browser QA mode: --update or --check.');
}
if (process.argv.includes('--update') && process.argv.includes('--check')) {
  throw new Error('Browser QA cannot update and check baselines in the same run.');
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.join(repositoryRoot, 'test-results', 'browser-qa');
const actualRoot = path.join(resultsRoot, process.platform);
const baselineVariant = String(
  process.env.INSTA_TOOLBOX_BROWSER_QA_BASELINE_VARIANT || '',
).trim();
if (baselineVariant && !/^[a-z0-9](?:[a-z0-9_-]{0,62})$/i.test(baselineVariant)) {
  throw new Error('Browser QA baseline variant must contain only letters, numbers, dashes, and underscores.');
}
const userDataRoot = path.resolve(
  process.env.INSTA_TOOLBOX_BROWSER_QA_USER_DATA
    || path.join(resultsRoot, 'user-data', String(process.pid)),
);
const platformBaselineRoot = path.join(repositoryRoot, 'tests', 'baselines', 'pwa', process.platform);
const baselineRoot = baselineVariant
  ? path.join(platformBaselineRoot, baselineVariant)
  : platformBaselineRoot;
const manifestPath = path.join(baselineRoot, 'manifest.json');
const runnerLogPath = path.join(resultsRoot, 'runner.log');

if (!userDataRoot.startsWith(`${path.resolve(resultsRoot)}${path.sep}`)) {
  throw new Error('Browser QA user data must stay inside test-results/browser-qa.');
}

const deviceScaleFactor = 1;
const viewports = [
  { id: 'desktop', width: 1134, height: 700 },
  { id: 'tablet', width: 820, height: 900 },
  { id: 'mobile', width: 390, height: 844 },
];
const views = [
  ['overview', 'Overview'],
  ['relationships', 'Relationships'],
  ['queue', 'Action Queue'],
  ['messages', 'Messages'],
  ['imports', 'Import / Export'],
  ['settings', 'Settings'],
  ['activity', 'Activity'],
];
const screenshotViews = new Set(['overview', 'messages', 'settings']);

mkdirSync(userDataRoot, { recursive: true });
writeFileSync(runnerLogPath, '', 'utf8');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', String(deviceScaleFactor));
app.setPath('userData', userDataRoot);
app.on('window-all-closed', () => {});

function report(message) {
  const line = String(message);
  console.log(line);
  appendFileSync(runnerLogPath, `${line}\n`, 'utf8');
}

function withTimeout(promise, label, timeout = 15_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms.`)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readProductEvidenceMetadata() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const productVersion = String(packageJson.version || '').trim();
  assert.match(productVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'package version is invalid');

  const changelog = await readFile(path.join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
  const releaseHeading = new RegExp(
    `^## ${escapeRegExp(productVersion)} - (\\d{4}-\\d{2}-\\d{2})(?: \\([^\\r\\n]+\\))?$`,
    'm',
  );
  const releaseDate = changelog.match(releaseHeading)?.[1] || '';
  assert.match(releaseDate, /^\d{4}-\d{2}-\d{2}$/, `CHANGELOG release date is missing for ${productVersion}`);

  return {
    productVersion,
    captureTimestamp: `${releaseDate}T00:00:00.000Z`,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForHeading(webContents, expectedHeading) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const heading = await webContents.executeJavaScript(
      "document.querySelector('[data-page-heading]')?.textContent || ''",
      true,
    );
    if (heading === expectedHeading) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for the ${expectedHeading} view.`);
}

async function waitForPaint(webContents, label) {
  await withTimeout(webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true,
  ), `${label}: animation frames`, 5_000);
  await withTimeout(new Promise((resolve) => {
    webContents.once('paint', resolve);
    webContents.invalidate();
  }), `${label}: fresh paint`, 5_000);
}

function recordConsoleProblem(problems, detailsOrLevel, legacyMessage) {
  const details = typeof detailsOrLevel === 'object' && detailsOrLevel !== null
    ? detailsOrLevel
    : { level: detailsOrLevel, message: legacyMessage };
  const level = details.level;
  if (level === 'warning' || level === 'error' || Number(level) >= 2) {
    problems.push(`${String(level)}: ${details.message || ''}`);
  }
}

async function waitForDialogState(webContents, expectedOpen, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const open = await webContents.executeJavaScript(
      `Boolean(document.querySelector('[data-role="action-confirmation"]')?.open)`,
      true,
    );
    if (open === expectedOpen) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`${label}: confirmation dialog did not become ${expectedOpen ? 'open' : 'closed'}.`);
}

async function readWorkspace(webContents) {
  return webContents.executeJavaScript(`(async () => {
    const { loadState } = await import('./src/core/storage.js');
    return JSON.stringify(await loadState());
  })()`, true);
}

async function seedWorkspace(webContents, marker) {
  return webContents.executeJavaScript(`(async () => {
    const { loadState, saveState } = await import('./src/core/storage.js');
    const state = await loadState();
    state.settings.waitingDays = 13;
    state.activity = [{
      id: ${JSON.stringify(marker)},
      timestamp: '2026-01-01T00:00:00.000Z',
      kind: 'browser-qa',
      message: 'Confirmation cancellation sentinel.',
      details: { marker: ${JSON.stringify(marker)} },
    }, ...state.activity.filter((entry) => entry.id !== ${JSON.stringify(marker)})];
    await saveState(state);
    return JSON.stringify(await loadState());
  })()`, true);
}

async function inspectConfirmationAccessibility(webContents) {
  const client = webContents.debugger;
  const attachedHere = !client.isAttached();
  if (attachedHere) client.attach('1.3');
  try {
    await client.sendCommand('Accessibility.enable');
    const tree = await client.sendCommand('Accessibility.getFullAXTree');
    const nodes = tree.nodes || [];
    const dialog = nodes.find((node) => (
      node.role?.value === 'dialog'
      && node.name?.value === 'Clear local workspace?'
      && node.ignored !== true
    ));
    const buttonNames = nodes
      .filter((node) => node.role?.value === 'button' && node.ignored !== true)
      .map((node) => node.name?.value)
      .filter(Boolean);
    return { dialogFound: Boolean(dialog), buttonNames };
  } finally {
    if (attachedHere && client.isAttached()) client.detach();
  }
}

async function captureClearWorkspaceConfirmation(browserWindow, viewport, {
  id,
  zoomFactor,
  captureImage,
}) {
  const { webContents } = browserWindow;
  webContents.setZoomFactor(zoomFactor);
  await waitForPaint(webContents, `${id}: zoom`);
  assert.equal(webContents.getZoomFactor(), zoomFactor, `${id}: Chromium zoom factor mismatch`);

  const marker = `browser-qa-${id}`;
  const beforeWorkspace = await seedWorkspace(webContents, marker);
  const settingsSelector = '[data-action="navigate"][data-view="settings"]';
  await webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(settingsSelector)}).click()`,
    true,
  );
  await waitForHeading(webContents, 'Settings');
  await webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('[data-action="reset-workspace"]');
    trigger.focus();
    trigger.click();
  })()`, true);
  await waitForDialogState(webContents, true, id);
  await waitForPaint(webContents, `${id}: dialog open`);

  const metrics = await webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('[data-role="action-confirmation"]');
    const cancel = dialog?.querySelector('[data-confirmation-decision="cancel"]');
    const confirm = dialog?.querySelector('[data-confirmation-decision="confirm"]');
    const title = document.getElementById(dialog?.getAttribute('aria-labelledby') || '');
    const describedIds = (dialog?.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
    const rect = (element) => {
      const bounds = element?.getBoundingClientRect();
      return bounds ? {
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
      } : null;
    };
    return {
      innerWidth,
      innerHeight,
      dialogTag: dialog?.tagName || '',
      dialogOpen: dialog?.open === true,
      dialogModal: dialog?.matches(':modal') === true,
      dialogName: title?.textContent?.trim() || '',
      describedIds,
      describedText: describedIds.map((id) => document.getElementById(id)?.textContent?.trim() || ''),
      cancelName: cancel?.textContent?.trim() || '',
      confirmName: confirm?.textContent?.trim() || '',
      cancelType: cancel?.getAttribute('type') || '',
      confirmType: confirm?.getAttribute('type') || '',
      cancelFocused: document.activeElement === cancel,
      dialog: rect(dialog),
      cancel: rect(cancel),
      confirm: rect(confirm),
    };
  })()`, true);

  assert.equal(metrics.dialogTag, 'DIALOG', `${id}: semantic dialog element is missing`);
  assert.equal(metrics.dialogOpen, true, `${id}: dialog is not open`);
  assert.equal(metrics.dialogModal, true, `${id}: dialog is not modal`);
  assert.equal(metrics.dialogName, 'Clear local workspace?', `${id}: accessible dialog name mismatch`);
  assert.deepEqual(
    metrics.describedIds,
    ['action-confirmation-message', 'action-confirmation-facts'],
    `${id}: dialog description references changed`,
  );
  assert.equal(metrics.describedText.every(Boolean), true, `${id}: dialog description is empty`);
  assert.equal(metrics.cancelName, 'Cancel', `${id}: Cancel button name mismatch`);
  assert.equal(metrics.confirmName, 'Clear local data', `${id}: confirm button name mismatch`);
  assert.equal(metrics.cancelType, 'button', `${id}: Cancel must not submit a form`);
  assert.equal(metrics.confirmType, 'button', `${id}: confirm must not submit a form`);
  assert.equal(metrics.cancelFocused, true, `${id}: Cancel was not initially focused`);
  assert.ok(metrics.dialog.top >= -1, `${id}: dialog starts above the viewport`);
  assert.ok(metrics.dialog.left >= -1, `${id}: dialog starts left of the viewport`);
  assert.ok(metrics.dialog.right <= metrics.innerWidth + 1, `${id}: dialog exceeds viewport width`);
  assert.ok(metrics.dialog.bottom <= metrics.innerHeight + 1, `${id}: dialog exceeds viewport height`);
  for (const [name, bounds] of [['Cancel', metrics.cancel], ['Confirm', metrics.confirm]]) {
    assert.ok(bounds.width >= 44, `${id}: ${name} is narrower than 44px`);
    assert.ok(bounds.height >= 44, `${id}: ${name} is shorter than 44px`);
  }
  assert.equal(
    metrics.cancel.top < metrics.confirm.top
      || (Math.abs(metrics.cancel.top - metrics.confirm.top) <= 1 && metrics.cancel.left < metrics.confirm.left),
    true,
    `${id}: Cancel must precede the destructive button visually`,
  );

  const accessibility = await inspectConfirmationAccessibility(webContents);
  assert.equal(accessibility.dialogFound, true, `${id}: accessibility tree has no named dialog`);
  assert.ok(accessibility.buttonNames.includes('Cancel'), `${id}: accessibility tree has no Cancel button`);
  assert.ok(
    accessibility.buttonNames.includes('Clear local data'),
    `${id}: accessibility tree has no named destructive button`,
  );

  const captures = [];
  if (captureImage) {
    const image = await webContents.capturePage();
    const png = image.toPNG();
    const file = `${id}.png`;
    await mkdir(actualRoot, { recursive: true });
    await writeFile(path.join(actualRoot, file), png);
    captures.push({
      file,
      viewport: viewport.id,
      width: viewport.width,
      height: viewport.height,
      view: 'settings',
      state: 'clear-workspace-confirmation',
      zoomFactor,
      cssWidth: metrics.innerWidth,
      cssHeight: metrics.innerHeight,
      sha256: sha256(png),
    });
  }

  await webContents.executeJavaScript(
    `document.querySelector('[data-confirmation-decision="cancel"]').click()`,
    true,
  );
  await waitForDialogState(webContents, false, id);
  const afterWorkspace = await readWorkspace(webContents);
  const cancellation = await webContents.executeJavaScript(`(() => ({
    heading: document.querySelector('[data-page-heading]')?.textContent || '',
    resetFocused: document.activeElement?.matches('[data-action="reset-workspace"]') === true,
  }))()`, true);
  assert.equal(afterWorkspace, beforeWorkspace, `${id}: cancel changed the local workspace`);
  assert.equal(cancellation.heading, 'Settings', `${id}: cancel left the Settings view`);
  assert.equal(cancellation.resetFocused, true, `${id}: cancel did not restore trigger focus`);
  return captures;
}

async function inspectView(webContents, viewId, expectedHeading, viewport) {
  const selector = `[data-action="navigate"][data-view="${viewId}"]`;
  const found = await webContents.executeJavaScript(
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    true,
  );
  assert.equal(found, true, `${viewId}: navigation control is missing`);
  await webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
    true,
  );
  await waitForHeading(webContents, expectedHeading);
  await waitForPaint(webContents, `${viewport.id}/${viewId} navigation`);

  const metrics = await webContents.executeJavaScript(`(() => {
    const heading = document.querySelector('[data-page-heading]');
    const active = document.querySelector('[data-action="navigate"].active');
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    const bounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        display: getComputedStyle(element).display,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    };
    return {
      heading: heading?.textContent || '',
      activeView: active?.dataset.view || '',
      headingFocused: document.activeElement === heading,
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      sidebar: bounds(sidebar),
      main: bounds(main),
      malformedClosingTag: /<\\s*\\/\\s*section\\s*>/i.test(document.body.textContent || ''),
      liveActionEnabled: document.querySelector('#live-action-enabled')?.checked ?? null,
      liveDmEnabled: document.querySelector('#live-dm-enabled')?.checked ?? null,
    };
  })()`, true);

  assert.equal(metrics.heading, expectedHeading, `${viewId}: heading mismatch`);
  assert.equal(metrics.activeView, viewId, `${viewId}: active navigation mismatch`);
  assert.equal(metrics.headingFocused, true, `${viewId}: focus did not move to the page heading`);
  assert.ok(
    metrics.documentWidth <= metrics.innerWidth + 1,
    `${viewId}: document overflows ${metrics.documentWidth}px into a ${metrics.innerWidth}px viewport`,
  );
  assert.ok(
    metrics.bodyWidth <= metrics.innerWidth + 1,
    `${viewId}: body overflows ${metrics.bodyWidth}px into a ${metrics.innerWidth}px viewport`,
  );
  for (const [name, bounds] of [['sidebar', metrics.sidebar], ['main', metrics.main]]) {
    assert.ok(bounds, `${viewId}: ${name} is missing`);
    assert.notEqual(bounds.display, 'none', `${viewId}: ${name} is hidden`);
    assert.ok(bounds.width > 0, `${viewId}: ${name} has no width`);
    assert.ok(bounds.left >= -1, `${viewId}: ${name} starts outside the viewport`);
    assert.ok(
      bounds.right <= viewport.width + 1,
      `${viewId}: ${name} extends beyond the ${viewport.width}px viewport`,
    );
  }
  assert.equal(metrics.malformedClosingTag, false, `${viewId}: malformed closing tag is visible`);
  if (viewId === 'settings') {
    assert.equal(metrics.liveActionEnabled, null, 'settings: global live account toggle must not exist');
    assert.equal(metrics.liveDmEnabled, null, 'settings: global live DM toggle must not exist');
  }
}

async function captureViewport(baseUrl, viewport) {
  const partition = `insta-toolbox-browser-qa-${process.pid}-${viewport.id}`;
  const qaSession = session.fromPartition(partition);
  qaSession.setPermissionCheckHandler(() => false);
  qaSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const browserWindow = new BrowserWindow({
    show: false,
    frame: false,
    useContentSize: true,
    width: viewport.width,
    height: viewport.height,
    backgroundColor: '#f5f5f2',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true,
      webSecurity: true,
      partition,
    },
  });
  const problems = [];
  browserWindow.webContents.on('console-message', (event) => {
    recordConsoleProblem(problems, event);
  });
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    problems.push(`renderer gone: ${details.reason}`);
  });
  browserWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame !== false) problems.push(`load failed ${code}: ${description} (${url})`);
  });

  const captures = [];
  try {
    await withTimeout(browserWindow.loadURL(baseUrl), `${viewport.id}: page load`);
    await waitForHeading(browserWindow.webContents, 'Overview');
    await browserWindow.webContents.executeJavaScript(`(() => {
      const style = document.createElement('style');
      style.dataset.browserQa = 'true';
      style.textContent = '*,'
        + '*::before,'
        + '*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
        + 'html{scroll-behavior:auto!important}';
      document.head.append(style);
      return document.fonts?.ready || true;
    })()`, true);

    for (const [viewId, expectedHeading] of views) {
      await inspectView(browserWindow.webContents, viewId, expectedHeading, viewport);
      if (!screenshotViews.has(viewId)) continue;
      await browserWindow.webContents.executeJavaScript('window.scrollTo(0, 0)', true);
      await waitForPaint(browserWindow.webContents, `${viewport.id}/${viewId}`);
      const image = await browserWindow.webContents.capturePage();
      const png = image.toPNG();
      const file = `${viewport.id}-${viewId}.png`;
      await mkdir(actualRoot, { recursive: true });
      await writeFile(path.join(actualRoot, file), png);
      captures.push({
        file,
        viewport: viewport.id,
        width: viewport.width,
        height: viewport.height,
        view: viewId,
        sha256: sha256(png),
      });
    }

    if (viewport.id === 'desktop') {
      captures.push(...await captureClearWorkspaceConfirmation(browserWindow, viewport, {
        id: 'zoom-200-settings-clear-confirmation',
        zoomFactor: 2,
        captureImage: !baselineVariant,
      }));
    }
    if (viewport.id === 'mobile') {
      captures.push(...await captureClearWorkspaceConfirmation(browserWindow, viewport, {
        id: 'mobile-settings-clear-confirmation',
        zoomFactor: 1,
        captureImage: !baselineVariant,
      }));
    }

    assert.deepEqual(problems, [], `${viewport.id}: browser console or renderer problems`);
    return captures;
  } finally {
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
    await withTimeout(qaSession.clearStorageData(), `${viewport.id}: storage cleanup`, 5_000);
    await withTimeout(qaSession.clearCache(), `${viewport.id}: cache cleanup`, 5_000);
  }
}

async function updateBaselines(captures, manifest) {
  await mkdir(baselineRoot, { recursive: true });
  for (const capture of captures) {
    const png = await readFile(path.join(actualRoot, capture.file));
    await writeFile(path.join(baselineRoot, capture.file), png);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function writeActualManifest(manifest) {
  await mkdir(actualRoot, { recursive: true });
  await writeFile(
    path.join(actualRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

async function checkBaselines(captures, manifest) {
  let expected;
  try {
    expected = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    const baselineLabel = baselineVariant
      ? `${process.platform}/${baselineVariant}`
      : process.platform;
    throw new Error(
      `No readable ${baselineLabel} browser baseline manifest. Review the captured evidence before updating it.`,
      { cause: error },
    );
  }
  assert.equal(expected.schemaVersion, manifest.schemaVersion, 'baseline schema changed');
  assert.equal(expected.kind, manifest.kind, 'baseline kind changed');
  assert.equal(expected.productVersion, manifest.productVersion, 'baseline product version changed');
  assert.equal(expected.captureTimestamp, manifest.captureTimestamp, 'baseline capture timestamp changed');
  assert.equal(expected.platform, manifest.platform, 'baseline platform changed');
  assert.equal(expected.electron, manifest.electron, 'baseline Electron version changed');
  assert.equal(expected.deviceScaleFactor, manifest.deviceScaleFactor, 'baseline scale changed');
  assert.equal(expected.variant || '', manifest.variant || '', 'baseline renderer variant changed');
  assert.deepEqual(expected.viewports, manifest.viewports, 'baseline viewport contract changed');
  assert.deepEqual(
    expected.captures.map(({ file, viewport, width, height, view, state, zoomFactor, cssWidth, cssHeight }) => ({
      file, viewport, width, height, view, state, zoomFactor, cssWidth, cssHeight,
    })),
    manifest.captures.map(({ file, viewport, width, height, view, state, zoomFactor, cssWidth, cssHeight }) => ({
      file, viewport, width, height, view, state, zoomFactor, cssWidth, cssHeight,
    })),
    'baseline capture contract changed',
  );

  for (const capture of captures) {
    const expectedCapture = expected.captures.find(({ file }) => file === capture.file);
    assert.ok(expectedCapture, `${capture.file}: missing from baseline manifest`);
    const baseline = await readFile(path.join(baselineRoot, capture.file));
    assert.equal(sha256(baseline), expectedCapture.sha256, `${capture.file}: baseline hash is corrupt`);
    assert.equal(capture.sha256, expectedCapture.sha256, `${capture.file}: screenshot regression detected`);
  }
}

async function runBrowserQa() {
  const server = createAppServer();
  let exitCode = 0;
  try {
  report('Electron is ready.');
    await rm(actualRoot, { recursive: true, force: true });
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    const captures = [];
    for (const viewport of viewports) {
      report(`Checking ${viewport.id} at ${viewport.width}x${viewport.height}.`);
      captures.push(...await captureViewport(baseUrl, viewport));
    }
    const evidenceMetadata = await readProductEvidenceMetadata();
    const manifest = {
      schemaVersion: 2,
      kind: 'insta-toolbox-pwa-screenshot-baseline',
      ...evidenceMetadata,
      platform: process.platform,
      electron: process.versions.electron,
      deviceScaleFactor,
      viewports,
      captures,
    };
    if (baselineVariant) manifest.variant = baselineVariant;
    await writeActualManifest(manifest);
    if (mode === 'update') {
      await updateBaselines(captures, manifest);
      report(`Updated ${captures.length} ${process.platform} PWA screenshot baselines.`);
    } else {
      await checkBaselines(captures, manifest);
      report(`Verified ${captures.length} ${process.platform} PWA screenshot baselines.`);
    }
  } catch (error) {
    exitCode = 1;
    report(error?.stack || error);
    console.error(error);
  } finally {
    await close(server);
    app.exit(exitCode);
  }
}

report(`Starting ${mode} browser QA with Electron ${process.versions.electron}.`);
const readinessTimer = setTimeout(() => {
  report('Error: Electron readiness timed out after 15000ms.');
  app.exit(1);
}, 15_000);
app.whenReady().then(() => {
  clearTimeout(readinessTimer);
  return runBrowserQa();
});
