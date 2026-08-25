const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readPngDimensions(value) {
  const png = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (png.length < 33 || !png.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('Screenshot is not a readable PNG.');
  }
  if (png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Screenshot PNG is missing its IHDR dimensions.');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error(`Screenshot PNG has invalid ${width}x${height} dimensions.`);
  }
  return { width, height };
}

export function assertPngDimensions(value, expected, label = 'Screenshot') {
  const actual = readPngDimensions(value);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `${label}: PNG is ${actual.width}x${actual.height}; expected exactly ${expected.width}x${expected.height}.`,
    );
  }
  return actual;
}
