import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  generateReleaseChecksums,
  verifyExtensionReleaseArchive,
  verifyWebReleaseArchive,
} from '../scripts/generate-release-checksums.mjs';
import { createZip } from './support/zip-fixture.js';
import { expectedExtensionArchiveEntries } from '../scripts/extension-package-files.mjs';
import { webRuntimeFiles } from '../scripts/web-package-files.mjs';

const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageMetadata.version;

test('package and download docs expose the current release artifacts', async () => {
  assert.equal(packageMetadata.scripts['release:checksums'], 'node scripts/generate-release-checksums.mjs');
  const documents = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/INSTALLATION.md', import.meta.url), 'utf8'),
  ]);
  const escapedVersion = version.replaceAll('.', '\\.');
  for (const document of documents) {
    assert.match(document, new RegExp(`Insta-Toolbox-Setup-${escapedVersion}\\.exe`));
    assert.match(document, new RegExp(`Insta-Toolbox-${escapedVersion}-universal\\.dmg`));
    assert.match(document, new RegExp(`insta-toolbox-web-${escapedVersion}\\.zip`));
    assert.match(document, new RegExp(`Insta-Toolbox-Extension-${escapedVersion}\\.zip`));
    assert.match(document, /chrome:\/\/extensions\/\?id=dhdgffkkebhmkfjojejmpbldmpobfkfo/);
    assert.match(document, /Turn on \*\*Allow User Scripts\*\*/);
    assert.match(document, /Install\*\* button on the left below the script details/);
    assert.doesNotMatch(document, /Install\*\* in the top-right corner/);
    assert.match(document, /01-allow-user-scripts\.png/);
    assert.match(document, /02-install-userscript\.png/);
    assert.match(document, /03-open-toolbox\.png/);
    assert.match(document, /https:\/\/slaveofsolace\.com\/work\/contact\//);
    assert.match(document, /https:\/\/github\.com\/slaveofsolace\/Insta-Toolbox\/issues/);
    assert.match(document, /https:\/\/www\.buymeacoffee\.com\/slaveofsolace/);
    assert.doesNotMatch(document, /media\/install\/[^)]+\.svg/);
  }
});

test('the quick-install guide uses captured PNG click targets', async () => {
  const captures = await Promise.all([
    readFile(new URL('../docs/media/install/01-allow-user-scripts.png', import.meta.url)),
    readFile(new URL('../docs/media/install/02-install-userscript.png', import.meta.url)),
    readFile(new URL('../docs/media/install/03-open-toolbox.png', import.meta.url)),
  ]);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const capture of captures) {
    assert.equal(capture.subarray(0, pngSignature.length).equals(pngSignature), true);
    assert.ok(capture.length > 5_000);
  }
});

function extensionArchive({ extraEntry = null, includeNotices = true } = {}) {
  const contents = new Map([
    ['LICENSE', 'MIT License\n\nPermission is hereby granted.\n'],
    ['manifest.json', JSON.stringify({ version })],
    ['THIRD_PARTY_NOTICES.md', '# Third-party notices\n'],
  ]);
  const entries = expectedExtensionArchiveEntries
    .filter((relative) => includeNotices || relative !== 'THIRD_PARTY_NOTICES.md')
    .map((relative) => ({ path: relative, content: contents.get(relative) || `fixture:${relative}\n` }));
  if (extraEntry) entries.push({ path: extraEntry, content: 'unexpected\n' });
  return createZip(entries, { compression: 'store' });
}

function webArchive({ includeNotices = true } = {}) {
  const root = 'insta-toolbox-web';
  const contents = new Map([
    ['LICENSE', 'MIT License\n\nPermission is hereby granted.\n'],
    ['index.html', '<!doctype html><title>Insta Toolbox</title>'],
    ['manifest.webmanifest', JSON.stringify({ name: 'Insta Toolbox', display: 'standalone' })],
    ['sw.js', 'self.addEventListener("fetch", () => {});'],
    ['THIRD_PARTY_NOTICES.md', '# Third-party notices\n'],
  ]);
  const entries = webRuntimeFiles
    .filter((relative) => includeNotices || relative !== 'THIRD_PARTY_NOTICES.md')
    .map((relative) => ({ path: `${root}/${relative}`, content: contents.get(relative) || `fixture:${relative}\n` }));
  entries.push(
    { path: `${root}/START_HERE.txt`, content: 'Do not double-click index.html. Serve with HTTPS or localhost.\n' },
    { path: `${root}/VERSION.txt`, content: `${version}\n` },
  );
  return createZip(entries, { compression: 'store' });
}

