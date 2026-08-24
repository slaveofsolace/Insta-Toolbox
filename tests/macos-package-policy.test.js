import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENTED_MAC_ENTITLEMENTS,
  EXPECTED_MAC_APP_NAME,
  assertAdHocSignature,
  assertDmgOuterInventory,
  assertExactMainEntitlements,
  assertHardenedRuntime,
  assertNestedEntitlements,
  assertZipOuterInventory,
  parseCodeSignEntitlements,
} from '../scripts/macos-package-policy.mjs';

const runtimeDisplay = [
  'Executable=/tmp/Insta Toolbox',
  'CodeDirectory v=20500 size=1234 flags=0x10002(adhoc,runtime) hashes=32+7 location=embedded',
  'Signature=adhoc',
].join('\n');

const documentedEntitlementsXml = `
noise before plist
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>${DOCUMENTED_MAC_ENTITLEMENTS[2]}</key>
  <true/>
  <key>${DOCUMENTED_MAC_ENTITLEMENTS[0]}</key>
  <true/>
  <key>${DOCUMENTED_MAC_ENTITLEMENTS[1]}</key>
  <true/>
</dict>
</plist>
noise after plist
`;

function file(path, size = 1_024, executable = false) {
  return { executable, kind: 'file', path, size };
}

function standardDmgInventory() {
  return [
    { kind: 'directory', path: EXPECTED_MAC_APP_NAME },
    { kind: 'symlink', linkTarget: '/Applications', path: 'Applications' },
    file('.DS_Store'),
    file('.VolumeIcon.icns'),
    file('.background.tiff'),
  ];
}

test('ZIP policy accepts only the expected application at archive root', () => {
  assert.equal(assertZipOuterInventory([
    { kind: 'directory', path: EXPECTED_MAC_APP_NAME },
  ]), true);
  assert.throws(
    () => assertZipOuterInventory([
      { kind: 'directory', path: EXPECTED_MAC_APP_NAME },
      file('Install.command', 12, true),
    ]),
    /inventory must contain 1-1 entries/,
  );
  assert.throws(
    () => assertZipOuterInventory([
      { kind: 'symlink', linkTarget: '/Applications/Insta Toolbox.app', path: EXPECTED_MAC_APP_NAME },
    ]),
    /root must contain only/,
  );
});

test('DMG policy accepts the app, Applications link, and bounded known metadata', () => {
  assert.equal(assertDmgOuterInventory(standardDmgInventory()), true);
  assert.equal(assertDmgOuterInventory([
    { kind: 'directory', path: EXPECTED_MAC_APP_NAME },
    { kind: 'symlink', linkTarget: '/Applications', path: 'Applications' },
    file('.DS_Store'),
  ]), true);
  assert.equal(assertDmgOuterInventory([
    { kind: 'directory', path: EXPECTED_MAC_APP_NAME },
    { kind: 'symlink', linkTarget: '/Applications', path: 'Applications' },
    { kind: 'directory', path: '.background' },
    file('.background/background.tiff'),
  ]), true);
});

test('DMG policy rejects wrong, extra, executable, and oversized outer content', () => {
  const wrongLink = standardDmgInventory();
  wrongLink[1] = { kind: 'symlink', linkTarget: '/tmp/Applications', path: 'Applications' };
  assert.throws(() => assertDmgOuterInventory(wrongLink), /symlink to \/Applications/);

  assert.throws(
    () => assertDmgOuterInventory([...standardDmgInventory(), file('Installer.pkg')]),
    /unexpected outer content/,
  );
  assert.throws(
    () => assertDmgOuterInventory([...standardDmgInventory(), {
      kind: 'symlink', linkTarget: '/tmp/helper', path: 'Helper',
    }]),
    /unexpected outer content/,
  );

  const executableMetadata = standardDmgInventory();
  executableMetadata[2] = file('.DS_Store', 1_024, true);
  assert.throws(() => assertDmgOuterInventory(executableMetadata), /executable outer content/);

  const oversizedIcon = standardDmgInventory();
  oversizedIcon[3] = file('.VolumeIcon.icns', (16 * 1024 * 1024) + 1);
  assert.throws(() => assertDmgOuterInventory(oversizedIcon), /oversized file/);
});

