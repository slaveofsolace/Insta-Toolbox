import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import asar from '@electron/asar';

import { webRuntimeFiles } from './web-package-files.mjs';

const { extractFile, listPackage } = asar;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, '..');
const maxArchiveBytes = 4 * 1024 * 1024 * 1024;
const maxArchiveEntries = 20_000;
const maxDirectoryEntries = 4_096;
const maxSearchDepth = 12;
const maxLegalFileBytes = 2 * 1024 * 1024;
export const requiredDesktopEntries = Object.freeze([
  'desktop/main.mjs',
  'desktop/startup-recovery.mjs',
  'package.json',
  ...webRuntimeFiles,
]);

function relativeInside(root, target, label) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository.`);
  }
  return relative;
}

async function assertRealPathInside(root, target, label) {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  const relative = path.relative(realRoot, realTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the repository.`);
  }
}

async function archiveCandidates(root, input) {
  relativeInside(root, input, 'Desktop archive input');
  let metadata;
  try {
    metadata = await lstat(input);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('No packaged desktop output was found.');
    throw new Error(`Unable to inspect packaged desktop output (${error?.code || 'filesystem-error'}).`);
  }
  if (metadata.isSymbolicLink()) throw new Error('Desktop archive input cannot be a symbolic link.');
  await assertRealPathInside(root, input, 'Desktop archive input');

  if (metadata.isFile()) {
    if (path.basename(input) !== 'app.asar') throw new Error('Desktop archive input must be app.asar or a directory.');
    return [input];
  }
  if (!metadata.isDirectory()) throw new Error('Desktop archive input must be app.asar or a directory.');

  const found = [];
  const pending = [{ directory: input, depth: 0 }];
  let visitedEntries = 0;
  while (pending.length) {
    const current = pending.shift();
    const entries = await readdir(current.directory, { withFileTypes: true });
    visitedEntries += entries.length;
    if (visitedEntries > maxDirectoryEntries) {
      throw new Error(`Desktop archive search exceeded ${maxDirectoryEntries} entries.`);
    }
    for (const entry of entries) {
      const target = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name === 'app.asar') {
        found.push(target);
        continue;
      }
      if (entry.isDirectory() && current.depth < maxSearchDepth && entry.name !== 'app.asar.unpacked') {
        pending.push({ directory: target, depth: current.depth + 1 });
      }
    }
  }
  if (!found.length) throw new Error('No app.asar archive was found in the packaged desktop output.');
  return found.sort();
}

function archiveText(archivePath, entryName) {
  let bytes;
  try {
    bytes = extractFile(archivePath, entryName, false);
  } catch {
    throw new Error(`Desktop archive cannot read ${entryName}.`);
  }
  if (!bytes?.byteLength || bytes.byteLength > maxLegalFileBytes) {
    throw new Error(`Desktop archive ${entryName} has an invalid size.`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Desktop archive ${entryName} is not valid UTF-8.`);
  }
}

export async function verifyDesktopArchive(archivePath, expectedVersion) {
  const metadata = await lstat(archivePath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1 || metadata.size > maxArchiveBytes) {
    throw new Error('Desktop app.asar must be a bounded regular file.');
  }

  let listed;
  try {
    listed = listPackage(archivePath);
  } catch {
    throw new Error('Desktop app.asar is malformed or unreadable.');
  }
  if (!Array.isArray(listed) || listed.length < 1 || listed.length > maxArchiveEntries) {
    throw new Error('Desktop app.asar has an invalid entry count.');
  }
  const entries = new Set(listed.map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, '')));
  for (const required of requiredDesktopEntries) {
    if (!entries.has(required)) throw new Error(`Desktop app.asar is missing ${required}.`);
  }

  const license = archiveText(archivePath, 'LICENSE');
  const notices = archiveText(archivePath, 'THIRD_PARTY_NOTICES.md');
  if (!license.includes('MIT License') || !license.includes('Permission is hereby granted')) {
    throw new Error('Desktop app.asar contains an incomplete LICENSE.');
  }
  if (!notices.includes('Third-party notices')) {
    throw new Error('Desktop app.asar contains incomplete third-party notices.');
  }

  let packageMetadata;
  try {
    packageMetadata = JSON.parse(archiveText(archivePath, 'package.json'));
  } catch (error) {
    if (error?.message?.startsWith('Desktop archive')) throw error;
    throw new Error('Desktop app.asar package.json is not valid JSON.');
  }
  if (packageMetadata?.version !== expectedVersion) {
    throw new Error(`Desktop app.asar version does not match ${expectedVersion}.`);
  }
  if (packageMetadata?.main !== 'desktop/main.mjs') {
    throw new Error('Desktop app.asar package.json does not point to desktop/main.mjs.');
  }
  return { entries: listed.length, version: expectedVersion };
}

export async function verifyPackagedDesktopArchives({
  repositoryRoot = defaultRepositoryRoot,
  inputPath = path.join(repositoryRoot, 'dist', 'desktop'),
} = {}) {
  const root = path.resolve(repositoryRoot);
  const input = path.resolve(inputPath);
  const packageMetadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = String(packageMetadata?.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('package.json needs a semantic release version.');

  const candidates = await archiveCandidates(root, input);
  const archives = [];
  for (const candidate of candidates) {
    await assertRealPathInside(root, candidate, 'Desktop app.asar');
    const result = await verifyDesktopArchive(candidate, version);
    archives.push({
      entries: result.entries,
      path: relativeInside(root, candidate, 'Desktop app.asar').replaceAll('\\', '/'),
      version,
    });
  }
  return archives;
}

const invokedDirectly = Boolean(process.argv[1])
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  if (process.argv.length > 3) throw new Error('Pass at most one app.asar file or packaged-output directory.');
  const inputPath = process.argv[2]
    ? path.resolve(defaultRepositoryRoot, process.argv[2])
    : path.join(defaultRepositoryRoot, 'dist', 'desktop');
  const archives = await verifyPackagedDesktopArchives({ inputPath });
  for (const archive of archives) {
    console.log(`Verified desktop archive ${archive.path} (${archive.entries} entries, version ${archive.version}).`);
  }
}
