import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { dmContentDigest } from '../src/core/dm-jobs.js';

const [actionLabelsSource, source] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
]);

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

class FakeElement {
  constructor({
    attributes = {},
    children = [],
    onClick = null,
    tagName = 'DIV',
    text = '',
  } = {}) {
    this.attributes = { ...attributes };
    this.children = children;
    this.isConnected = true;
    this.justifyContent = 'normal';
    this.onClick = onClick;
    this.ownText = text;
    this.parent = null;
    this.tagName = tagName.toUpperCase();
    for (const child of children) child.parent = this;
  }

  get textContent() {
    return `${this.ownText}${this.children.map((child) => child.textContent).join('')}`;
  }

  get parentElement() { return this.parent; }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  descendants() {
    const result = [];
    const visit = (element) => {
      for (const child of element.children) {
        result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  contains(candidate) {
    return candidate === this || this.descendants().includes(candidate);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const descendants = this.descendants();
    if (selector === '[data-sent-by-me]') {
      return descendants.filter((element) => element.getAttribute('data-sent-by-me') !== null);
    }
    if (selector === '[data-message-id], [data-item-id]') {
      return descendants.filter((element) => (
        element.getAttribute('data-message-id') != null
        || element.getAttribute('data-item-id') != null
      ));
    }
    if (selector === '[data-insta-toolbox-message-content]') {
      return descendants.filter((element) => element.getAttribute('data-insta-toolbox-message-content') != null);
    }
    if (selector === '[dir="auto"]') {
      return descendants.filter((element) => element.getAttribute('dir') === 'auto');
    }
    if (selector === 'time[datetime]') {
      return descendants.filter((element) => element.getAttribute('datetime') != null);
    }
    if (selector === '[role="button"][aria-haspopup="menu"]') {
      return descendants.filter((element) => (
        element.getAttribute('role') === 'button'
        && element.getAttribute('aria-haspopup') === 'menu'
      ));
    }
    if (selector === "[role='button']") {
      return descendants.filter((element) => element.getAttribute('role') === 'button');
    }
    if (selector === 'button, [role="button"], [role="menuitem"], span, div') {
      return descendants.filter((element) => (
        element.tagName === 'BUTTON'
        || element.tagName === 'SPAN'
        || element.tagName === 'DIV'
        || ['button', 'menuitem'].includes(element.getAttribute('role'))
      ));
    }
    const ariaStarts = selector.match(/^\[aria-label\^='([^']+)'\]$/);
    if (ariaStarts) {
      return descendants.filter((element) => (
        String(element.getAttribute('aria-label') || '').startsWith(ariaStarts[1])
      ));
    }
    const ariaIncludes = selector.match(/^\[aria-label\*='([^']+)'\]$/);
    if (ariaIncludes) {
      return descendants.filter((element) => (
        String(element.getAttribute('aria-label') || '').includes(ariaIncludes[1])
      ));
    }
    return [];
  }

  closest(selector) {
    let current = this;
    while (current) {
      const role = current.getAttribute('role');
      if (selector.includes('[role="row"]') && role === 'row') return current;
      if (selector.includes('[role="listitem"]') && role === 'listitem') return current;
      if (
        selector.includes('button')
        && (
          current.tagName === 'BUTTON'
          || role === 'button'
          || role === 'menuitem'
        )
      ) return current;
      current = current.parent;
    }
    return null;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 100, height: 40 };
  }

  dispatchEvent() {
    this.onDispatch?.();
    return true;
  }

  click() {
    this.onClick?.();
  }

  disconnect() {
    this.isConnected = false;
    for (const child of this.children) child.disconnect();
  }
}

function createHarness({
  bindSurfaces = true,
  nestedFlexEnd = false,
  contradictoryOwnership = false,
  lifecycleAt = null,
  lifecycleEvent = 'freeze',
  plainTextUnsendControls = false,
  postConfirmation = 'remove',
  preexistingDialog = false,
  secureCrypto = webcrypto,
  textOnlyActionControl = false,
  includeReplyControl = false,
  unsendLabel = 'Unsend',
} = {}) {
  let runtimeListener = null;
  const activations = [];
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  const activeListeners = new Set();
  const addLifecycle = (target, type, callback) => {
    activeListeners.add(callback);
    target.addEventListener(type, callback);
  };
  const removeLifecycle = (target, type, callback) => {
    activeListeners.delete(callback);
    target.removeEventListener(type, callback);
  };
  const emitLifecycle = (type, properties = {}) => {
    const event = Object.assign(new Event(type), properties);
    (['freeze', 'resume', 'visibilitychange'].includes(type) ? documentEvents : windowEvents).dispatchEvent(event);
  };
  const lifecycleStep = (step) => {
    if (lifecycleAt === step) emitLifecycle(lifecycleEvent, { persisted: lifecycleEvent === 'pagehide' });
  };
  const surfaces = { dialogs: [], menus: [] };
  const locationState = {
    href: 'https://www.instagram.com/direct/t/123/',
    pathname: '/direct/t/123/',
  };
  const content = 'Reviewed exact message';
  const item = {
    conversationId: 'inbox/friend_123',
    contentDigest: dmContentDigest(content),
    messageId: 'sent-live-1',
    sentByMe: true,
    timestamp: 1_700_000_000_100,
  };

  const scope = new FakeElement({ attributes: { 'data-pagelet': 'IGDMessagesList' } });
  const confirmation = new FakeElement({
    attributes: bindSurfaces ? { 'data-insta-toolbox-bound-control': 'dm-dialog-1' } : {},
    tagName: plainTextUnsendControls ? 'SPAN' : 'BUTTON',
    text: unsendLabel,
    onClick() {
      activations.push('confirmation');
      lifecycleStep('confirmation');
      const row = scope.children[0];
      if (postConfirmation === 'remove') {
        row?.disconnect();
        scope.children = scope.children.filter((child) => child !== row);
      } else if (postConfirmation === 'wrong-thread') {
        locationState.href = 'https://www.instagram.com/direct/t/999/';
        locationState.pathname = '/direct/t/999/';
      } else if (postConfirmation === 'identity-loss') {
        row?.removeAttribute('data-message-id');
      } else if (postConfirmation === 'optimistic-reversion') {
        row?.disconnect();
        scope.children = scope.children.filter((child) => child !== row);
        setTimeout(() => {
          row.isConnected = true;
          for (const child of row.children) child.isConnected = true;
          scope.children.unshift(row);
        }, 100);
      }
      surfaces.dialogs.forEach((dialog) => dialog.disconnect());
      surfaces.dialogs = [];
      surfaces.menus = [];
    },
  });
  const menuChoice = new FakeElement({
    attributes: {
      ...(plainTextUnsendControls ? {} : { role: 'menuitem' }),
      ...(bindSurfaces ? { 'aria-controls': 'dm-dialog-1', id: 'dm-menu-choice-1' } : {}),
    },
    children: plainTextUnsendControls ? [] : [new FakeElement({ tagName: 'SPAN', text: unsendLabel })],
    tagName: plainTextUnsendControls ? 'SPAN' : 'DIV',
    text: plainTextUnsendControls ? unsendLabel : '',
    onClick() {
      activations.push('menu-choice');
      lifecycleStep('menu-choice');
      surfaces.menus.forEach((menu) => menu.disconnect());
      surfaces.menus = [];
      surfaces.dialogs = [new FakeElement({
        attributes: {
          role: 'dialog',
          ...(bindSurfaces ? { id: 'dm-dialog-1', 'aria-labelledby': 'dm-menu-choice-1' } : {}),
        },
        children: [confirmation],
      })];
    },
  });
  const actionControl = new FakeElement({
    attributes: {
      ...(textOnlyActionControl ? {} : {
        'aria-haspopup': 'menu',
        'aria-label': 'See more options for message sent-live-1',
      }),
      ...(bindSurfaces ? { 'aria-controls': 'dm-menu-1', id: 'dm-action-1' } : {}),
      role: 'button',
    },
    text: textOnlyActionControl ? 'See more options for message from demo.creator' : '',
    onClick() {
      activations.push('action-menu');
      lifecycleStep('action-menu');
      surfaces.menus = [new FakeElement({
        attributes: {
          role: 'menu',
          ...(bindSurfaces ? { id: 'dm-menu-1', 'aria-labelledby': 'dm-action-1' } : {}),
        },
        children: [menuChoice],
      })];
    },
  });
  const replyControl = new FakeElement({
    attributes: { role: 'button' },
    text: 'Reply',
    onClick() {
      activations.push('reply');
    },
  });
  const contentElement = new FakeElement({
    attributes: { 'data-insta-toolbox-message-content': '', dir: 'auto' },
    text: content,
  });
  const row = new FakeElement({
    attributes: {
      'data-message-id': item.messageId,
      ...(nestedFlexEnd ? {} : { 'data-sent-by-me': 'true' }),
      'data-timestamp-ms': String(item.timestamp),
      role: 'row',
    },
    children: [contentElement, ...(includeReplyControl ? [replyControl] : []), actionControl],
  });
  const retainedIdentityControl = new FakeElement({
    attributes: { 'data-insta-toolbox-message-content': '', dir: 'auto' },
    text: 'Another message keeps stable identity coverage available',
  });
  const retainedIdentityRow = new FakeElement({
    attributes: {
      'data-message-id': 'other-message',
      'data-sent-by-me': 'true',
      'data-timestamp-ms': String(item.timestamp - 1_000),
      role: 'row',
    },
    children: [retainedIdentityControl],
  });
  scope.children = [row, retainedIdentityRow];
  row.parent = scope;
  retainedIdentityRow.parent = scope;
  if (nestedFlexEnd) actionControl.justifyContent = 'flex-end';
  row.onDispatch = () => lifecycleStep('hover');
  if (contradictoryOwnership === 'alignment') row.justifyContent = 'flex-start';
  if (contradictoryOwnership === 'received-marker') contentElement.setAttribute('data-sent-by-me', 'false');

  if (preexistingDialog) {
    surfaces.dialogs = [new FakeElement({
      attributes: { role: 'dialog' },
      children: [new FakeElement({ tagName: 'BUTTON', text: 'Unrelated' })],
    })];
  }

  const document = {
    body: { innerText: '' },
    addEventListener: (type, callback) => addLifecycle(documentEvents, type, callback),
    removeEventListener: (type, callback) => removeLifecycle(documentEvents, type, callback),
    querySelector(selector) {
      if (selector === '[data-pagelet="IGDMessagesList"]' || selector === 'main') return scope;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[role="dialog"]') return surfaces.dialogs;
      if (selector === '[role="menu"], [role="listbox"]') return surfaces.menus;
      return [];
    },
  };
  const context = vm.createContext({
    AbortController,
    addEventListener: (type, callback) => addLifecycle(windowEvents, type, callback),
    removeEventListener: (type, callback) => removeLifecycle(windowEvents, type, callback),
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListener = listener;
          },
        },
      },
    },
    console,
    crypto: secureCrypto,
    document,
    getComputedStyle: (element) => ({
      display: 'block',
      justifyContent: element.justifyContent,
      visibility: 'visible',
    }),
    location: locationState,
    MouseEvent: FakeEvent,
    PointerEvent: FakeEvent,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(source, context);