test('DMG policy rejects malformed background inventories and duplicate paths', () => {
  assert.throws(
    () => assertDmgOuterInventory([
      { kind: 'directory', path: EXPECTED_MAC_APP_NAME },
      { kind: 'symlink', linkTarget: '/Applications', path: 'Applications' },
      { kind: 'directory', path: '.background' },
    ]),
    /empty \.background directory/,
  );
  assert.throws(
    () => assertDmgOuterInventory([...standardDmgInventory(), file('.background/payload.sh')]),
    /unexpected outer content/,
  );
  assert.throws(
    () => assertDmgOuterInventory([...standardDmgInventory(), file('.DS_Store')]),
    /duplicate path/,
  );
  assert.throws(
    () => assertDmgOuterInventory([
      { kind: 'directory', path: EXPECTED_MAC_APP_NAME },
      { kind: 'symlink', linkTarget: '/Applications', path: 'Applications' },
      file('../outside'),
    ]),
    /invalid path/,
  );
});

test('codesign display policy requires ad-hoc signing and the runtime bit', () => {
  assert.equal(assertAdHocSignature(runtimeDisplay), true);
  assert.equal(assertHardenedRuntime(runtimeDisplay), true);
  assert.throws(
    () => assertAdHocSignature(runtimeDisplay.replace('Signature=adhoc', 'Signature=Developer ID')),
    /not ad-hoc signed/,
  );
  assert.throws(
    () => assertHardenedRuntime(runtimeDisplay.replace('0x10002', '0x2')),
    /does not enable the hardened runtime/,
  );
  assert.throws(() => assertHardenedRuntime('Signature=adhoc'), /missing CodeDirectory flags/);
});

test('entitlement parser handles mixed codesign output and empty entitlement sets', () => {
  const parsed = parseCodeSignEntitlements(documentedEntitlementsXml);
  assert.deepEqual(parsed.map(({ key, value }) => [key, value]), [
    [DOCUMENTED_MAC_ENTITLEMENTS[2], true],
    [DOCUMENTED_MAC_ENTITLEMENTS[0], true],
    [DOCUMENTED_MAC_ENTITLEMENTS[1], true],
  ]);
  assert.deepEqual(parseCodeSignEntitlements('Executable=/tmp/helper\n'), []);
  assert.deepEqual(parseCodeSignEntitlements('<plist version="1.0"><dict/></plist>'), []);
});

test('entitlement parser rejects binary, nested, duplicate, and incomplete values', () => {
  assert.throws(() => parseCodeSignEntitlements('bplist00'), /not XML/);
  assert.throws(
    () => parseCodeSignEntitlements('<plist><dict><key>x</key><string>y</string></dict></plist>'),
    /unsupported value/,
  );
  assert.throws(
    () => parseCodeSignEntitlements('<plist><dict><key>x</key><true/><key>x</key><true/></dict></plist>'),
    /repeat x/,
  );
  assert.throws(() => parseCodeSignEntitlements('<plist><dict>'), /invalid plist boundary/);
});

test('main entitlement policy requires exactly the three documented true keys', () => {
  const parsed = parseCodeSignEntitlements(documentedEntitlementsXml);
  assert.equal(assertExactMainEntitlements(parsed), true);
  assert.throws(
    () => assertExactMainEntitlements(parsed.slice(1)),
    /exact documented entitlements/,
  );
  assert.throws(
    () => assertExactMainEntitlements([...parsed, {
      key: 'com.apple.security.cs.allow-dyld-environment-variables', value: true,
    }]),
    /exact documented entitlements/,
  );
  assert.throws(
    () => assertExactMainEntitlements(parsed.map((entry, index) => (
      index === 0 ? { ...entry, value: false } : entry
    ))),
    /does not enable/,
  );
});

test('nested Mach-O policy permits only documented true entitlement subsets', () => {
  assert.equal(assertNestedEntitlements([]), true);
  assert.equal(assertNestedEntitlements([
    { key: DOCUMENTED_MAC_ENTITLEMENTS[0], value: true },
  ]), true);
  assert.throws(
    () => assertNestedEntitlements([{
      key: 'com.apple.security.get-task-allow', value: true,
    }]),
    /unexpected entitlement/,
  );
  assert.throws(
    () => assertNestedEntitlements([{
      key: DOCUMENTED_MAC_ENTITLEMENTS[0], value: false,
    }]),
    /unexpected entitlement/,
  );
});
