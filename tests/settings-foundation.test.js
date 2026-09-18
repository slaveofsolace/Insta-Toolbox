import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [shell, messages, entry, cleanup, shared, preferences, userscript] = await Promise.all([
  read('extension/overlay/shell.js'),
  read('extension/overlay/views/messages.js'),
  read('extension/instagram-overlay.js'),
  read('extension/cleanup-settings.js'),
  read('extension/overlay/shared.js'),
  read('extension/overlay/preferences.js'),
  read('userscripts/src/toolbox-shell.js'),
]);

test('userscript settings use a responsive appearance grid and one dialog scroll owner', () => {
  assert.match(userscript, /class="settings-appearance-grid"/);
  assert.match(userscript, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,160px\),1fr\)\)/);
  assert.match(userscript, /\.settings-heading h2 \{[^}]+system-ui, sans-serif/);
  assert.match(userscript, /\.settings-section select,[^}]+min-height:44px/);
  const styles = userscript.match(/\.settings-dialog \{[\s\S]*?(?=@keyframes)/)?.[0];
  assert.ok(styles);
  assert.equal([...styles.matchAll(/overflow:\s*auto/g)].length, 1);
});

test('message selection changes do not fall through to file-input clearing', () => {
  assert.match(userscript, /event\.target\.matches\('\[data-role="unsend-scope"\], \[data-role="unsend-count"\]'\)[\s\S]*?renderDmSummary\(\);\s*return;/);
  assert.doesNotMatch(userscript, /unsend-speed|default-speed/);
});

test('userscript fields group labels tightly without shrinking controls or crowding disclosures', () => {
  assert.match(userscript, /\.field \{[^}]+gap: 8px;[^}]+margin: 16px 0/);
  assert.match(userscript, /\.field label \{ display: block; line-height: 20px; \}/);
  assert.match(userscript, /input:not\(\[type="range"\]\):not\(\[type="checkbox"\]\), select, textarea \{ min-height: 44px/);
  assert.match(userscript, /\.view > \.settings-inline \{ margin-bottom: 16px; \}/);
  assert.match(userscript, /\.settings-section \.settings-inline > :not\(summary\) \{ margin-top:12px; \}/);
  assert.match(userscript, /\.setting-option \{ display:grid; gap:4px; \}/);
});

test('userscript cleanup copy stays concise and reaction cleanup is selectable', () => {
  assert.doesNotMatch(userscript, /for="insta-toolbox-unsend-scope">Messages<\/label>/);
  assert.match(userscript, /id="insta-toolbox-unsend-scope"[^>]*aria-label="Messages to unsend"/);
  assert.match(userscript, /for="insta-toolbox-default-limit">Message count<\/label>/);
  assert.match(userscript, /data-cleanup-preference="removeOwnReactions"[^>]*> Remove my reactions afterward<\/label><p[^>]+hidden><\/p>/);
  assert.doesNotMatch(userscript, /<input[^>]+data-cleanup-preference="removeOwnReactions"[^>]+disabled/);
  assert.match(userscript, /label: 'Messages', value: scope/);
  assert.match(userscript, /conversation or message selection changed after review/);
  assert.doesNotMatch(userscript, /Own-reaction removal has not been verified|<strong>DM Unsend\.<\/strong>|>Scope<\/label>|>Default N<\/label>/);
  assert.match(userscript, />Open in background<\/option>/);
  assert.match(userscript, />Tabs to prepare<\/label>/);
  assert.doesNotMatch(userscript, /Multiple tabs are not available yet|Background — not available yet/);
});

test('userscript disclosure text paints with its selected theme and system contrast colors', () => {
  assert.match(userscript, /\.settings-inline > summary \{[^}]+color: var\(--insta-toolbox-text, #1b211c\); -webkit-text-fill-color: currentColor;/);
  assert.match(userscript, /@media \(forced-colors: active\) \{ \.settings-inline > summary \{ color: CanvasText; \} \}/);
});

test('tool views leave configurable panel blur to the shell', () => {
  assert.match(shell, /backdrop-filter: blur\(var\(--insta-toolbox-backdrop-blur\)\)/);
  assert.match(shell, /data-blur="none"[^}]+--insta-toolbox-backdrop-blur: 0px/);
  assert.match(shell, /data-blur="strong"[^}]+--insta-toolbox-backdrop-blur: 18px/);
  assert.doesNotMatch(messages, /(?:-webkit-)?backdrop-filter\s*:/);
});

test('geometry-only reset does not change appearance or local data', () => {
  const body = entry.match(/'reset-layout': \(\) => savePreference\(\{([\s\S]*?)\}\)/)?.[1];
  assert.ok(body);
  const patch = vm.runInNewContext(`({${body}})`);
  assert.deepEqual(JSON.parse(JSON.stringify(patch)), {
    panelHeight: null, panelWidth: null, position: null, launcherPosition: null,
  });
});