  return {
    activations, emitLifecycle,
    activeListenerCount: () => activeListeners.size,
    item,
    send(request) {
      return new Promise((resolve) => {
        const result = runtimeListener(request, {}, resolve);
        if (result !== true) queueMicrotask(() => resolve(undefined));
      });
    },
  };
}

test('one exact DM token drives only its menu, Unsend choice, and confirmation once', async () => {
  const harness = createHarness();
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  assert.equal(typeof resolution.resolutionToken, 'string');

  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.result, 'unsent');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);

  const replay = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(replay.reason, 'dm-resolution-expired-or-changed');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
});

test('current Instagram text-only message menu is selected while Reply is ignored', async () => {
  const harness = createHarness({ textOnlyActionControl: true, includeReplyControl: true });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });

  assert.equal(result.result, 'unsent');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
});

test('the reviewed German Unsend label remains exact UTF-8 and executable', async () => {
  const harness = createHarness({ unsendLabel: 'Zurücknehmen' });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });

  assert.equal(result.result, 'unsent');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
});

test('a pre-existing dialog consumes the token and stops before every DM control', async () => {
  const harness = createHarness({ preexistingDialog: true });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.reason, 'preexisting-surface-before-live-unsend');
  assert.deepEqual(harness.activations, []);
});

test('an unbound exact-text Unsend surface never receives a destructive activation', async () => {
  const harness = createHarness({ bindSurfaces: false });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.reason, 'dm-unsend-menu-not-exact');
  assert.deepEqual(harness.activations, ['action-menu']);
});

