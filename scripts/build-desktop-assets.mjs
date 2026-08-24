import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(modulePath), '..');

export const WINDOWS_ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);
export const EXTENSION_ICON_SIZES = Object.freeze([16, 32, 48, 128]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/([\w:-]+)=(["'])(.*?)\2/g)) {
    result[match[1]] = match[3];
  }
  return result;
}

function numberAttribute(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function color(value) {
  const match = String(value || '').match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i);
  if (!match) throw new Error(`Desktop icon uses an unsupported fill: ${value || 'missing'}.`);
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
    match[4] ? Number.parseInt(match[4], 16) : 255,
  ];
}

export function parseIconSvg(source) {
  const svg = String(source || '');
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (!root) throw new Error('Desktop icon SVG is missing its root element.');
  const rootAttributes = attributes(root[1]);
  const viewBox = String(rootAttributes.viewBox || '').trim().split(/\s+/).map(Number);
  if (
    viewBox.length !== 4
    || viewBox.some((entry) => !Number.isFinite(entry))
    || viewBox[0] !== 0
    || viewBox[1] !== 0
    || viewBox[2] <= 0
    || viewBox[3] <= 0
  ) {
    throw new Error('Desktop icon SVG needs a positive zero-origin viewBox.');
  }

  const rectangles = [...svg.matchAll(/<rect\b([^>]*)\/?\s*>/gi)].map((match) => {
    const values = attributes(match[1]);
    const rectangle = {
      x: numberAttribute(values.x, 0),
      y: numberAttribute(values.y, 0),
      width: numberAttribute(values.width),
      height: numberAttribute(values.height),
      color: color(values.fill),
    };
    if (
      Object.values(rectangle).slice(0, 4).some((entry) => entry == null)
      || rectangle.width <= 0
      || rectangle.height <= 0
      || rectangle.x < 0
      || rectangle.y < 0
      || rectangle.x + rectangle.width > viewBox[2]
      || rectangle.y + rectangle.height > viewBox[3]
    ) {
      throw new Error('Desktop icon SVG contains an invalid rectangle.');
    }
    return rectangle;
  });
  if (!rectangles.length) throw new Error('Desktop icon SVG needs at least one rectangle.');
  return Object.freeze({ width: viewBox[2], height: viewBox[3], rectangles });
}

function overlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function iconPixels(design, size) {
  if (!Number.isInteger(size) || size < 1 || size > 1024) {
    throw new Error('Desktop icon size must be an integer from 1 through 1024.');
  }
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  const sourceWidth = design.width / size;
  const sourceHeight = design.height / size;
  const sourceArea = sourceWidth * sourceHeight;

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    scanlines[row] = 0;
    const top = y * sourceHeight;
    const bottom = top + sourceHeight;
    for (let x = 0; x < size; x += 1) {
      const left = x * sourceWidth;
      const right = left + sourceWidth;
      let output = [0, 0, 0, 0];
      for (const rectangle of design.rectangles) {
        const covered = (
          overlap(left, right, rectangle.x, rectangle.x + rectangle.width)
          * overlap(top, bottom, rectangle.y, rectangle.y + rectangle.height)
        ) / sourceArea;
        if (covered <= 0) continue;
        const sourceAlpha = (rectangle.color[3] / 255) * covered;
        const destinationAlpha = output[3] / 255;
        const nextAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
        if (nextAlpha <= 0) continue;
        output = [
          ((rectangle.color[0] * sourceAlpha) + (output[0] * destinationAlpha * (1 - sourceAlpha))) / nextAlpha,
          ((rectangle.color[1] * sourceAlpha) + (output[1] * destinationAlpha * (1 - sourceAlpha))) / nextAlpha,
          ((rectangle.color[2] * sourceAlpha) + (output[2] * destinationAlpha * (1 - sourceAlpha))) / nextAlpha,
          nextAlpha * 255,
        ];
      }
      const index = row + 1 + x * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        scanlines[index + channel] = Math.round(output[channel]);
      }
    }
  }
  return scanlines;
}

export function renderIconPng(svgSource, size) {
  const design = typeof svgSource === 'string' ? parseIconSvg(svgSource) : svgSource;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(iconPixels(design, size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function createWindowsIco(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Windows ICO needs PNG entries.');
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;
  const images = [];
  entries.forEach(({ size, png }, index) => {
    if (!Number.isInteger(size) || size < 1 || size > 256 || !Buffer.isBuffer(png)) {
      throw new Error('Windows ICO entries need a 1-256 size and PNG buffer.');
    }
    const entry = index * 16;
    directory[entry] = size === 256 ? 0 : size;
    directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
    images.push(png);
  });
  return Buffer.concat([header, directory, ...images]);
}

export async function buildDesktopAssets(root = repositoryRoot) {
  const resolvedRoot = path.resolve(root);
  const outputRoot = path.join(resolvedRoot, 'dist', 'branding');
  const assetsRoot = path.join(resolvedRoot, 'assets');
  const extensionIconsRoot = path.join(resolvedRoot, 'extension', 'icons');
  const resolvedOutput = path.resolve(outputRoot);
  const resolvedDist = path.resolve(resolvedRoot, 'dist');
  if (!resolvedOutput.startsWith(`${resolvedDist}${path.sep}`)) {
    throw new Error('Desktop branding output must remain inside the repository dist directory.');
  }

  const svgSource = await readFile(path.join(assetsRoot, 'icon.svg'), 'utf8');
  const design = parseIconSvg(svgSource);
  await mkdir(outputRoot, { recursive: true });
  await mkdir(assetsRoot, { recursive: true });
  await mkdir(extensionIconsRoot, { recursive: true });

  const windowsEntries = WINDOWS_ICON_SIZES.map((size) => ({
    size,
    png: renderIconPng(design, size),
  }));
  await writeFile(path.join(outputRoot, 'icon.png'), renderIconPng(design, 1024));
  await writeFile(path.join(outputRoot, 'icon.ico'), createWindowsIco(windowsEntries));
  await writeFile(path.join(assetsRoot, 'icon-512.png'), renderIconPng(design, 512));
  await writeFile(path.join(assetsRoot, 'icon-192.png'), renderIconPng(design, 192));
  for (const size of EXTENSION_ICON_SIZES) {
    await writeFile(path.join(extensionIconsRoot, `icon-${size}.png`), renderIconPng(design, size));
  }
  console.log(`Built desktop and extension icons from assets/icon.svg in ${path.relative(resolvedRoot, outputRoot)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  await buildDesktopAssets();
}
