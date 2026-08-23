import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyWebReleaseArchive } from './generate-release-checksums.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const artifact = path.join(repositoryRoot, 'dist', `insta-toolbox-web-${packageMetadata.version}.zip`);
const entries = verifyWebReleaseArchive(await readFile(artifact), packageMetadata.version);

console.log(`Verified ${path.basename(artifact)} (${entries.length} files).`);
