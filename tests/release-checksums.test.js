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
import { webRuntimeFiles } from '../scripts/web-package-files.mjs';

const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageMetadata.version;

test('package exposes the bounded release checksum command', () => {
  assert.equal(packageMetadata.scripts['release:checksums'], 'node scripts/generate-release-checksums.mjs');
});

function extensionArchive({ includeNotices = true } = {}) {
  const entries = [
    { path: 'LICENSE', content: 'MIT License\n\nPermission is hereby granted.\n' },
    { path: 'manifest.json', content: JSON.stringify({ version }) },
  ];
  if (includeNotices) entries.push({ path: 'THIRD_PARTY_NOTICES.md', content: '# Third-party notices\n' });
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
    path.join(root, 'userscripts', 'insta-aio-companion.user.js'),
    `// ==UserScript==\n// @version      ${version}\n// ==/UserScript==\n`,
  );
  await writeFile(path.join(root, 'dist', `insta-aio-companion-${version}.zip`), extensionArchive());
  await writeFile(path.join(root, 'dist', `insta-toolbox-web-${version}.zip`), webArchive());
  return root;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('writes deterministic sorted SHA256SUMS entries without private paths', async (t) => {
  const root = await fixtureRoot(t);
  const desktopArtifacts = new Map([
    [`Insta Toolbox Setup ${version}.exe`, 'windows-installer'],
    [`Insta Toolbox Setup ${version}.exe.blockmap`, 'windows-blockmap'],
    [`Insta Toolbox-${version}.dmg`, 'mac-dmg'],
    [`Insta Toolbox-${version}-mac.zip`, 'mac-zip'],
  ]);
  for (const [name, content] of desktopArtifacts) {
    await writeFile(path.join(root, 'dist', 'desktop', name), content);
  }

  const first = await generateReleaseChecksums({ repositoryRoot: root });
  const firstFile = await readFile(path.join(root, 'dist', 'SHA256SUMS.txt'), 'utf8');
  const second = await generateReleaseChecksums({ repositoryRoot: root });
  const expectedNames = [
    `Insta Toolbox Setup ${version}.exe`,
    `Insta Toolbox Setup ${version}.exe.blockmap`,
    `Insta Toolbox-${version}-mac.zip`,
    `Insta Toolbox-${version}.dmg`,
    `insta-aio-companion-${version}.zip`,
    'insta-aio-companion.user.js',
    `insta-toolbox-web-${version}.zip`,
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

test('rejects stale desktop artifacts instead of silently mixing release versions', async (t) => {
  const root = await fixtureRoot(t);
  await writeFile(path.join(root, 'dist', 'desktop', 'Insta Toolbox Setup 2.0.1.exe'), 'stale');
  await assert.rejects(
    generateReleaseChecksums({ repositoryRoot: root }),
    /Stale desktop release artifacts are present: Insta Toolbox Setup 2\.0\.1\.exe/,
  );
});

test('verifies extension legal files, manifest version, and stored-entry CRCs', () => {
  const valid = extensionArchive();
  assert.deepEqual(verifyExtensionReleaseArchive(valid, version), [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'manifest.json',
  ]);
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
