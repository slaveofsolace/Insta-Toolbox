import {
  instagramScriptOrder,
  supportingExtensionFiles,
} from './instagram-script-order.mjs';

export const extensionSourceFiles = Object.freeze([
  ...instagramScriptOrder,
  ...supportingExtensionFiles,
]);

export const extensionLibraryFiles = Object.freeze([
  'bridge-protocol.js',
  'controlled-account-action.js',
  'controlled-dm-unsend.js',
]);

export const extensionLegalFiles = Object.freeze([
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
]);

export const extensionIcons = Object.freeze({
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
});

export const extensionIconFiles = Object.freeze(Object.values(extensionIcons));

// This inventory is shared by the producer and release verifier. A generated
// archive must contain every entry here exactly once and no other files.
export const expectedExtensionArchiveEntries = Object.freeze([
  ...extensionSourceFiles,
  ...extensionIconFiles,
  ...extensionLibraryFiles.map((file) => `lib/${file}`),
  ...extensionLegalFiles,
].sort());
