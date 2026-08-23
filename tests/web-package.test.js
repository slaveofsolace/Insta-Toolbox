import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildWebPackage,
  canonicalizeWebPackageEntry,
} from '../scripts/build-web-package.mjs';
import { createAppServer } from '../scripts/serve.mjs';
import { isAllowedAssetPath } from '../scripts/static-asset-policy.mjs';
import { webRuntimeFiles } from '../scripts/web-package-files.mjs';
import { crc32, inspectZipArchive } from '../src/core/zip.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const archivePath = path.join(repositoryRoot, 'dist', `insta-toolbox-web-${packageMetadata.version}.zip`);
const archiveRoot = 'insta-toolbox-web';

function storedEntryBytes(archiveBytes, entry) {
  assert.equal(entry.compressionMethod, 0, entry.path);
  assert.equal(entry.compressedSize, entry.uncompressedSize, entry.path);
  const bytes = archiveBytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  assert.equal(bytes.byteLength, entry.uncompressedSize, entry.path);
  assert.equal(crc32(bytes), entry.crc32, entry.path);
  return bytes;
}

test('build:web creates a deterministic, self-contained static web archive', async () => {
  assert.equal(packageMetadata.scripts['build:web'], 'node scripts/build-web-package.mjs');
  assert.equal(packageMetadata.scripts['verify:web-package'], 'node scripts/verify-web-package.mjs');
  await buildWebPackage({ repositoryRoot });
  const first = await readFile(archivePath);
  await buildWebPackage({ repositoryRoot });
  const second = await readFile(archivePath);
  assert.deepEqual(second, first);

  const archive = inspectZipArchive(second, {
    limits: {
      maxEntries: 256,
      maxEntryBytes: 64 * 1024 * 1024,
      maxTotalUncompressedBytes: 128 * 1024 * 1024,
    },
  });
  const entries = new Map(archive.entries.map((entry) => [entry.path, entry]));
  for (const required of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'START_HERE.txt',
    'VERSION.txt',
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    'assets/icon-192.png',
    'assets/icon-512.png',
    'src/app-loader.js',
    'src/styles.css',
  ]) {
    assert.ok(entries.has(`${archiveRoot}/${required}`), required);
  }

  const generated = new Set(['START_HERE.txt', 'VERSION.txt']);
  const packagedRuntimeFiles = [];
  for (const entry of archive.entries) {
    assert.match(entry.path, /^insta-toolbox-web\//);
    const relative = entry.path.slice(`${archiveRoot}/`.length);
    const bytes = storedEntryBytes(second, entry);
    if (generated.has(relative)) continue;
    packagedRuntimeFiles.push(relative);
    assert.equal(isAllowedAssetPath(relative), true, relative);
    assert.deepEqual(
      Buffer.from(bytes),
      canonicalizeWebPackageEntry(
        relative,
        await readFile(path.join(repositoryRoot, ...relative.split('/'))),
      ),
    );
  }

  const serviceWorker = await readFile(path.join(repositoryRoot, 'sw.js'), 'utf8');
  const precachedFiles = [...serviceWorker.matchAll(/'\.\/([^']+)'/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .sort();
  assert.deepEqual(
    packagedRuntimeFiles.filter((relative) => relative !== 'sw.js').sort(),
    precachedFiles,
  );
  assert.deepEqual(packagedRuntimeFiles.sort(), [...webRuntimeFiles].sort());
  assert.equal(packagedRuntimeFiles.includes('src/core/controlled-account-action.js'), false);
  assert.equal(packagedRuntimeFiles.includes('src/core/controlled-dm-unsend.js'), false);
  assert.match(serviceWorker, new RegExp(`CACHE_NAME = 'insta-toolbox-v${packageMetadata.version.replaceAll('.', '')}'`));

  const index = await readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'manifest.webmanifest'), 'utf8'));
  const loader = await readFile(path.join(repositoryRoot, 'src', 'app-loader.js'), 'utf8');
  assert.equal(manifest.start_url, './');
  assert.match(index, /src="\.\/src\/app-loader\.js"/);
  assert.match(index, /href="\.\/manifest\.webmanifest"/);
  assert.match(loader, /'\.\/app\.parts\/part-01\.jsfrag'/);

  const version = Buffer.from(storedEntryBytes(second, entries.get(`${archiveRoot}/VERSION.txt`))).toString('utf8');
  const instructions = Buffer.from(storedEntryBytes(second, entries.get(`${archiveRoot}/START_HERE.txt`))).toString('utf8');
  assert.equal(version.trim(), packageMetadata.version);
  assert.match(instructions, /Do not double-click index\.html/i);
  assert.match(instructions, /HTTPS or from http:\/\/localhost/i);
  assert.match(instructions, /py -m http\.server 4173 --bind 127\.0\.0\.1/i);
  assert.match(instructions, /python3 -m http\.server 4173 --bind 127\.0\.0\.1/i);
  assert.match(instructions, /Windows installer\s+or macOS DMG/i);
});

test('build:web canonicalizes text line endings without changing binary assets', async () => {
  assert.deepEqual(
    canonicalizeWebPackageEntry('LICENSE', Buffer.from('first\r\nsecond\rthird\n', 'utf8')),
    Buffer.from('first\nsecond\nthird\n', 'utf8'),
  );
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(canonicalizeWebPackageEntry('assets/icon-192.png', binary), binary);
  assert.throws(
    () => canonicalizeWebPackageEntry('assets/future-format.bin', binary),
    /needs an explicit text or binary type/,
  );

  await buildWebPackage({ repositoryRoot });
  const archiveBytes = await readFile(archivePath);
  const archive = inspectZipArchive(archiveBytes);
  const license = archive.entries.find((entry) => entry.path === `${archiveRoot}/LICENSE`);
  assert.ok(license);
  assert.equal(storedEntryBytes(archiveBytes, license).includes(0x0d), false);
  assert.equal((await readFile(path.join(repositoryRoot, 'dist', 'web', 'LICENSE'))).includes(0x0d), false);
});

test('build:web also creates an inspectable static folder', async () => {
  for (const relative of [
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'START_HERE.txt',
    'VERSION.txt',
  ]) {
    const metadata = await stat(path.join(repositoryRoot, 'dist', 'web', relative));
    assert.equal(metadata.isFile(), true, relative);
  }
});

test('the extracted web folder serves every precached asset and no repository files', async () => {
  const serviceWorker = await readFile(path.join(repositoryRoot, 'sw.js'), 'utf8');
  const precachedFiles = [...serviceWorker.matchAll(/'\.\/([^']+)'/g)]
    .map((match) => match[1])
    .filter(Boolean);
  const server = createAppServer({ rootDirectory: path.join(repositoryRoot, 'dist', 'web') });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const relative of precachedFiles) {
      const response = await fetch(`${base}/${relative}`);
      assert.equal(response.status, 200, relative);
      await response.arrayBuffer();
    }
    for (const privatePath of ['package.json', 'README.md', '.git/config']) {
      const response = await fetch(`${base}/${privatePath}`);
      assert.equal(response.status, 404, privatePath);
      await response.arrayBuffer();
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