test('a bound but noninteractive exact-text Unsend node never receives a destructive activation', async () => {
  const harness = createHarness({ plainTextUnsendControls: true });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.reason, 'dm-unsend-menu-not-exact');
  assert.deepEqual(harness.activations, ['action-menu']);
});

test('wrong-thread transition after confirmation never becomes a successful Unsend', async () => {
  const harness = createHarness({ postConfirmation: 'wrong-thread' });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.notEqual(result.result, 'unsent');
  assert.equal(result.reason, 'dm-unsend-not-confirmed');
});

test('identity loss while the retained row remains connected never becomes a successful Unsend', async () => {
  const harness = createHarness({ postConfirmation: 'identity-loss' });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.notEqual(result.result, 'unsent');
  assert.equal(result.reason, 'dm-unsend-not-confirmed');
});

test('a nested flex-end toolbar cannot prove that the reviewed message was sent by me', async () => {
  const harness = createHarness({ nestedFlexEnd: true });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });
  assert.equal(resolution.resolutionToken, undefined);
  assert.equal(resolution.sentByMe, null);
  assert.equal(resolution.reason, 'message-ownership-unavailable');
});

test('exact-item ownership rejects contradictory alignment and received markers before any click', async () => {
  for (const contradictoryOwnership of ['alignment', 'received-marker']) {
    const harness = createHarness({ contradictoryOwnership });
    const resolution = await harness.send({ kind: 'insta-toolbox-inspect-reviewed-dm-item', item: harness.item });
    assert.equal(resolution.resolutionToken, undefined);
    assert.equal(resolution.sentByMe, null);
    assert.deepEqual(harness.activations, []);
  }
});

