import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf("  shadow.addEventListener('change'"), source.indexOf("  shadow.addEventListener('input'"));

function fixture() {
  let change;
  const calls = [];
  vm.runInNewContext(handler, {
    shadow: { addEventListener: (name, callback) => { assert.equal(name, 'change'); change = callback; } },
    importQueue: async file => calls.push(['queue', file]),
    importDmJob: async file => calls.push(['dm', file]),
    renderAll: () => calls.push(['render']), status: value => calls.push(['status', value]),
  });
  return { change, calls };
}

test('nested tool changes are not handled as file imports or cleared', async () => {
  for (const dataset of [{ presence: 'protected' }, { presence: 'allowance' }, { inboxFilter: '' }, { file: 'unknown' }, {}]) {
    const f = fixture();
    const target = { value: 'keep this choice', dataset, matches: () => false };
    await f.change({ target });
    assert.equal(target.value, 'keep this choice');
    assert.deepEqual(f.calls, []);
  }
});

test('only the two existing file inputs are cleared after their import handler settles', async () => {
  for (const kind of ['queue', 'dm']) {
    const f = fixture(); const file = { name: 'fixture.json' };
    const target = { value: 'fixture.json', dataset: { file: kind }, files: [file],
      matches: selector => selector === 'input[type="file"][data-file="queue"], input[type="file"][data-file="dm"]' };
    await f.change({ target });
    assert.equal(target.value, '');
    assert.deepEqual(f.calls, [[kind, file], ['render']]);
  }
});
