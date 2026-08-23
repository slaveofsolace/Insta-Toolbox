import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { crc32, inspectZipArchive } from '../src/core/zip.js';
import { webRuntimeFiles } from './web-package-files.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, '..');
const desktopArtifactExtensions = new Set(['.blockmap', '.dmg', '.exe', '.zip']);
const requiredExtensionEntries = Object.freeze([
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'manifest.json',
]);
const webArchiveRoot = 'insta-toolbox-web';
const requiredWebEntries = Object.freeze([
  `${webArchiveRoot}/LICENSE`,
  `${webArchiveRoot}/THIRD_PARTY_NOTICES.md`,
  `${webArchiveRoot}/START_HERE.txt`,
  `${webArchiveRoot}/VERSION.txt`,
  `${webArchiveRoot}/index.html`,
  `${webArchiveRoot}/manifest.webmanifest`,
  `${webArchiveRoot}/sw.js`,
]);
const expectedWebEntries = new Set([
  ...webRuntimeFiles,
  'START_HERE.txt',
  'VERSION.txt',
].map((relative) => `${webArchiveRoot}/${relative}`));
const maxArtifactCount = 32;
const maxCoreArtifactBytes = 64 * 1024 * 1024;
const maxSingleArtifactBytes = 4 * 1024 * 1024 * 1024;
const maxTotalArtifactBytes = 12 * 1024 * 1024 * 1024;

