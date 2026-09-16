import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/own-reactions.js', import.meta.url), 'utf8');

function fixture({ mine = true, shared = false, behavior = 'remove', emoji = '😂',
  count = '', ambiguous = false, ownershipText = 'Select to remove', onDispatch = null,
  otherEmoji = null, initialLoadingMs = 0, authorize = () => true,
  displayName = 'Sample account', otherDisplayName = 'Another account' } = {}) {
  class Node {
    constructor(tag, attrs = {}, children = [], value = '') {
      this.tagName = tag.toUpperCase(); this.attrs = attrs; this.children = [];
      this.value = value; this.parentElement = null;
      this.style = {};
      for (const child of children) this.append(child);
    }
    append(child) { child.parentElement = this; this.children.push(child); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((n) => n !== this); this.parentElement = null; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    get textContent() { return this.value + this.children.map((child) => child.textContent).join(' '); }
    get isConnected() { return this === root || Boolean(this.parentElement?.isConnected); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    getClientRects() { return this.isConnected ? [{}] : []; }
    matches(selector) {
      return selector.split(',').some((part) => {
        part = part.trim();
        const tag = part.match(/^[a-z][a-z0-9]*/i)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        const attributes = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
        return (tag || attributes.length) && attributes.every(([, key, value]) => (
          this.attrs[key] !== undefined && (value === undefined || this.attrs[key] === value)
        ));
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    click() { this.onclick?.(); }
  }
  const root = new Node('html');
  const body = new Node('span', { dir: 'auto' }, [], 'Disposable received message');
  const badge = new Node('div', { role: 'button', tabindex: '0' }, [new Node('div', { role: 'none' }, [], emoji + count)]);
  const actions = new Node('div', { role: 'group', 'aria-label': 'Message actions' });
  const row = new Node('div', { role: 'group' }, [body, actions, badge]); root.append(row);
  const extraBadge = otherEmoji ? new Node('div', { role: 'button', tabindex: '0' },
    [new Node('div', { role: 'none' }, [], otherEmoji)]) : null;
  if (extraBadge) row.append(extraBadge);
  const context = { accountId: '100', accountVerified: true, threadId: '200', usable: true };
  const counters = { opens: 0, mutations: 0, assertions: 0 };
  let dialog = null;
  let owns = mine;
  const show = () => {
    counters.opens += 1;
    if (dialog?.isConnected) return;
    dialog = new Node('div', { role: 'dialog', 'aria-modal': 'true' }, [new Node('h2', {}, [], 'Reactions')]);
    const reactor = (self, selected = emoji) => {
      const name = new Node('span', {}, [], self ? displayName : otherDisplayName);
      const nameColumn = new Node('div', {}, [name]);
      nameColumn.style = { display: 'flex', flexDirection: 'column' };
      if (self) {
        const secondary = new Node('div', {}, [new Node('span', {}, [], ownershipText)]);
        secondary.style = { display: 'flex', flexDirection: 'column' };
        nameColumn.append(secondary);
      }
      const button = new Node('div', { role: 'button', tabindex: '0' }, [
        nameColumn,
        new Node('span', {}, [], selected),
      ]);
      if (self) button.onclick = () => {
        counters.mutations += 1;
        onDispatch?.();
        if (behavior === 'no-change') return;
        if (behavior === 'recycle') { body.value = 'Replaced content'; return; }
        owns = false; button.remove();
        if (behavior === 'revert') {
          setTimeout(() => { owns = true; dialog.append(reactor(true)); }, 2);
        } else if (!shared) { badge.remove(); dialog.remove(); }
        else if (behavior === 'close-shared') dialog.remove();
      };
      return button;
    };
    const populate = () => {
      delete dialog.attrs['aria-busy'];
      if (owns) dialog.append(reactor(true));
      if (owns && ambiguous) dialog.append(reactor(true));
      if (shared) dialog.append(reactor(false));
      if (otherEmoji) dialog.append(reactor(false, otherEmoji));
    };
    if (initialLoadingMs && counters.opens === 1) {
      dialog.attrs['aria-busy'] = 'true';
      setTimeout(populate, initialLoadingMs);
    } else populate();
    const close = new Node('button', { 'aria-label': 'Close' }); close.onclick = () => dialog.remove();
    dialog.append(close); root.append(dialog);
  };
  badge.onclick = show;
  if (extraBadge) extraBadge.onclick = show;
  const document = { documentElement: root, defaultView: { getComputedStyle: (node) => node.style },
    querySelectorAll: (selector) => root.querySelectorAll(selector) };
  const sandbox = vm.createContext({ document, setTimeout, clearTimeout, DOMException, Date });
  vm.runInContext(source, sandbox);
  const createAdapter = () => sandbox.InstaToolboxOwnReactions.create({ document, timeoutMs: 200, stableMs: 60,
     inspectContext: () => context, assertAuthorized: () => { counters.assertions += 1; return authorize(counters); } });
  const adapter = createAdapter();
  const remove = (signal = new AbortController().signal) => adapter.remove({ row, badge, threadId: '200', accountId: '100', signal });
  return { remove, adapter, createAdapter, document, Node, row, badge, extraBadge, body,
    counters, context, show, reevaluate: () => vm.runInContext(source, sandbox),
    get dialog() { return dialog; } };
}

test('own reaction on a received message is removed without removing the message', async () => {
  const f = fixture(); const result = await f.remove();
  assert.equal(result.verified, true); assert.equal(result.removed, 1);
  assert.equal(f.counters.mutations, 1); assert.equal(f.row.isConnected, true);
  assert.equal(f.body.textContent, 'Disposable received message');
});
test('shared emoji retains other reactions and reopens closed details once', async () => {
  const f = fixture({ shared: true, behavior: 'close-shared' });
  assert.equal((await f.remove()).verified, true);
  assert.equal(f.badge.isConnected, true); assert.equal(f.counters.mutations, 1);
  assert.equal(f.counters.opens, 2);
});
test('another person reaction is skipped without mutation', async () => {
  const f = fixture({ mine: false, shared: true });
  const result = await f.remove();
  assert.equal(result.reason, 'not-my-reaction'); assert.equal(f.counters.mutations, 0);
});
test('skin-tone and joined Unicode emoji remain exact targets', async () => {
  for (const emoji of ['👍🏽', '❤️', '👩‍💻']) {
    const f = fixture({ emoji }); assert.equal((await f.remove()).verified, true);
    assert.equal(f.counters.mutations, 1);
  }
});
test('Stop before inspection performs no click', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.remove(controller.signal), { name: 'AbortError' });
  assert.equal(f.counters.opens, 0); assert.equal(f.counters.mutations, 0);
});
test('wrong thread performs no click', async () => {
  const f = fixture(); f.context.threadId = '201';
  await assert.rejects(f.remove(), /reaction-context-changed/);
  assert.equal(f.counters.opens, 0);
});
test('a recycled message cannot turn a reaction click into verified success', async () => {
  const f = fixture({ behavior: 'recycle' });
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  assert.equal(f.counters.mutations, 1);
});
test('optimistic reaction removal that reverts stays uncertain', async () => {
  const f = fixture({ behavior: 'revert', shared: true });
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  assert.equal(f.counters.mutations, 1);
});
test('uncertain removal cannot be dispatched twice', async () => {
  const f = fixture({ behavior: 'no-change' });
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  await assert.rejects(f.remove(), /reaction-already-attempted/);
  assert.equal(f.counters.mutations, 1);
});

test('grouped badge counts do not change the exact emoji target', async () => {
  const f = fixture({ shared: true, count: ' 2' });
  assert.equal((await f.remove()).verified, true);
  assert.equal(f.badge.isConnected, true);
});
test('ambiguous own-reaction rows are skipped rather than guessed', async () => {
  const f = fixture({ ambiguous: true });
  assert.equal((await f.remove()).reason, 'ownership-ambiguous');
  assert.equal(f.counters.mutations, 0);
});
test('unsupported ownership wording is not treated as a removal control', async () => {
  const f = fixture({ ownershipText: 'React again' });
  assert.equal((await f.remove()).reason, 'not-my-reaction');
  assert.equal(f.counters.mutations, 0);
});
test('Stop after dispatch still settles a verified result once', async () => {
  const controller = new AbortController();
  const f = fixture({ onDispatch: () => controller.abort() });
  assert.equal((await f.remove(controller.signal)).verified, true);
  assert.equal(f.counters.mutations, 1);
});

test('reaction plans are ephemeral and cannot be copied or replayed', () => {
  const sandbox = vm.createContext({ Date }); vm.runInContext(source, sandbox);
  const api = sandbox.InstaToolboxOwnReactions;
  const plan = api.createPlan({ threadId: '200', accountUsername: 'demo', expiresAt: Date.now() + 60_000, limit: 1 });
  assert.ok(plan); assert.equal(api.validatePlan(plan, '200', 'demo'), true);
  assert.equal(api.validatePlan({ ...plan }, '200', 'demo'), false);
  assert.equal(api.validatePlan(plan, '201', 'demo'), false);
  assert.equal(api.validatePlan(plan, '200', 'someone_else'), false);
  api.consumePlan(plan, '200', 'demo');
  assert.equal(api.validatePlan(plan, '200', 'demo'), false);
  assert.throws(() => api.consumePlan(plan, '200', 'demo'), /reaction-review-required/);
});

test('initial reaction details wait for the native list to finish loading', async () => {
  const f = fixture({ initialLoadingMs: 25 });
  assert.equal((await f.remove()).verified, true);
  assert.equal(f.counters.mutations, 1);
});

test('a busy empty details dialog cannot hide an unchanged own reaction', async () => {
  let f;
  f = fixture({ behavior: 'no-change', onDispatch: () => {
    f.dialog.attrs['aria-busy'] = 'true';
    for (const row of [...f.dialog.querySelectorAll('[role="button"]')]) row.remove();
  } });
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  assert.equal(f.badge.isConnected, true);
  assert.equal(f.counters.mutations, 1);
});

test('an empty details dialog without a busy marker still cannot prove badge removal', async () => {
  let f;
  f = fixture({ behavior: 'no-change', onDispatch: () => {
    for (const row of [...f.dialog.querySelectorAll('[role="button"]')]) row.remove();
  } });
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  assert.equal(f.badge.isConnected, true);
});

test('other emoji reactions are preserved and checked after reopening their remaining badge', async () => {
  const f = fixture({ otherEmoji: '👍🏽' });
  assert.equal((await f.remove()).verified, true);
  assert.equal(f.badge.isConnected, false);
  assert.equal(f.extraBadge.isConnected, true);
  assert.equal(f.counters.opens, 2);
});

test('losing another emoji reaction cannot be reported as verified cleanup', async () => {
  let f;
  f = fixture({ shared: true, otherEmoji: '👍🏽', onDispatch: () => {
    f.extraBadge.remove();
    for (const row of [...f.dialog.querySelectorAll('[role="button"]')]) {
      if (row.textContent.includes('👍🏽')) row.remove();
    }
  } });
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
});

test('an uncertain outcome fences a replacement badge and another adapter in the same runtime', async () => {
  const f = fixture({ behavior: 'no-change' });
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  f.dialog.remove();
  const replacement = new f.Node('div', { role: 'button', tabindex: '0' },
    [new f.Node('div', { role: 'none' }, [], '😂')]);
  replacement.onclick = f.show;
  f.badge.remove(); f.row.append(replacement);
  f.reevaluate();
  await assert.rejects(f.createAdapter().remove({ row: f.row, badge: replacement,
    threadId: '200', accountId: '100', signal: new AbortController().signal }), /reaction-already-attempted/);
  assert.equal(f.counters.mutations, 1);
  assert.equal(f.counters.opens, 1);
});

test('account or thread drift after dispatch stays uncertain without another click', async () => {
  for (const field of ['accountId', 'threadId']) {
    let f;
    f = fixture({ onDispatch: () => { f.context[field] = '999'; } });
    await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
    assert.equal(f.counters.mutations, 1);
  }
});

test('a displayed shared count waits for all matching reactor rows before deciding ownership', async () => {
  const f = fixture({ shared: true, count: ' 2' });
  const show = f.badge.onclick;
  f.badge.onclick = () => {
    show();
    const own = f.dialog.querySelectorAll('[role="button"]').find((row) => row.textContent.includes('Select to remove'));
    own.remove();
    setTimeout(() => f.dialog.append(own), 25);
  };
  assert.equal((await f.remove()).verified, true);
  assert.equal(f.counters.mutations, 1);
});

test('a known message identity keeps an uncertain attempt fenced after a content change', async () => {
  const f = fixture({ behavior: 'no-change' });
  f.row.attrs['data-message-id'] = 'stable-fixture-message';
  await assert.rejects(f.remove(), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  f.dialog.remove();
  f.body.value = 'An edited version of the same message';
  await assert.rejects(f.createAdapter().remove({ row: f.row, badge: f.badge,
    threadId: '200', accountId: '100' }), /reaction-already-attempted/);
  assert.equal(f.counters.mutations, 1);
});

test('false, missing, and asynchronous grants cannot authorize reaction controls', async () => {
  for (const authorize of [() => false, () => undefined, () => Promise.resolve(true),
    () => Promise.reject(new Error('No grant'))]) {
    const f = fixture({ authorize });
    await assert.rejects(f.remove(), /reaction-authorization-required/);
    assert.equal(f.counters.opens, 0);
    assert.equal(f.counters.mutations, 0);
  }
});

test('an authorization exception stops before the first native control', async () => {
  const f = fixture({ authorize: () => { throw new Error('Review expired'); } });
  await assert.rejects(f.remove(), /Review expired/);
  assert.equal(f.counters.opens, 0);
  assert.equal(f.counters.mutations, 0);
});

test('revoked authority after opening details prevents the destructive click', async () => {
  const f = fixture({ authorize: (counters) => counters.opens === 0 });
  await assert.rejects(f.remove(), /reaction-authorization-required/);
  assert.equal(f.counters.opens, 1);
  assert.equal(f.counters.mutations, 0);
});

test('Stop and grant revocation after dispatch still permit bounded read-only shared verification', async () => {
  const controller = new AbortController();
  const f = fixture({ shared: true, behavior: 'close-shared',
    authorize: (counters) => counters.mutations === 0, onDispatch: () => controller.abort() });
  assert.equal((await f.remove(controller.signal)).verified, true);
  assert.equal(f.counters.mutations, 1);
  assert.equal(f.counters.opens, 2);
});

test('a participant display name cannot impersonate the native removal subtitle', async () => {
  const f = fixture({ mine: false, shared: true, otherDisplayName: 'Select to remove' });
  assert.equal((await f.remove()).reason, 'not-my-reaction');
  assert.equal(f.counters.mutations, 0);
});

test('a valid own subtitle remains distinct even when the display name uses the same phrase', async () => {
  const f = fixture({ displayName: 'Select to remove' });
  assert.equal((await f.remove()).verified, true);
  assert.equal(f.counters.mutations, 1);
});

test('reevaluating the adapter preserves its singleton and consumed authority', () => {
  const sandbox = vm.createContext({ Date });
  vm.runInContext(source, sandbox);
  const first = sandbox.InstaToolboxOwnReactions;
  const plan = first.createPlan({ threadId: '200', accountUsername: 'demo',
    expiresAt: Date.now() + 60_000, limit: 1 });
  first.consumePlan(plan, '200', 'demo');
  vm.runInContext(source, sandbox);
  assert.equal(sandbox.InstaToolboxOwnReactions, first);
  assert.equal(first.validatePlan(plan, '200', 'demo'), false);
});