test('settings group real controls and explain unavailable cleanup capabilities', () => {
  for (const label of ['Appearance', 'Cleanup defaults', 'Execution', 'Data and troubleshooting']) {
    assert.ok(shell.includes(`>${label}</`), `missing ${label}`);
  }
  assert.match(shell, /data-insta-toolbox-action="reset-appearance"/);
  assert.match(shell, /data-insta-toolbox-role="layout-size"/);
  assert.doesNotMatch(shell, /id="insta-toolbox-pref-width"/);
  assert.doesNotMatch(shell, /unsend-speed|cleanup-speed|<option value="fast"/);
  assert.match(shell, /<option value="background" disabled>/);
  assert.match(shell, /disabled data-insta-toolbox-cleanup-preference="removeOwnReactions" aria-describedby=/);
  assert.match(shell, /disabled data-insta-toolbox-cleanup-preference="workerCount" aria-describedby=/);
});

test('shared appearance normalization preserves saved extension choices and geometry', () => {
  const context = vm.createContext({});
  for (const source of [cleanup, shared, preferences]) vm.runInContext(source, context);
  const result = context.__instaToolboxOverlayModules.preferences.normalize({
    theme: 'dark', density: 'compact', blur: 'none', accent: 'blue', opacity: .73,
    launcherSize: 'large', panelWidth: 417, panelHeight: 623,
    position: { x: 18, y: 29 }, launcherPosition: { x: 41, y: 52 },
  });
  assert.equal(result.theme, 'dark');
  assert.equal(result.density, 'compact');
  assert.equal(result.blur, 'none');
  assert.equal(result.opacity, .73);
  assert.equal(result.panelWidth, 417);
  assert.equal(result.panelHeight, 623);
  assert.deepEqual(JSON.parse(JSON.stringify(result.position)), { x: 18, y: 29 });
  assert.equal('speed' in result, false, 'appearance and cleanup stores remain separate');
});

function messageView(runner) {
  const context = vm.createContext({
    console, Date, clearTimeout, setTimeout,
    location: { pathname: '/direct/t/test-thread/' },
    InstaToolboxDmThreadUnsender: runner,
  });
  vm.runInContext(shared, context);
  vm.runInContext(messages, context);
  return context.__instaToolboxOverlayModules.messagesView;
}

test('tampering with the confirmed pacing cannot reserve or dispatch', async () => {
  let request;
  let reserved = 0;
  let started = 0;
  const statuses = [];
  const view = messageView({
    subscribe: () => () => {},
    snapshot: () => ({ status: 'idle', canStop: false }),
    inspect: () => ({ ready: true, threadId: 'test-thread' }),
    createPlan: value => ({ ...value, version: 3, reviewedDigest: 'a1b2c3d4' }),
    start: () => { started += 1; },
  });
  await view.massUnsend({
    model: {}, shadow: { append() {} }, document: { createElement: () => ({}) },
    query(selector) {
      if (selector.endsWith('="unsend-scope"]')) return { value: 'all' };
      return null;
    },
    confirmAction: async value => {
      request = value;
      return { ...value.binding, speed: 'fast' };
    },
    sendBridge: () => { reserved += 1; },
    status: value => statuses.push(value),
    setText() {},
  });
  assert.equal(request.binding.speed, 'standard');
  assert.equal(request.facts.some(fact => fact.label === 'Speed'), false);
  assert.equal(reserved, 0);
  assert.equal(started, 0);
  assert.match(statuses.at(-1), /settings changed after review/);
});

test('summary preference hides only completed extras and keeps verified counts and interruptions', () => {
  const view = messageView({ snapshot: () => ({ status: 'idle' }) });
  const nodes = { title: {}, copy: {}, badge: { dataset: {} }, detail: {} };
  const progress = { hidden: false, querySelector: selector => selector.includes('title') ? nodes.title : nodes.copy };
  const disclosure = { querySelector: selector => selector === '.insta-toolbox-direct-unsend-progress' ? progress : null };
  const runtime = {
    model: {
      cleanupPreferences: { showSummary: false },
      threadUnsend: { status: 'completed', processed: 9, failed: 0, message: '9 unsent', canStop: false },
    },
    document: { createElement: () => ({}) }, shadow: { append() {} }, setText() {},
    query(selector) {
      if (selector.endsWith('="unsend-disclosure"]')) return disclosure;
      if (selector.endsWith('="unsend-badge"]')) return nodes.badge;
      if (selector.endsWith('="unsend-detail"]')) return nodes.detail;
      return null;
    },
  };
  view.renderSentScan(runtime);
  assert.equal(progress.hidden, true);
  assert.equal(nodes.badge.textContent, '9 unsent');
  assert.equal(nodes.detail.textContent, '9 unsent');
  runtime.model.threadUnsend.status = 'stopped';
  runtime.model.threadUnsend.message = 'Stopped: outcome uncertain';
  view.renderSentScan(runtime);
  assert.equal(progress.hidden, false);
  assert.equal(nodes.detail.textContent, 'Stopped: outcome uncertain');
  runtime.model.threadUnsend.status = 'needs-attention';
  runtime.model.threadUnsend.uncertain = 1;
  runtime.model.threadUnsend.message = 'Tab was frozen. Check the last message before starting again.';
  view.renderSentScan(runtime);
  assert.equal(progress.hidden, false);
  assert.equal(nodes.badge.textContent, 'needs attention');
  assert.equal(nodes.badge.dataset.tone, 'warning');
  assert.equal(nodes.detail.textContent, runtime.model.threadUnsend.message);
  assert.match(nodes.copy.textContent, /9 unsent/);
  assert.match(nodes.copy.textContent, /1 uncertain/);
});
