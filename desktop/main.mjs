import {
  app,
  BrowserWindow,
  dialog,
  protocol,
  shell,
} from 'electron';
import { mkdtempSync, realpathSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { loadWithRecovery, withTimeout } from './startup-recovery.mjs';

const SCHEME = 'insta-aio';
const HOST = 'app';
const APP_URL = `${SCHEME}://${HOST}/`;
const PRODUCT_DATA_DIRECTORY = 'Insta AIO Tool';
const BACKUP_DIRECTORY = 'Insta AIO Tool Backups';
const BACKUP_RETENTION = 5;
const MAX_DESKTOP_LOAD_ATTEMPTS = 3;
const DESKTOP_LOAD_TIMEOUT_MS = 15_000;
const WINDOW_REVEAL_DELAY_MS = 1_000;
const DESKTOP_SMOKE_TEST = process.argv.includes('--smoke-test')
  || process.env.INSTA_AIO_DESKTOP_SMOKE_TEST === '1';
const BACKUP_PATHS = [
  'IndexedDB',
  'Local Storage',
  'Session Storage',
  'databases',
];

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    serviceWorkers: true,
  },
}]);

function createDesktopSmokeDataRoot() {
  const temporaryRoot = realpathSync.native(path.resolve(app.getPath('temp')));
  const configuredParent = realpathSync.native(path.resolve(
    process.env.INSTA_AIO_DESKTOP_SMOKE_PARENT || '',
  ));
  const relativeParent = path.relative(temporaryRoot, configuredParent);
  if (
    !relativeParent
    || relativeParent === '..'
    || relativeParent.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeParent)
    || path.basename(configuredParent) !== 'insta-aio-desktop-smoke-parent'
  ) {
    throw new Error('Desktop smoke mode requires a confined disposable parent directory.');
  }
  return mkdtempSync(path.join(configuredParent, 'insta-aio-desktop-smoke-'));
}

function resolveAppDataRoot() {
  if (!DESKTOP_SMOKE_TEST) return app.getPath('appData');
  try {
    return createDesktopSmokeDataRoot();
  } catch (error) {
    console.error(`Insta Toolbox desktop smoke setup failed: ${error.message}`);
    process.exit(1);
  }
}

const appDataRoot = resolveAppDataRoot();
const userDataRoot = path.join(appDataRoot, PRODUCT_DATA_DIRECTORY);
const backupRoot = path.join(appDataRoot, BACKUP_DIRECTORY);
app.setPath('userData', userDataRoot);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jsfrag': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  }[extension] || 'application/octet-stream';
}

function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

async function assetResponse(request) {
  const url = new URL(request.url);
  if (url.hostname !== HOST || !['GET', 'HEAD'].includes(request.method)) {
    return new Response('Not found', { status: 404 });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const appRoot = path.resolve(app.getAppPath());
  const filePath = path.resolve(appRoot, relativePath);
  if (filePath !== appRoot && !filePath.startsWith(`${appRoot}${path.sep}`)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    const body = request.method === 'HEAD' ? null : await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType(filePath),
        'Content-Security-Policy': contentSecurityPolicy(),
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function timestampName(now = new Date()) {
  return `backup-${now.toISOString().replace(/[:.]/g, '-')}`;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function createStartupBackup() {
  const available = [];
  for (const relativePath of BACKUP_PATHS) {
    if (await exists(path.join(userDataRoot, relativePath))) available.push(relativePath);
  }
  if (!available.length) return null;

  await mkdir(backupRoot, { recursive: true });
  const destination = path.join(backupRoot, timestampName());
  await mkdir(destination, { recursive: false });
  for (const relativePath of available) {
    await cp(
      path.join(userDataRoot, relativePath),
      path.join(destination, relativePath),
      { recursive: true, errorOnExist: true },
    );
  }
  await writeFile(path.join(destination, 'backup.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'insta-aio-desktop-startup-backup',
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    paths: available,
  }, null, 2));

  const entries = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('backup-'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const stale of entries.slice(BACKUP_RETENTION)) {
    const target = path.resolve(backupRoot, stale);
    if (target.startsWith(`${path.resolve(backupRoot)}${path.sep}`)) {
      await rm(target, { recursive: true, force: true });
    }
  }
  return destination;
}

function allowExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'www.instagram.com';
  } catch {
    return false;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 820,
    minHeight: 620,
    show: false,
    backgroundColor: '#f2f1ed',
    icon: path.join(app.getAppPath(), 'assets', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).protocol !== `${SCHEME}:`) event.preventDefault();
  });
  if (!DESKTOP_SMOKE_TEST) {
    const reveal = () => {
      if (!window.isDestroyed() && !window.isVisible()) window.show();
    };
    const revealTimer = setTimeout(reveal, WINDOW_REVEAL_DELAY_MS);
    window.once('ready-to-show', () => {
      clearTimeout(revealTimer);
      reveal();
    });
    window.once('closed', () => clearTimeout(revealTimer));
  }
  return window;
}

async function loadProductionWindow(window) {
  return loadWithRecovery({
    attempts: MAX_DESKTOP_LOAD_ATTEMPTS,
    timeoutMs: DESKTOP_LOAD_TIMEOUT_MS,
    load: () => window.loadURL(APP_URL),
    stop: () => {
      if (!window.isDestroyed()) window.webContents.stop();
    },
    reveal: () => {
      if (!window.isDestroyed() && !window.isVisible()) window.show();
    },
    prompt: async ({ attempt, canRetry, error }) => {
      if (window.isDestroyed()) return 'close';
      console.error(`Insta Toolbox desktop load attempt ${attempt} failed: ${error.message}`);
      const result = await dialog.showMessageBox(window, {
        type: 'error',
        title: 'Insta Toolbox could not start',
        message: 'The local interface could not be loaded.',
        detail: canRetry
          ? `${error.message}\n\nYou can retry this local startup.`
          : `${error.message}\n\nThe retry limit was reached.`,
        buttons: canRetry ? ['Retry', 'Close'] : ['Close'],
        defaultId: 0,
        cancelId: canRetry ? 1 : 0,
        noLink: true,
      });
      return canRetry && result.response === 0 ? 'retry' : 'close';
    },
    close: () => {
      if (!window.isDestroyed()) window.close();
    },
  });
}

