import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import asar from '@electron/asar';

import {
  requiredDesktopEntries,
  verifyDesktopArchive,
  verifyPackagedDesktopArchives,
} from '../scripts/verify-desktop-archive.mjs';

const { createPackage } = asar;
const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageMetadata.version;

test('package exposes the desktop archive verification command', () => {
  assert.equal(packageMetadata.scripts['verify:desktop-archive'], 'node scripts/verify-desktop-archive.mjs');
});

async function archiveFixture(t, {
  omittedEntry = null,
  packageMain = 'desktop/main.mjs',
  packageVersion = version,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'insta-toolbox-desktop-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const packaged = path.join(root, 'dist', 'desktop', 'win-unpacked', 'resources');
  await mkdir(source, { recursive: true });
  await mkdir(packaged, { recursive: true });
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ version })}\n`);
  for (const entry of requiredDesktopEntries) {
    if (entry === omittedEntry) continue;
    const target = path.join(source, ...entry.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    let contents = 'desktop archive fixture\n';
    if (entry === 'LICENSE') contents = 'MIT License\n\nPermission is hereby granted.\n';
    if (entry === 'THIRD_PARTY_NOTICES.md') contents = '# Third-party notices\n';
    if (entry === 'package.json') {
      contents = `${JSON.stringify({ main: packageMain, version: packageVersion })}\n`;
    }
    await writeFile(target, contents);
  }
  const archive = path.join(packaged, 'app.asar');
  await createPackage(source, archive);
  return { archive, root };
}

test('verifies legal contents and version inside a packaged desktop app.asar', async (t) => {
  const fixture = await archiveFixture(t);
  const direct = await verifyDesktopArchive(fixture.archive, version);
  assert.equal(direct.version, version);
  assert.ok(direct.entries >= requiredDesktopEntries.length);

  const discovered = await verifyPackagedDesktopArchives({ repositoryRoot: fixture.root });
  assert.deepEqual(discovered, [{
    entries: direct.entries,
    path: 'dist/desktop/win-unpacked/resources/app.asar',
    version,
  }]);
});

test('rejects a desktop archive missing its third-party notices', async (t) => {
  const fixture = await archiveFixture(t, { omittedEntry: 'THIRD_PARTY_NOTICES.md' });
  await assert.rejects(
    verifyDesktopArchive(fixture.archive, version),
    /missing THIRD_PARTY_NOTICES\.md/,
  );
});

test('rejects desktop archives missing packaged renderer or icon runtime files', async (t) => {
  for (const omittedEntry of ['src/styles.css', 'assets/icon-512.png']) {
    await t.test(omittedEntry, async (subtest) => {
      const fixture = await archiveFixture(subtest, { omittedEntry });
      await assert.rejects(
        verifyDesktopArchive(fixture.archive, version),
        new RegExp(`missing ${omittedEntry.replaceAll('.', '\\.')}`),
      );
    });
  }
});

test('rejects a desktop archive carrying a stale application version', async (t) => {
  const fixture = await archiveFixture(t, { packageVersion: '0.0.0' });
  await assert.rejects(
    verifyDesktopArchive(fixture.archive, version),
    /version does not match/,
  );
});

test('rejects a desktop archive whose package entrypoint bypasses the desktop shell', async (t) => {
  const fixture = await archiveFixture(t, { packageMain: 'index.html' });
  await assert.rejects(
    verifyDesktopArchive(fixture.archive, version),
    /does not point to desktop\/main\.mjs/,
  );
});
