import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { crc32 } from '../src/core/zip.js';
import { isAllowedAssetPath } from './static-asset-policy.mjs';
import { webRuntimeFiles } from './web-package-files.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, '..');
const archiveRoot = 'insta-toolbox-web';
const maxRuntimeFiles = 256;
const maxRuntimeBytes = 64 * 1024 * 1024;

function storedZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  const names = new Set();
  let offset = 0;

  for (const entry of entries) {
    const normalized = String(entry.name || '').replaceAll('\\', '/');
    if (
      !normalized
      || normalized.startsWith('/')
      || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      || names.has(normalized)
    ) {
      throw new Error(`Web archive entry has an unsafe or duplicate path: ${normalized || '(empty)'}`);
    }
    names.add(normalized);

    const name = Buffer.from(normalized);
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localRecords.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralRecords.reduce((total, record) => total + record.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, end]);
}

function collectRuntimeFiles() {
  const files = [...webRuntimeFiles];
  files.sort();
  if (files.length > maxRuntimeFiles) throw new Error('Web package contains too many runtime files.');
  if (new Set(files).size !== files.length) throw new Error('Web package contains duplicate runtime files.');
  for (const relative of files) {
    if (!isAllowedAssetPath(relative)) throw new Error(`Web package source is not public: ${relative}`);
  }
  return files;
}

function startHere(version) {
  return `INSTA TOOLBOX ${version} - WEB PACKAGE

This is the portable web build, not a desktop installer.

1. Extract the insta-toolbox-web folder.
2. Serve that folder over HTTPS or from http://localhost with a static web server.
3. Open the server address in a modern browser.
4. Use the browser's Install app command if you want a standalone PWA window.

Do not double-click index.html. Browser security rules prevent the modules and
offline worker from loading correctly from a file:// address.

For a ready-made app that needs no web server, download the Windows installer
or macOS DMG from the same GitHub release.

No Instagram account data is included in this archive.
`;
}

export async function buildWebPackage({ repositoryRoot = defaultRepositoryRoot } = {}) {
  const root = path.resolve(repositoryRoot);
  const distRoot = path.join(root, 'dist');
  const outputRoot = path.join(distRoot, 'web');
  if (!outputRoot.startsWith(`${distRoot}${path.sep}`)) {
    throw new Error('Web output must remain inside the repository dist directory.');
  }

  const packageMetadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = String(packageMetadata.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Web package needs a semantic version.');

  const runtimeFiles = collectRuntimeFiles();
  const sourceEntries = [];
  let totalBytes = 0;
  for (const relative of runtimeFiles) {
    const source = path.join(root, ...relative.split('/'));
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Web package source must be a regular file: ${relative}`);
    }
    totalBytes += metadata.size;
    if (totalBytes > maxRuntimeBytes) throw new Error('Web package exceeds its bounded source size.');
    sourceEntries.push({ relative, data: await readFile(source) });
  }

  await rm(outputRoot, { recursive: true, force: true });
  for (const entry of sourceEntries) {
    const destination = path.join(outputRoot, ...entry.relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, ...entry.relative.split('/')), destination);
  }

  const generatedEntries = [
    { relative: 'START_HERE.txt', data: Buffer.from(startHere(version), 'utf8') },
    { relative: 'VERSION.txt', data: Buffer.from(`${version}\n`, 'utf8') },
  ];
  for (const entry of generatedEntries) {
    await writeFile(path.join(outputRoot, entry.relative), entry.data);
  }

  const archiveEntries = [...sourceEntries, ...generatedEntries]
    .sort((left, right) => (
      left.relative === right.relative ? 0 : left.relative < right.relative ? -1 : 1
    ))
    .map((entry) => ({
      name: `${archiveRoot}/${entry.relative}`,
      data: entry.data,
    }));
  const artifact = path.join(distRoot, `insta-toolbox-web-${version}.zip`);
  await mkdir(distRoot, { recursive: true });
  await writeFile(artifact, storedZip(archiveEntries));

  return {
    artifact,
    outputRoot,
    runtimeFiles,
    version,
  };
}

const invokedDirectly = Boolean(process.argv[1])
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const result = await buildWebPackage();
  console.log(`Built web app folder at ${path.relative(defaultRepositoryRoot, result.outputRoot)}.`);
  console.log(`Built web archive at ${path.relative(defaultRepositoryRoot, result.artifact)}.`);
}
