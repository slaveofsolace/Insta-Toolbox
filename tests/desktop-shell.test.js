import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
));

test('desktop shell isolates the renderer and denies browser permissions', () => {
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /callback\(false\)/);
  assert.doesNotMatch(main, /executeJavaScript/);
});

test('desktop protocol confines assets and applies a restrictive content policy', () => {
  assert.match(main, /filePath\.startsWith/);
  assert.match(main, /Content-Security-Policy/);
  assert.match(main, /object-src 'none'/);
  assert.match(main, /frame-ancestors 'none'/);
  assert.match(main, /hostname === 'www\.instagram\.com'/);
});

test('desktop package retains local data and creates bounded startup backups', () => {
  assert.match(main, /BACKUP_RETENTION = 5/);
  assert.match(main, /createStartupBackup/);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageJson.build.asar, true);
  assert.deepEqual(packageJson.build.win.target[0].arch, ['x64']);
  assert.equal(packageJson.build.win.artifactName, 'Insta-Toolbox-Setup-${version}.${ext}');
  assert.deepEqual(packageJson.build.mac.target, [
    { target: 'dmg', arch: ['universal'] },
    { target: 'zip', arch: ['universal'] },
  ]);
  assert.equal(packageJson.build.mac.artifactName, 'Insta-Toolbox-${version}-${arch}.${ext}');
  assert.equal(packageJson.build.mac.identity, '-');
  assert.equal(packageJson.build.mac.notarize, false);
  assert.match(packageJson.scripts['dist:mac'], /--universal/);
});

test('desktop packages retain the project and third-party notices', () => {
  assert.ok(packageJson.build.files.includes('LICENSE'));
  assert.ok(packageJson.build.files.includes('THIRD_PARTY_NOTICES.md'));
});

test('desktop shell uses branded light startup surfaces and native chrome', () => {
  assert.match(main, /backgroundColor: '#f2f1ed'/);
  assert.match(main, /icon: path\.join\(app\.getAppPath\(\), 'assets', 'icon-512\.png'\)/);
  assert.doesNotMatch(main, /frame:\s*false/);
  assert.doesNotMatch(main, /titleBarStyle:/);
});

test('desktop startup recovery is visible and bounded', () => {
  assert.match(main, /import \{ loadWithRecovery, withTimeout \} from '\.\/startup-recovery\.mjs'/);
  assert.match(main, /MAX_DESKTOP_LOAD_ATTEMPTS = 3/);
  assert.match(main, /DESKTOP_LOAD_TIMEOUT_MS = 15_000/);
  assert.match(main, /WINDOW_REVEAL_DELAY_MS = 1_000/);
  assert.match(main, /dialog\.showMessageBox/);
  assert.match(main, /buttons: canRetry \? \['Retry', 'Close'\] : \['Close'\]/);
  assert.match(main, /window\.webContents\.stop\(\)/);
});

test('desktop smoke verifies rendered identity and reports renderer errors without script injection', () => {
  assert.match(main, /debuggerCommandTimeoutMs = 5_000/);
  assert.match(main, /hardStopTimer = setTimeout/);
  assert.match(main, /sendDebuggerCommand\('Accessibility\.getFullAXTree'\)/);
  assert.ok(main.indexOf('window.loadURL(APP_URL)') < main.indexOf("debuggerClient.attach('1.3')"));
  assert.match(main, /Accessibility\.getFullAXTree/);
  assert.match(main, /window\.webContents\.getTitle\(\)/);
  assert.match(main, /node\.role\?\.value === 'heading'/);
  assert.match(main, /node\.name\?\.value === 'Overview'/);
  assert.match(main, /console-message/);
  assert.match(main, /Runtime\.exceptionThrown/);
  assert.doesNotMatch(main, /executeJavaScript/);
});
