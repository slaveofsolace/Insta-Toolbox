import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const metadata = JSON.parse(await read('package.json'));

test('installation download links match the package release version', async () => {
  const names = [
    `Insta-Toolbox-Extension-${metadata.version}.zip`,
    `Insta-Toolbox-Setup-${metadata.version}.exe`,
    `Insta-Toolbox-${metadata.version}-universal.dmg`,
    `insta-toolbox-web-${metadata.version}.zip`,
    'insta-toolbox.user.js',
  ];
  for (const path of ['README.md', 'docs/INSTALLATION.md']) {
    const text = await read(path);
    for (const name of names) {
      assert.ok(text.includes(`releases/latest/download/${name}`), `${path}: ${name}`);
    }
    assert.ok(text.includes('Allow User Scripts'));
    assert.ok(text.includes(`acceptance/${metadata.version}.md`));
    assert.ok(text.includes(`compatibility/${metadata.version}.md`));
  }
});

test('release promotion matches the source version and retains exact-artifact validation', async () => {
  const workflow = await read('.github/workflows/release.yml');
  assert.ok(workflow.includes(`test "$version" = "${metadata.version}"`));
  assert.ok(workflow.includes('sha256sum --check --strict SHA256SUMS.txt'));
  assert.ok(workflow.includes('CI run is not for the current main commit'));
  const source = await read('userscripts/src/toolbox-shell.js');
  assert.ok(source.includes('grid-template-columns: minmax(0,1fr); min-width: 0;'));
  assert.ok(source.includes('.field > input:not([type="checkbox"]), .field > select'));
});
