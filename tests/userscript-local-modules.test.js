import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { bundleLocalModules } from '../scripts/lib/bundle-local-modules.mjs';

test('local userscript modules preserve private scopes and named import bindings', () => {
  const source = {
    'a/base.js': 'const value = 7;\nexport function read() { return value; }',
    'a/main.js': "import { read as baseRead } from './base.js';\nconst value = 3;\nexport const result = value + baseRead();",
  };
  const code = bundleLocalModules(source, ['a/main.js']);
  assert.equal(vm.runInNewContext(`${code}\nlocalModules['a/main.js'].result`), 10);
  assert.equal(code, bundleLocalModules(source, ['a/main.js']));
});

test('unsupported, missing, circular, and external imports fail the build', () => {
  for (const sources of [
    { 'a.js': "import { x } from 'external';" },
    { 'a.js': "import x from './b.js';", 'b.js': 'export const x = 1;' },
    { 'a.js': "import { x } from './missing.js';" },
    { 'a.js': "import { x } from './b.js';", 'b.js': "import { y } from './a.js';" },
  ]) assert.throws(() => bundleLocalModules(sources, ['a.js']));
});

test('native inbox modules bundle without network loaders or leaked private bindings', async () => {
  const ids = ['inbox-discovery', 'inbox-native-navigation', 'inbox-coordinator', 'inbox-userscript-discovery', 'inbox-single-tab', 'inbox-userscript-panel', 'inbox-checkpoint-store'];
  const sources = Object.fromEntries(await Promise.all(ids.map(async id => {
    const path = `extension/${id}.js`;
    return [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')];
  })));
  const code = bundleLocalModules(sources, ['extension/inbox-userscript-panel.js', 'extension/inbox-checkpoint-store.js']);
  const context = vm.createContext({ structuredClone });
  vm.runInContext(code, context);
  assert.equal(vm.runInContext("typeof localModules['extension/inbox-userscript-discovery.js'].createUserscriptInboxDiscovery", context), 'function');
  assert.equal(vm.runInContext("typeof localModules['extension/inbox-userscript-panel.js'].mountUserscriptInboxPanel", context), 'function');
  assert.equal(vm.runInContext("typeof localModules['extension/inbox-checkpoint-store.js'].createInboxCheckpointStore", context), 'function');
  assert.equal(vm.runInContext('typeof ORIGIN', context), 'undefined');
  assert.doesNotMatch(code, /import\s*\(/);
});
