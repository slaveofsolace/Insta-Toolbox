import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const metadata = JSON.parse(await read('package.json'));

test('installation keeps userscript updates current and held packages pinned to 4.3.1', async () => {
  const heldVersion = '4.3.1';
  const names = [
    `Insta-Toolbox-Extension-${heldVersion}.zip`,
    `Insta-Toolbox-Setup-${heldVersion}.exe`,
    `Insta-Toolbox-${heldVersion}-universal.dmg`,
    `Insta-Toolbox-${heldVersion}-universal.zip`,
    `insta-toolbox-web-${heldVersion}.zip`,
  ];
  for (const path of ['README.md', 'docs/INSTALLATION.md']) {
    const text = await read(path);
    for (const name of names) {
      assert.ok(text.includes(`releases/download/v${heldVersion}/${name}`), `${path}: ${name}`);
    }
    assert.ok(text.includes('releases/latest/download/insta-toolbox.user.js'));
    assert.ok(text.includes('Tampermonkey is the active update channel'));
    assert.ok(text.includes(`On hold after ${heldVersion}`));
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
