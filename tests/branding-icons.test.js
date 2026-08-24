import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createWindowsIco,
  EXTENSION_ICON_SIZES,
  parseIconSvg,
  renderIconPng,
  WINDOWS_ICON_SIZES,
} from '../scripts/build-desktop-assets.mjs';

const pngSignature = '89504e470d0a1a0a';
const expectedExtensionIcons = Object.freeze(Object.fromEntries(
  EXTENSION_ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`]),
));

const svgSource = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(
  new URL('../extension/manifest.json', import.meta.url),
  'utf8',
));
const metadata = await readFile(
  new URL('../userscripts/src/metadata.txt', import.meta.url),
  'utf8',
);

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), pngSignature);
  assert.ok(buffer.length >= 24, 'PNG must contain an IHDR chunk');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function icoEntries(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const size = buffer[entry] || 256;
    assert.equal(buffer[entry + 1] || 256, size);
    assert.equal(buffer.readUInt16LE(entry + 4), 1);
    assert.equal(buffer.readUInt16LE(entry + 6), 32);
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    const png = buffer.subarray(offset, offset + length);
    assert.deepEqual(pngDimensions(png), { width: size, height: size });
    return { size, png };
  });
}

test('the canonical Insta Toolbox mark is deterministic and rectangular', () => {
  assert.match(svgSource, /viewBox="0 0 1024 1024"/);
  assert.doesNotMatch(svgSource, /<(?:circle|ellipse|path)\b/i);
  assert.match(svgSource, /#101114/i);
  assert.match(svgSource, /#b83d67/i);
  assert.match(svgSource, /#f4f1e8/i);
  assert.equal(parseIconSvg(svgSource).rectangles.length, 6);

  const first = renderIconPng(svgSource, 1024);
  const second = renderIconPng(svgSource, 1024);
  assert.deepEqual(first, second);
  assert.deepEqual(pngDimensions(first), { width: 1024, height: 1024 });
});

test('PWA and extension PNGs are exact canonical renders at their declared sizes', async () => {
  for (const size of [192, 512]) {
    const png = await readFile(new URL(`../assets/icon-${size}.png`, import.meta.url));
    assert.deepEqual(pngDimensions(png), { width: size, height: size });
    assert.deepEqual(png, renderIconPng(svgSource, size));
  }

  for (const size of EXTENSION_ICON_SIZES) {
    const png = await readFile(new URL(`../extension/icons/icon-${size}.png`, import.meta.url));
    assert.deepEqual(pngDimensions(png), { width: size, height: size });
    assert.deepEqual(png, renderIconPng(svgSource, size));
  }
});

test('the Windows ICO contains a real PNG entry for every 16 through 256 target', () => {
  const ico = createWindowsIco(WINDOWS_ICON_SIZES.map((size) => ({
    size,
    png: renderIconPng(svgSource, size),
  })));
  const entries = icoEntries(ico);
  assert.deepEqual(entries.map(({ size }) => size), WINDOWS_ICON_SIZES);
  assert.equal(entries.some(({ size }) => size === 16), true);
  assert.equal(entries.some(({ size }) => size === 256), true);
});

test('extension and userscript surfaces declare the same canonical utility mark', () => {
  assert.deepEqual(manifest.icons, expectedExtensionIcons);
  assert.deepEqual(manifest.action.default_icon, expectedExtensionIcons);

  const iconLine = metadata
    .split(/\r?\n/)
    .find((line) => line.startsWith('// @icon '));
  const iconPrefix = 'data:image/svg+xml,';
  const iconValue = iconLine?.slice(iconLine.indexOf(iconPrefix)).trim();
  const encodedIcon = iconValue?.startsWith(iconPrefix)
    ? iconValue.slice(iconPrefix.length)
    : '';
  assert.ok(encodedIcon, 'userscript metadata must contain an embedded SVG icon');
  assert.deepEqual(
    parseIconSvg(decodeURIComponent(encodedIcon)),
    parseIconSvg(svgSource),
  );
});
