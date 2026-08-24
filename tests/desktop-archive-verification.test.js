import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import asar from '@electron/asar';

import {
  verifyDesktopArchive,
  verifyPackagedDesktopArchives,
} from '../scripts/verify-desktop-archive.mjs';

const { createPackage } = asar;
const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageMetadata.version;

test('package exposes the desktop archive verification command', () => {
  assert.equal(packageMetadata.scripts['verify:desktop-archive'], 'node scripts/verify-desktop-archive.mjs');
});

async function archiveFixture(t, { includeNotices = true, packageVersion = version } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'insta-toolbox-desktop-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const packaged = path.join(root, 'dist', 'desktop', 'win-unpacked', 'resources');
  await mkdir(source, { recursive: true });
  await mkdir(packaged, { recursive: true });
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ version })}\n`);
  await writeFile(path.join(source, 'LICENSE'), 'MIT License\n\nPermission is hereby granted.\n');
  await writeFile(path.join(source, 'package.json'), `${JSON.stringify({ version: packageVersion })}\n`);
  if (includeNotices) {
    await writeFile(path.join(source, 'THIRD_PARTY_NOTICES.md'), '# Third-party notices\n');
  }
  const archive = path.join(packaged, 'app.asar');
  await createPackage(source, archive);
  return { archive, root };
}

test('verifies legal contents and version inside a packaged desktop app.asar', async (t) => {
  const fixture = await archiveFixture(t);
  const direct = await verifyDesktopArchive(fixture.archive, version);
  assert.equal(direct.version, version);
  assert.ok(direct.entries >= 3);

  const discovered = await verifyPackagedDesktopArchives({ repositoryRoot: fixture.root });
  assert.deepEqual(discovered, [{
    entries: direct.entries,
    path: 'dist/desktop/win-unpacked/resources/app.asar',
    version,
  }]);
});

test('rejects a desktop archive missing its third-party notices', async (t) => {
  const fixture = await archiveFixture(t, { includeNotices: false });
  await assert.rejects(
    verifyDesktopArchive(fixture.archive, version),
    /missing THIRD_PARTY_NOTICES\.md/,
  );
});

test('rejects a desktop archive carrying a stale application version', async (t) => {
  const fixture = await archiveFixture(t, { packageVersion: '0.0.0' });
  await assert.rejects(
    verifyDesktopArchive(fixture.archive, version),
    /version does not match/,
  );
});
