import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyExtensionReleaseArchive } from './generate-release-checksums.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const artifact = path.join(
  repositoryRoot,
  'dist',
  `Insta-Toolbox-Extension-${packageMetadata.version}.zip`,
);
const entries = verifyExtensionReleaseArchive(await readFile(artifact), packageMetadata.version);

console.log(`Verified ${path.basename(artifact)} (${entries.length} exact files).`);