function safeRelativePath(root, target, label) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository.`);
  }
  return relative;
}

function releaseNameFor(target) {
  const name = path.basename(target);
  if (!name || /[\\/\r\n\t]/.test(name) || name === '.' || name === '..') {
    throw new Error('Release artifact has an unsafe public filename.');
  }
  return name;
}

function compareReleaseNames(left, right) {
  if (left.releaseName === right.releaseName) return 0;
  return left.releaseName < right.releaseName ? -1 : 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filenameHasVersion(filename, version) {
  return new RegExp(`(?:^|[^0-9])${escapeRegExp(version)}(?:[^0-9]|$)`).test(filename);
}

async function releaseFile(root, target, { maxBytes = maxSingleArtifactBytes } = {}) {
  safeRelativePath(root, target, 'Release artifact');
  const releaseName = releaseNameFor(target);
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Required release artifact is missing: ${releaseName}`);
    throw new Error(`Unable to inspect release artifact ${releaseName} (${error?.code || 'filesystem-error'}).`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Release artifact must be a regular file: ${releaseName}`);
  }
  if (metadata.size < 1 || metadata.size > maxBytes) {
    throw new Error(`Release artifact has an invalid size: ${releaseName}`);
  }
  return { absolutePath: target, releaseName, size: metadata.size };
}

async function readReleaseText(target, releaseName, maxBytes) {
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Required release artifact is missing: ${releaseName}`);
    throw new Error(`Unable to inspect release artifact ${releaseName} (${error?.code || 'filesystem-error'}).`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes) {
    throw new Error(`Release artifact has an invalid size or type: ${releaseName}`);
  }
  try {
    return await readFile(target, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read release artifact ${releaseName} (${error?.code || 'read-error'}).`);
  }
}

function storedEntryBytes(archiveBytes, entry) {
  if (entry.compressionMethod !== 0 || entry.compressedSize !== entry.uncompressedSize) {
    throw new Error(`Extension archive entry is not stored deterministically: ${entry.path}`);
  }
  const bytes = archiveBytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (bytes.byteLength !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) {
    throw new Error(`Extension archive entry failed its CRC check: ${entry.path}`);
  }
  return bytes;
}

export function verifyExtensionReleaseArchive(input, version) {
  const archiveBytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const archive = inspectZipArchive(archiveBytes, {
    limits: {
      maxEntries: 128,
      maxEntryBytes: maxCoreArtifactBytes,
      maxTotalUncompressedBytes: 128 * 1024 * 1024,
    },
  });
  const entries = new Map(archive.entries.map((entry) => [entry.path, entry]));
  for (const required of requiredExtensionEntries) {
    if (!entries.has(required)) throw new Error(`Extension archive is missing ${required}.`);
  }
  for (const entry of archive.entries) storedEntryBytes(archiveBytes, entry);

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const license = decoder.decode(storedEntryBytes(archiveBytes, entries.get('LICENSE')));
  const notices = decoder.decode(storedEntryBytes(archiveBytes, entries.get('THIRD_PARTY_NOTICES.md')));
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(storedEntryBytes(archiveBytes, entries.get('manifest.json'))));
  } catch {
    throw new Error('Extension archive manifest.json is not valid UTF-8 JSON.');
  }
  if (manifest?.version !== version) {
    throw new Error(`Extension archive version does not match ${version}.`);
  }
  if (!license.includes('MIT License') || !license.includes('Permission is hereby granted')) {
    throw new Error('Extension archive contains an incomplete LICENSE.');
  }
  if (!notices.includes('Third-party notices')) {
    throw new Error('Extension archive contains incomplete third-party notices.');
  }
  return archive.entries.map((entry) => entry.path).sort();
}

export function verifyWebReleaseArchive(input, version) {
  const archiveBytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const archive = inspectZipArchive(archiveBytes, {
    limits: {
      maxEntries: 256,
      maxEntryBytes: maxCoreArtifactBytes,
      maxTotalUncompressedBytes: 128 * 1024 * 1024,
    },
  });
  const entries = new Map(archive.entries.map((entry) => [entry.path, entry]));
  for (const required of requiredWebEntries) {
    if (!entries.has(required)) throw new Error(`Web archive is missing ${required}.`);
  }
  if (archive.entries.length !== expectedWebEntries.size) {
    throw new Error('Web archive does not contain the exact public runtime file set.');
  }
  for (const entry of archive.entries) {
    if (!expectedWebEntries.has(entry.path)) {
      throw new Error(`Web archive contains an unexpected entry: ${entry.path}`);
    }
    storedEntryBytes(archiveBytes, entry);
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const text = (relativePath) => decoder.decode(storedEntryBytes(
    archiveBytes,
    entries.get(`${webArchiveRoot}/${relativePath}`),
  ));
  if (text('VERSION.txt').trim() !== version) {
    throw new Error(`Web archive version does not match ${version}.`);
  }
  if (!text('LICENSE').includes('MIT License') || !text('LICENSE').includes('Permission is hereby granted')) {
    throw new Error('Web archive contains an incomplete LICENSE.');
  }
  if (!text('THIRD_PARTY_NOTICES.md').includes('Third-party notices')) {
    throw new Error('Web archive contains incomplete third-party notices.');
  }
  if (!/do not double-click index\.html/i.test(text('START_HERE.txt')) || !/https|localhost/i.test(text('START_HERE.txt'))) {
    throw new Error('Web archive is missing safe launch instructions.');
  }
  let manifest;
  try {
    manifest = JSON.parse(text('manifest.webmanifest'));
  } catch {
    throw new Error('Web archive manifest.webmanifest is not valid UTF-8 JSON.');
  }
  if (manifest?.name !== 'Insta Toolbox' || manifest?.display !== 'standalone') {
    throw new Error('Web archive contains the wrong application manifest.');
  }
  return archive.entries.map((entry) => entry.path).sort();
}

async function packageVersion(root) {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    throw new Error('package.json is missing or invalid.');
  }
  const version = String(metadata?.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('package.json needs a semantic release version.');
  return version;
}

async function availableDesktopArtifacts(root, version) {
  const desktopRoot = path.join(root, 'dist', 'desktop');
  safeRelativePath(root, desktopRoot, 'Desktop artifact directory');
  let entries;
  try {
    entries = await readdir(desktopRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`Unable to inspect desktop release artifacts (${error?.code || 'filesystem-error'}).`);
  }

  const recognized = entries.filter((entry) => desktopArtifactExtensions.has(path.extname(entry.name).toLowerCase()));
  if (recognized.length > maxArtifactCount - 2) {
    throw new Error(`Too many desktop release artifacts; maximum is ${maxArtifactCount - 2}.`);
  }
  const stale = recognized.filter((entry) => !filenameHasVersion(entry.name, version));
  if (stale.length) {
    throw new Error(`Stale desktop release artifacts are present: ${stale.map((entry) => entry.name).sort().join(', ')}`);
  }
  return Promise.all(recognized.map((entry) => releaseFile(root, path.join(desktopRoot, entry.name))));
}

async function sha256(target) {
  const hash = createHash('sha256');
  const stream = createReadStream(target);
  try {
    for await (const chunk of stream) hash.update(chunk);
  } catch (error) {
    throw new Error(`Unable to hash ${releaseNameFor(target)} (${error?.code || 'read-error'}).`);
  }
  return hash.digest('hex');
}

export async function generateReleaseChecksums({
  repositoryRoot = defaultRepositoryRoot,
  outputFile = path.join(repositoryRoot, 'dist', 'SHA256SUMS.txt'),
} = {}) {
  const root = path.resolve(repositoryRoot);
  const resolvedOutput = path.resolve(outputFile);
  safeRelativePath(root, resolvedOutput, 'Checksum output');
  const version = await packageVersion(root);
  const userscriptPath = path.join(root, 'userscripts', 'insta-aio-companion.user.js');
  const extensionPath = path.join(root, 'dist', `insta-aio-companion-${version}.zip`);
  const webPath = path.join(root, 'dist', `insta-toolbox-web-${version}.zip`);
  const userscript = await releaseFile(root, userscriptPath, { maxBytes: maxCoreArtifactBytes });
  const extension = await releaseFile(root, extensionPath, { maxBytes: maxCoreArtifactBytes });
  const web = await releaseFile(root, webPath, { maxBytes: maxCoreArtifactBytes });
  const userscriptSource = await readReleaseText(userscriptPath, userscript.releaseName, maxCoreArtifactBytes);
  const userscriptVersion = userscriptSource.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)\s*$/m)?.[1];
  if (userscriptVersion !== version) throw new Error(`Userscript version does not match ${version}.`);

  let extensionBytes;
  try {
    extensionBytes = await readFile(extensionPath);
  } catch (error) {
    throw new Error(`Unable to read release artifact ${extension.releaseName} (${error?.code || 'read-error'}).`);
  }
  verifyExtensionReleaseArchive(extensionBytes, version);

  let webBytes;
  try {
    webBytes = await readFile(webPath);
  } catch (error) {
    throw new Error(`Unable to read release artifact ${web.releaseName} (${error?.code || 'read-error'}).`);
  }
  verifyWebReleaseArchive(webBytes, version);

  const artifacts = [userscript, extension, web, ...await availableDesktopArtifacts(root, version)];
  if (artifacts.length > maxArtifactCount) throw new Error(`Too many release artifacts; maximum is ${maxArtifactCount}.`);
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
  if (totalBytes > maxTotalArtifactBytes) throw new Error('Release artifacts exceed the bounded total size.');

  artifacts.sort(compareReleaseNames);
  const releaseNames = new Set();
  for (const artifact of artifacts) {
    if (releaseNames.has(artifact.releaseName)) {
      throw new Error(`Release artifact filenames must be unique: ${artifact.releaseName}`);
    }
    releaseNames.add(artifact.releaseName);
    artifact.sha256 = await sha256(artifact.absolutePath);
  }
  const contents = `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.releaseName}`).join('\n')}\n`;

  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  const temporaryOutput = path.join(
    path.dirname(resolvedOutput),
    `.${path.basename(resolvedOutput)}.${process.pid}.${randomUUID()}.tmp`,
  );
  safeRelativePath(root, temporaryOutput, 'Temporary checksum output');
  try {
    await writeFile(temporaryOutput, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryOutput, resolvedOutput);
  } finally {
    await rm(temporaryOutput, { force: true });
  }

  return {
    artifacts: artifacts.map(({ releaseName, sha256: digest, size }) => ({
      name: releaseName,
      sha256: digest,
      size,
    })),
    contents,
    version,
  };
}

const invokedDirectly = Boolean(process.argv[1])
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const result = await generateReleaseChecksums();
  console.log(`Wrote SHA256SUMS.txt for ${result.artifacts.length} release artifacts.`);
  for (const artifact of result.artifacts) console.log(`- ${artifact.name}`);
}
