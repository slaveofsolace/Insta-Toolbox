import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const tokensSource = await readFile(new URL('../extension/overlay/tokens.js', import.meta.url), 'utf8');
const actionLabels = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
const overlayShell = await readFile(new URL('../extension/overlay/shell.js', import.meta.url), 'utf8');
const toolboxShell = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const generated = await readFile(new URL('../userscripts/insta-toolbox.user.js', import.meta.url), 'utf8');
const designDoc = await readFile(new URL('../docs/DESIGN_SYSTEM.md', import.meta.url), 'utf8');

function loadTokens() {
  const context = vm.createContext({ Object });
  vm.runInContext(tokensSource, context, { filename: 'tokens.js' });
  return context.InstaToolboxTokens;
}

test('every documented colour role exists and keeps the Toolbox accent canonical', () => {
  const tokens = loadTokens();
  const palette = tokens.palette();
  for (const role of [
    '--insta-toolbox-bg', '--insta-toolbox-bg-raised', '--insta-toolbox-bg-sunken',
    '--insta-toolbox-text', '--insta-toolbox-text-muted', '--insta-toolbox-line',
    '--insta-toolbox-accent', '--insta-toolbox-success', '--insta-toolbox-warning',
    '--insta-toolbox-danger', '--insta-toolbox-uncertain', '--insta-toolbox-focus',
  ]) {
    assert.ok(role in palette, `${role} is documented but missing`);
  }
  // Instagram's variable is consulted first, with a fallback, so a renamed
  // Instagram token degrades to something readable instead of unstyled.
  for (const role of ['--insta-toolbox-bg', '--insta-toolbox-text', '--insta-toolbox-line']) {
    assert.match(palette[role], /var\(--ig-[a-z-]+,\s*[^)]+\)/, `${role} needs an Instagram source and a fallback`);
  }
  assert.equal(palette['--insta-toolbox-accent'], '#b83d67');
  assert.equal(palette['--insta-toolbox-focus'], '#b83d67');
});

test('an uncertain outcome is not coloured as a failure', () => {
  // Uncertain means the action may have succeeded. Reusing the danger colour
  // would assert something the tool cannot prove.
  const palette = loadTokens().palette();
  assert.notEqual(palette['--insta-toolbox-uncertain'], palette['--insta-toolbox-danger']);
});

test('compact density trims spacing without shrinking hit targets or type', () => {
  const tokens = loadTokens();
  const roomy = tokens.scale('comfortable');
  const tight = tokens.scale('compact');
  assert.notEqual(roomy['--insta-toolbox-pad-y'], tight['--insta-toolbox-pad-y'], 'compact should be denser');
  assert.equal(roomy['--insta-toolbox-target'], tight['--insta-toolbox-target'], 'targets must not shrink');
  assert.equal(roomy['--insta-toolbox-target'], '44px');
  for (const step of ['--insta-toolbox-text-md', '--insta-toolbox-text-sm', '--insta-toolbox-text-xs']) {
    assert.equal(roomy[step], tight[step], `${step} must not shrink in compact density`);
  }
});

test('spacing stays on the documented 4px scale', () => {
  const scale = loadTokens().scale('comfortable');
  for (const step of ['--insta-toolbox-space-1', '--insta-toolbox-space-2', '--insta-toolbox-space-3', '--insta-toolbox-space-4', '--insta-toolbox-space-5', '--insta-toolbox-space-6']) {
    const pixels = Number(String(scale[step]).replace('px', ''));
    assert.equal(pixels % 4, 0, `${step} is off the 4px scale`);
  }
});

test('emitted css carries reduced-motion and forced-colors handling', () => {
  const css = loadTokens().css();
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /outline-color: Highlight/);
  assert.match(css, /background: Canvas/);
  // Focus is repositioned, never removed.
  assert.match(css, /:focus-visible\s*\{[^}]*outline: 2px solid var\(--insta-toolbox-focus\)/);
});

test('both surfaces ship the tokens rather than a private palette', () => {
  // The generated bundle must contain the token module, or the userscript
  // silently falls back to its own colours and the two drift again.
  assert.ok(generated.includes(tokensSource.trim()), 'tokens are embedded in the userscript bundle');
  assert.match(generated, /InstaToolboxTokens/);
  assert.match(toolboxShell, /InstaToolboxTokens\?\.css\(\{ density: 'compact' \}\)/);
  assert.doesNotMatch(actionLabels, /--insta-toolbox-instagram-/);
});

test('the design system documents the roles the code actually defines', () => {
  const tokens = loadTokens();
  for (const role of tokens.roles) {
    assert.ok(designDoc.includes(role), `${role} exists in code but is undocumented`);
  }
  for (const state of [
    'primary', 'secondary', 'quiet', 'warning', 'destructive', 'success',
    'selected', 'disabled', 'locked', 'armed', 'running', 'paused',
    'stopped', 'uncertain',
  ]) {
    assert.ok(designDoc.includes(`\`${state}\``), `state ${state} is undocumented`);
  }
});

test('the shared surfaces are wired to the token module', () => {
  // Guards the intent of this pass: neither shell should be reintroducing a
  // parallel palette. Recorded as counts so a regression is visible.
  const literals = (source) => (source.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length
    + (source.match(/rgba?\([^)]*\)/g) || []).length;
  assert.ok(
    literals(overlayShell) + literals(toolboxShell) < 130,
    'colour literals grew; add a role to tokens.js instead',
  );
});
