export const EXPECTED_MAC_APP_NAME = 'Insta Toolbox.app';

export const DOCUMENTED_MAC_ENTITLEMENTS = Object.freeze([
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
]);

const documentedEntitlementSet = new Set(DOCUMENTED_MAC_ENTITLEMENTS);
const hardenedRuntimeFlag = 0x10000;
const maxDmgEntries = 8;
const dmgFileLimits = new Map([
  ['.DS_Store', 1024 * 1024],
  ['.VolumeIcon.icns', 16 * 1024 * 1024],
  ['.background.png', 32 * 1024 * 1024],
  ['.background.tiff', 32 * 1024 * 1024],
  ['.background/background.png', 32 * 1024 * 1024],
  ['.background/background.tiff', 32 * 1024 * 1024],
]);

function fail(label, message) {
  throw new Error(`${label} ${message}.`);
}

function normalizedInventory(entries, label, maximumEntries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > maximumEntries) {
    fail(label, `inventory must contain 1-${maximumEntries} entries`);
  }
  const inventory = new Map();
  for (const source of entries) {
    const entryPath = typeof source?.path === 'string' ? source.path : '';
    const segments = entryPath.split('/');
    if (
      !entryPath
      || entryPath.startsWith('/')
      || entryPath.includes('\\')
      || segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      fail(label, `contains an invalid path: ${JSON.stringify(entryPath)}`);
    }
    if (inventory.has(entryPath)) fail(label, `contains a duplicate path: ${entryPath}`);
    if (!['directory', 'file', 'symlink'].includes(source.kind)) {
      fail(label, `contains an unsupported entry type at ${entryPath}`);
    }
    if (source.kind === 'file') {
      if (!Number.isSafeInteger(source.size) || source.size < 1) {
        fail(label, `contains an invalid file size at ${entryPath}`);
      }
      if (source.executable === true) fail(label, `contains executable outer content at ${entryPath}`);
    }
    if (source.kind === 'symlink') {
      if (typeof source.linkTarget !== 'string' || !source.linkTarget) {
        fail(label, `contains a symlink without a target at ${entryPath}`);
      }
    } else if (source.linkTarget != null) {
      fail(label, `contains a link target on a non-symlink at ${entryPath}`);
    }
    inventory.set(entryPath, Object.freeze({
      executable: source.executable === true,
      kind: source.kind,
      linkTarget: source.linkTarget ?? null,
      path: entryPath,
      size: source.size ?? null,
    }));
  }
  return inventory;
}

export function assertZipOuterInventory(entries, label = 'ZIP') {
  const inventory = normalizedInventory(entries, label, 1);
  const application = inventory.get(EXPECTED_MAC_APP_NAME);
  if (!application || application.kind !== 'directory') {
    fail(label, `root must contain only ${EXPECTED_MAC_APP_NAME}`);
  }
  return true;
}

export function assertDmgOuterInventory(entries, label = 'DMG') {
  const inventory = normalizedInventory(entries, label, maxDmgEntries);
  const application = inventory.get(EXPECTED_MAC_APP_NAME);
  if (!application || application.kind !== 'directory') {
    fail(label, `is missing the ${EXPECTED_MAC_APP_NAME} directory`);
  }
  const applicationsLink = inventory.get('Applications');
  if (
    !applicationsLink
    || applicationsLink.kind !== 'symlink'
    || applicationsLink.linkTarget !== '/Applications'
  ) {
    fail(label, 'must contain an Applications symlink to /Applications');
  }

  const backgroundFiles = [];
  for (const entry of inventory.values()) {
    if (entry.path === EXPECTED_MAC_APP_NAME || entry.path === 'Applications') continue;
    if (entry.path === '.background') {
      if (entry.kind !== 'directory') fail(label, '.background must be a directory');
      continue;
    }
    const maximumSize = dmgFileLimits.get(entry.path);
    if (maximumSize == null || entry.kind !== 'file') {
      fail(label, `contains unexpected outer content at ${entry.path}`);
    }
    if (entry.size > maximumSize) fail(label, `contains an oversized file at ${entry.path}`);
    if (entry.path.startsWith('.background/')) backgroundFiles.push(entry.path);
  }

  const backgroundDirectory = inventory.get('.background');
  if (backgroundFiles.length > 0 && !backgroundDirectory) {
    fail(label, 'contains a background image without the .background directory');
  }
  if (backgroundDirectory && backgroundFiles.length === 0) {
    fail(label, 'contains an empty .background directory');
  }
  if (backgroundFiles.length > 2) fail(label, 'contains too many background images');
  return true;
}