function openProductionWindow() {
  const window = createWindow();
  void loadProductionWindow(window).catch((error) => {
    console.error(`Insta Toolbox desktop recovery failed: ${error.message}`);
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  });
  return window;
}

async function runDesktopSmokeTest(window) {
  const timeoutMs = 15_000;
  const debuggerCommandTimeoutMs = 5_000;
  const hardStopTimer = setTimeout(() => {
    console.error('Insta Toolbox desktop smoke test exceeded its hard time limit.');
    app.exit(1);
  }, (timeoutMs * 2) + debuggerCommandTimeoutMs);
  let exitCode = 0;
  let loadedUrl = null;
  let renderedTitle = null;
  let rendererFailure = null;
  let overviewFound = false;
  const rendererErrors = [];
  const debuggerClient = window.webContents.debugger;
  const onConsoleMessage = (_event, details) => {
    const severity = details?.level;
    const text = details?.message || 'unknown renderer console error';
    if (severity === 'error') rendererErrors.push(text);
  };
  const onLoadFailure = (_event, code, description, url, isMainFrame) => {
    if (isMainFrame !== false) {
      rendererFailure = new Error(`Desktop smoke renderer failed ${code}: ${description} (${url})`);
    }
  };
  const onRendererGone = (_event, details) => {
    rendererFailure = new Error(`Desktop smoke renderer exited: ${details.reason}`);
  };
  const onDebuggerMessage = (_event, method, parameters) => {
    if (method !== 'Runtime.exceptionThrown') return;
    const exception = parameters?.exceptionDetails;
    rendererErrors.push(exception?.exception?.description || exception?.text || 'renderer exception');
  };
  const sendDebuggerCommand = (method, parameters) => withTimeout(
    debuggerClient.sendCommand(method, parameters),
    debuggerCommandTimeoutMs,
    `Desktop smoke debugger command ${method} timed out.`,
  );
  try {
    window.webContents.on('console-message', onConsoleMessage);
    window.webContents.on('did-fail-load', onLoadFailure);
    window.webContents.on('render-process-gone', onRendererGone);
    await withTimeout(
      window.loadURL(APP_URL),
      timeoutMs,
      `Desktop smoke renderer timed out after ${timeoutMs}ms.`,
    );
    loadedUrl = window.webContents.getURL();
    if (loadedUrl !== APP_URL) {
      throw new Error(`Desktop smoke renderer loaded an unexpected URL: ${loadedUrl}`);
    }
    debuggerClient.attach('1.3');
    debuggerClient.on('message', onDebuggerMessage);
    await sendDebuggerCommand('Runtime.enable');
    await sendDebuggerCommand('Accessibility.enable');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (rendererFailure) throw rendererFailure;
      if (rendererErrors.length) {
        throw new Error(`Desktop smoke renderer reported errors: ${rendererErrors.join(' | ')}`);
      }
      renderedTitle = window.webContents.getTitle();
      const accessibilityTree = await sendDebuggerCommand('Accessibility.getFullAXTree');
      overviewFound = accessibilityTree.nodes?.some((node) => (
        node.role?.value === 'heading' && node.name?.value === 'Overview'
      )) || false;
      if (renderedTitle === 'Insta Toolbox' && overviewFound) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (renderedTitle !== 'Insta Toolbox') {
      throw new Error(`Desktop smoke renderer title was ${JSON.stringify(renderedTitle)}.`);
    }
    if (!overviewFound) throw new Error('Desktop smoke renderer did not render the Overview heading.');
    if (rendererFailure) throw rendererFailure;
    if (rendererErrors.length) {
      throw new Error(`Desktop smoke renderer reported errors: ${rendererErrors.join(' | ')}`);
    }
  } catch (error) {
    exitCode = 1;
    console.error(`Insta Toolbox desktop smoke test failed: ${error.message}`);
  } finally {
    clearTimeout(hardStopTimer);
    window.webContents.off('console-message', onConsoleMessage);
    window.webContents.off('did-fail-load', onLoadFailure);
    window.webContents.off('render-process-gone', onRendererGone);
    debuggerClient.off('message', onDebuggerMessage);
    if (debuggerClient.isAttached()) debuggerClient.detach();
    if (!window.isDestroyed()) window.destroy();
    if (exitCode === 0) {
      console.log(`Insta Toolbox desktop smoke test passed: ${loadedUrl} (${renderedTitle}, Overview)`);
    }
    app.exit(exitCode);
  }
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app.whenReady().then(async () => {
    protocol.handle(SCHEME, assetResponse);
    const session = (await import('electron')).session.defaultSession;
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    try {
      await createStartupBackup();
    } catch (error) {
      console.error('Unable to create startup backup:', error.message);
    }
    if (DESKTOP_SMOKE_TEST) {
      const window = createWindow();
      await runDesktopSmokeTest(window);
      return;
    }
    openProductionWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) openProductionWindow();
    });
  }).catch((error) => {
    if (!DESKTOP_SMOKE_TEST) throw error;
    console.error(`Insta Toolbox desktop startup failed: ${error.message}`);
    app.exit(1);
  });
}

app.on('window-all-closed', () => {
  if (!DESKTOP_SMOKE_TEST && process.platform !== 'darwin') app.quit();
});