test('an exact-item optimistic removal that reverts cannot report success or dispatch twice', async () => {
  const harness = createHarness({ postConfirmation: 'optimistic-reversion' });
  const resolution = await harness.send({ kind: 'insta-toolbox-inspect-reviewed-dm-item', item: harness.item });
  const request = {
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  };
  const result = await harness.send(request);
  assert.equal(result.uncertain, true);
  assert.notEqual(result.result, 'unsent');
  assert.equal(result.reason, 'dm-unsend-not-confirmed');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
  assert.equal((await harness.send(request)).reason, 'dm-resolution-expired-or-changed');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
});

test('exact-item lifecycle interruption before each native click consumes authority and cleans listeners', async () => {
  for (const [lifecycleAt, expected] of [
    ['hover', []],
    ['action-menu', ['action-menu']],
    ['menu-choice', ['action-menu', 'menu-choice']],
  ]) {
    const harness = createHarness({ lifecycleAt });
    const resolution = await harness.send({ kind: 'insta-toolbox-inspect-reviewed-dm-item', item: harness.item });
    const request = {
      kind: 'insta-toolbox-perform-reviewed-dm-unsend',
      item: { ...harness.item, resolutionToken: resolution.resolutionToken },
    };
    const result = await harness.send(request);
    assert.equal(result.needsAttention, true);
    assert.equal(result.interruptionReason, 'page-frozen');
    assert.equal(result.uncertain, false);
    assert.deepEqual(harness.activations, expected);
    assert.equal(harness.activeListenerCount(), 0);
    harness.emitLifecycle('resume');
    harness.emitLifecycle('pageshow', { persisted: true });
    assert.equal((await harness.send(request)).reason, 'dm-resolution-expired-or-changed');
    assert.deepEqual(harness.activations, expected);
  }
});

test('exact-item BFCache entry after dispatch retains proven removal with needs-attention', async () => {
  const harness = createHarness({ lifecycleAt: 'confirmation', lifecycleEvent: 'pagehide' });
  const resolution = await harness.send({ kind: 'insta-toolbox-inspect-reviewed-dm-item', item: harness.item });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.result, 'unsent');
  assert.equal(result.needsAttention, true);
  assert.equal(result.interruptionReason, 'page-cached');
  assert.equal(result.uncertain, false);
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
  assert.equal(harness.activeListenerCount(), 0);
});

test('exact-item frozen unproven dispatch reports uncertainty without a repeat', async () => {
  const harness = createHarness({ lifecycleAt: 'confirmation', postConfirmation: 'identity-loss' });
  const resolution = await harness.send({ kind: 'insta-toolbox-inspect-reviewed-dm-item', item: harness.item });
  const result = await harness.send({
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.needsAttention, true);
  assert.equal(result.uncertain, true);
  assert.notEqual(result.result, 'unsent');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
  assert.equal(harness.activeListenerCount(), 0);
});

test('DM inspection issues no capability when secure randomness is unavailable', async () => {
  const harness = createHarness({ secureCrypto: {} });
  const resolution = await harness.send({
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
    item: harness.item,
  });

  assert.equal(resolution.resolutionToken, null);
  assert.equal(resolution.unexpectedUi, true);
  assert.equal(resolution.reason, 'secure-random-unavailable');
  assert.deepEqual(harness.activations, []);
});