function outputText(output, label) {
  if (typeof output !== 'string') fail(label, 'codesign output is not text');
  return output.replaceAll('\r\n', '\n');
}

export function assertAdHocSignature(output, label = 'Mach-O') {
  const text = outputText(output, label);
  if (!/(?:^|\n)Signature=adhoc(?:\n|$)/.test(text)) {
    fail(label, 'is not ad-hoc signed');
  }
  return true;
}

export function assertHardenedRuntime(output, label = 'Mach-O') {
  const text = outputText(output, label);
  const matches = [...text.matchAll(/^CodeDirectory\b[^\n]*\bflags=(0x[\da-f]+)(?:\([^)]*\))?/gim)];
  if (!matches.length) fail(label, 'codesign output is missing CodeDirectory flags');
  for (const match of matches) {
    const flags = Number.parseInt(match[1], 16);
    if (!Number.isSafeInteger(flags) || (flags & hardenedRuntimeFlag) !== hardenedRuntimeFlag) {
      fail(label, 'does not enable the hardened runtime');
    }
  }
  return true;
}

function decodeEntitlementKey(source, label) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(source)) {
    fail(label, 'entitlements contain an unsupported XML entity');
  }
  try {
    return source.replace(
      /&(amp|lt|gt|quot|apos|#(\d+)|#x([\da-f]+));/gi,
      (_match, entity, decimal, hexadecimal) => {
        if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
        if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
        return { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' }[entity.toLowerCase()];
      },
    );
  } catch {
    fail(label, 'entitlements contain an invalid XML entity');
  }
}

export function parseCodeSignEntitlements(output, label = 'Mach-O') {
  const text = outputText(output, label);
  if (/bplist00/.test(text)) fail(label, 'entitlements are not XML');
  const starts = [...text.matchAll(/<plist\b/gi)];
  const ends = [...text.matchAll(/<\/plist>/gi)];
  if (!starts.length && !ends.length) {
    if (/<\/?(?:dict|key)\b/i.test(text)) fail(label, 'entitlements XML is incomplete');
    return Object.freeze([]);
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) {
    fail(label, 'entitlements contain an invalid plist boundary');
  }
  const fragment = text.slice(starts[0].index, ends[0].index + ends[0][0].length);
  if (/^<plist\b[^>]*>\s*<dict\s*\/>\s*<\/plist>$/i.test(fragment)) {
    return Object.freeze([]);
  }
  const document = fragment.match(/^<plist\b[^>]*>\s*<dict\b[^>]*>([\s\S]*?)<\/dict>\s*<\/plist>$/i);
  if (!document) fail(label, 'entitlements plist is not a flat dictionary');

  const entries = [];
  const seen = new Set();
  const pairs = /<key>([^<]*)<\/key>\s*<(true|false)\s*\/>/gi;
  let cursor = 0;
  for (const match of document[1].matchAll(pairs)) {
    if (document[1].slice(cursor, match.index).trim()) {
      fail(label, 'entitlements contain an unsupported value');
    }
    const key = decodeEntitlementKey(match[1], label);
    if (!key) fail(label, 'entitlements contain an empty key');
    if (seen.has(key)) fail(label, `entitlements repeat ${key}`);
    seen.add(key);
    entries.push(Object.freeze({ key, value: match[2].toLowerCase() === 'true' }));
    cursor = match.index + match[0].length;
  }
  if (document[1].slice(cursor).trim()) fail(label, 'entitlements contain an unsupported value');
  return Object.freeze(entries);
}

function entitlementMap(entries, label) {
  if (!Array.isArray(entries)) fail(label, 'entitlements are not an entry list');
  const result = new Map();
  for (const entry of entries) {
    if (typeof entry?.key !== 'string' || typeof entry?.value !== 'boolean' || result.has(entry.key)) {
      fail(label, 'entitlements contain an invalid entry');
    }
    result.set(entry.key, entry.value);
  }
  return result;
}

export function assertExactMainEntitlements(entries, label = 'Main app') {
  const entitlements = entitlementMap(entries, label);
  if (entitlements.size !== DOCUMENTED_MAC_ENTITLEMENTS.length) {
    fail(label, 'does not contain the exact documented entitlements');
  }
  for (const key of DOCUMENTED_MAC_ENTITLEMENTS) {
    if (entitlements.get(key) !== true) fail(label, `does not enable ${key}`);
  }
  return true;
}

export function assertNestedEntitlements(entries, label = 'Nested Mach-O') {
  const entitlements = entitlementMap(entries, label);
  for (const [key, value] of entitlements) {
    if (!documentedEntitlementSet.has(key) || value !== true) {
      fail(label, `contains an unexpected entitlement: ${key}`);
    }
  }
  return true;
}
