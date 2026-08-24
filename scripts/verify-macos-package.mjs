import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_MAC_APP_NAME,
  assertAdHocSignature,
  assertDmgOuterInventory,
  assertExactMainEntitlements,
  assertHardenedRuntime,
  assertNestedEntitlements,
  assertZipOuterInventory,
  parseCodeSignEntitlements,
} from './macos-package-policy.mjs';

if (process.platform !== 'darwin') {
  throw new Error('macOS package acceptance must run on macOS.');
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'dist', 'desktop');
const packageMetadata = JSON.parse(await readFile(
  path.join(repositoryRoot, 'package.json'),
  'utf8',
));
const expectedArtifactStem = `Insta-Toolbox-${packageMetadata.version}-universal`;
const machOMagic = new Set([
  0xbebafeca,
  0xbfbafeca,
  0xcafebabe,
  0xcafebabf,
  0xcefaedfe,
  0xcffaedfe,
  0xfeedface,
  0xfeedfacf,
]);

async function walk(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    found.push(target);
    if (entry.isDirectory() && !entry.name.endsWith('.app')) found.push(...await walk(target));
  }
  return found;
}

function run(command, args, { env = process.env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal || code !== 0) {
        reject(new Error(
          `${command} failed (${signal || code}).\n${stdout}\n${stderr}`,
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function describeOuterEntry(root, relativePath) {
  const target = path.join(root, ...relativePath.split('/'));
  const metadata = await lstat(target);
  let kind = 'other';
  if (metadata.isDirectory()) kind = 'directory';
  if (metadata.isFile()) kind = 'file';
  if (metadata.isSymbolicLink()) kind = 'symlink';
  return {
    executable: metadata.isFile() && (metadata.mode & 0o111) !== 0,
    kind,
    linkTarget: metadata.isSymbolicLink() ? await readlink(target) : null,
    path: relativePath,
    size: metadata.isFile() ? metadata.size : null,
  };
}

async function outerInventory(root, { includeBackground = false } = {}) {
  const inventory = [];
  const rootEntries = await readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    inventory.push(await describeOuterEntry(root, entry.name));
    if (includeBackground && entry.name === '.background' && entry.isDirectory()) {
      for (const child of await readdir(path.join(root, entry.name))) {
        inventory.push(await describeOuterEntry(root, `${entry.name}/${child}`));
      }
    }
  }
  return inventory;
}

async function machOBinaries(application) {
  const found = [];
  const pending = [application];
  while (pending.length) {
    const directory = pending.shift();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const handle = await open(target, 'r');
      const header = Buffer.alloc(4);
      try {
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (bytesRead === header.length && machOMagic.has(header.readUInt32BE(0))) found.push(target);
      } finally {
        await handle.close();
      }
    }
  }
  return found.sort();
}

async function assertUniversalMachOBinaries(application, label) {
  const binaries = await machOBinaries(application);
  assert.ok(binaries.length >= 5, `${label} app contains too few Mach-O binaries`);
  for (const binary of binaries) {
    const slices = await run('/usr/bin/lipo', ['-archs', binary]);
    assert.deepEqual(
      [...new Set(slices.stdout.trim().split(/\s+/).filter(Boolean))].sort(),
      ['arm64', 'x86_64'],
      `${label} binary is not universal: ${path.relative(application, binary)}`,
    );
  }
  return binaries;
}

async function assertBundleIcon(application, label) {
  const infoPlist = path.join(application, 'Contents', 'Info.plist');
  const result = await run('/usr/bin/plutil', [
    '-extract', 'CFBundleIconFile', 'raw', '-o', '-', infoPlist,
  ]);
  const declared = result.stdout.trim();
  assert.ok(declared, `${label} app does not declare CFBundleIconFile`);
  const iconName = path.extname(declared) ? declared : `${declared}.icns`;
  const icon = path.join(application, 'Contents', 'Resources', iconName);
  assert.ok((await stat(icon)).size > 1_000, `${label} app bundle icon is missing or empty`);
}

async function assertSignedUniversalApp(application, label) {
  assert.equal(path.basename(application), EXPECTED_MAC_APP_NAME, `${label} app name changed`);
  await run('/usr/bin/plutil', ['-lint', path.join(application, 'Contents', 'Info.plist')]);
  await run('/usr/bin/codesign', [
    '--verify', '--deep', '--strict', '--verbose=2', application,
  ]);

  const executable = path.join(application, 'Contents', 'MacOS', 'Insta Toolbox');
  const binaries = await assertUniversalMachOBinaries(application, label);
  assert.ok(binaries.includes(executable), `${label} app main executable is not Mach-O`);
  for (const binary of binaries) {
    const relativeBinary = path.relative(application, binary);
    const binaryLabel = `${label} ${relativeBinary}`;
    const signature = await run('/usr/bin/codesign', [
      '--display', '--verbose=4', '--entitlements', '-', '--xml', binary,
    ]);
    const output = `${signature.stdout}\n${signature.stderr}`;
    assertHardenedRuntime(output, binaryLabel);
    const entitlements = parseCodeSignEntitlements(output, binaryLabel);
    if (binary === executable) {
      // The main executable must expose the exact codesign record `Signature=adhoc`.
      assertAdHocSignature(output, binaryLabel);
      assertExactMainEntitlements(entitlements, binaryLabel);
    } else {
      assertNestedEntitlements(entitlements, binaryLabel);
    }
  }
  await assertBundleIcon(application, label);
  return executable;
}

const artifacts = await walk(outputRoot);
const dmgFiles = artifacts.filter((target) => target.endsWith('.dmg'));
const zipFiles = artifacts.filter((target) => target.endsWith('.zip'));
assert.equal(dmgFiles.length, 1, `expected one DMG, found ${dmgFiles.length}`);
assert.equal(zipFiles.length, 1, `expected one ZIP, found ${zipFiles.length}`);
assert.equal(path.basename(dmgFiles[0]), `${expectedArtifactStem}.dmg`);
assert.equal(path.basename(zipFiles[0]), `${expectedArtifactStem}.zip`);
for (const artifact of [...dmgFiles, ...zipFiles]) {
  assert.ok((await stat(artifact)).size > 1_000_000, `${path.basename(artifact)} is unexpectedly small`);
}
await run('/usr/bin/unzip', ['-t', zipFiles[0]]);

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'insta-aio-macos-package-'));
const mountPoint = path.join(temporaryRoot, 'mounted-dmg');
const zipRoot = path.join(temporaryRoot, 'zip');
const installRoot = path.join(temporaryRoot, 'Applications');
const smokeParent = path.join(temporaryRoot, 'insta-aio-desktop-smoke-parent');
await mkdir(mountPoint);
await mkdir(zipRoot);
await mkdir(installRoot);
await mkdir(smokeParent);
let mounted = false;
try {
  await run('/usr/bin/ditto', ['-x', '-k', zipFiles[0], zipRoot], { timeoutMs: 60_000 });
  assertZipOuterInventory(await outerInventory(zipRoot), 'ZIP');
  await assertSignedUniversalApp(path.join(zipRoot, EXPECTED_MAC_APP_NAME), 'ZIP');

  await run('/usr/bin/hdiutil', [
    'attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmgFiles[0],
  ]);
  mounted = true;
  assertDmgOuterInventory(
    await outerInventory(mountPoint, { includeBackground: true }),
    'DMG',
  );
  const mountedApp = path.join(mountPoint, EXPECTED_MAC_APP_NAME);
  await assertSignedUniversalApp(mountedApp, 'DMG');

  const installedApp = path.join(installRoot, EXPECTED_MAC_APP_NAME);
  await run('/usr/bin/ditto', [mountedApp, installedApp], { timeoutMs: 60_000 });
  const executable = await assertSignedUniversalApp(installedApp, 'installed DMG');
  const smoke = await run(executable, ['--smoke-test'], {
    env: {
      ...process.env,
      INSTA_AIO_DESKTOP_SMOKE_PARENT: smokeParent,
    },
    timeoutMs: 45_000,
  });
  assert.match(smoke.stdout, /Insta Toolbox desktop smoke test passed/);
  await rm(installedApp, { recursive: true, force: true });
  await assert.rejects(stat(installedApp), { code: 'ENOENT' });
  console.log(`Accepted universal, in-artifact ad-hoc signed macOS DMG/ZIP install, launch, and removal: ${path.basename(dmgFiles[0])}`);
} finally {
  if (mounted) {
    await run('/usr/bin/hdiutil', ['detach', mountPoint], { timeoutMs: 30_000 });
  }
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const resolvedSystemTemp = path.resolve(tmpdir());
  if (
    resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)
    && path.basename(resolvedTemporaryRoot).startsWith('insta-aio-macos-package-')
  ) {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}