async function fixtureRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'insta-toolbox-release-checksums-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'userscripts'), { recursive: true });
  await mkdir(path.join(root, 'dist', 'desktop'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ version })}\n`);
  await writeFile(
    path.join(root, 'userscripts', 'insta-toolbox.user.js'),
    `// ==UserScript==\n// @version      ${version}\n// ==/UserScript==\n`,
  );
  await writeFile(path.join(root, 'dist', `Insta-Toolbox-Extension-${version}.zip`), extensionArchive());
  await writeFile(path.join(root, 'dist', `insta-toolbox-web-${version}.zip`), webArchive());
  return root;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('writes deterministic sorted SHA256SUMS entries without private paths', async (t) => {
  const root = await fixtureRoot(t);
  const desktopArtifacts = new Map([
    [`Insta-Toolbox-Setup-${version}.exe`, 'windows-installer'],
    [`Insta-Toolbox-${version}-universal.dmg`, 'mac-dmg'],
    [`Insta-Toolbox-${version}-universal.zip`, 'mac-zip'],
  ]);
  for (const [name, content] of desktopArtifacts) {
    await writeFile(path.join(root, 'dist', 'desktop', name), content);
  }

  const first = await generateReleaseChecksums({ repositoryRoot: root });
  const firstFile = await readFile(path.join(root, 'dist', 'SHA256SUMS.txt'), 'utf8');
  const second = await generateReleaseChecksums({ repositoryRoot: root });
  const expectedNames = [
    `Insta-Toolbox-${version}-universal.dmg`,
    `Insta-Toolbox-${version}-universal.zip`,
    `Insta-Toolbox-Extension-${version}.zip`,
    `Insta-Toolbox-Setup-${version}.exe`,
    `insta-toolbox-web-${version}.zip`,
    'insta-toolbox.user.js',
  ];
  assert.deepEqual(first.artifacts.map(({ name }) => name), expectedNames);
  assert.equal(second.contents, first.contents);
  assert.equal(firstFile, first.contents);
  assert.equal(first.contents.includes(root), false);
  assert.equal(first.contents.includes('\\'), false);
  for (const [name, content] of desktopArtifacts) {
    assert.match(first.contents, new RegExp(`^${digest(content)}  ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
});

test('rejects updater blockmaps because the desktop app has no updater', async (t) => {
  const root = await fixtureRoot(t);
  await writeFile(path.join(root, 'dist', 'desktop', `Insta-Toolbox-Setup-${version}.exe.blockmap`), 'unused');
  await assert.rejects(
    generateReleaseChecksums({ repositoryRoot: root }),
    /must not include updater blockmaps/,
  );
});

test('rejects stale desktop artifacts instead of silently mixing release versions', async (t) => {
  const root = await fixtureRoot(t);
  await writeFile(path.join(root, 'dist', 'desktop', 'Insta-Toolbox-Setup-2.0.1.exe'), 'stale');
  await assert.rejects(
    generateReleaseChecksums({ repositoryRoot: root }),
    /Stale desktop release artifacts are present: Insta-Toolbox-Setup-2\.0\.1\.exe/,
  );
});

test('verifies extension legal files, manifest version, and stored-entry CRCs', () => {
  const valid = extensionArchive();
  assert.deepEqual(verifyExtensionReleaseArchive(valid, version), expectedExtensionArchiveEntries);
  assert.throws(
    () => verifyExtensionReleaseArchive(extensionArchive({ includeNotices: false }), version),
    /missing THIRD_PARTY_NOTICES\.md/,
  );

  const corrupted = Buffer.from(valid);
  const contentOffset = corrupted.indexOf(Buffer.from('Permission is hereby granted'));
  assert.ok(contentOffset > 0);
  corrupted[contentOffset] ^= 0x01;
  assert.throws(
    () => verifyExtensionReleaseArchive(corrupted, version),
    /failed its CRC check: LICENSE/,
  );

  assert.throws(
    () => verifyExtensionReleaseArchive(extensionArchive({ extraEntry: 'debug-notes.txt' }), version),
    /unexpected entry: debug-notes\.txt/,
  );
});

test('verifies the portable web archive, version, instructions, and legal files', () => {
  const valid = webArchive();
  assert.deepEqual(verifyWebReleaseArchive(valid, version), [
    ...webRuntimeFiles,
    'START_HERE.txt',
    'VERSION.txt',
  ].map((relative) => `insta-toolbox-web/${relative}`).sort());
  assert.throws(
    () => verifyWebReleaseArchive(webArchive({ includeNotices: false }), version),
    /missing insta-toolbox-web\/THIRD_PARTY_NOTICES\.md/,
  );
});
