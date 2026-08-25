const TEXT_ENTRY = /(?:^LICENSE$|\.(?:js|json|md)$)/i;

export function canonicalizeExtensionEntry(relativePath, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!TEXT_ENTRY.test(relativePath)) return buffer;
  return Buffer.from(buffer.toString('utf8').replace(/\r\n?/g, '\n'));
}
