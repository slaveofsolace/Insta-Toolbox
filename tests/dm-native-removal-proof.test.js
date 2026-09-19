import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');

function fixture({ duplicate = false, normalBottom = false, shortMessages = null } = {}) {
  const document = { defaultView: { getComputedStyle: (element) => element.style } };
  class Element {
    constructor(tagName = 'div', attributes = {}, children = []) {
      Object.assign(this, { tagName, attributes, children: [], parentElement: null,
        ownerDocument: document, style: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      this.append(...children);
    }
    get isConnected() { return this === document.root || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this.attributes.text || this.children.map((child) => child.textContent).join(''); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    getBoundingClientRect() {
      return this.style.display === 'none' ? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
        : { top: 10, bottom: 50, left: 10, right: 110, width: 100, height: 40 };
    }
    matches(selector) {
      return selector.split(',').some((entry) => {
        const part = entry.trim();
        const attribute = part.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
        return attribute ? Object.hasOwn(this.attributes, attribute[1])
          && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2])
          : part === this.tagName;
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    remove() {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
  const root = document.root = new Element('div', { 'data-pagelet': 'IGDMessagesList' });
  document.querySelectorAll = selector => [
    ...(document.root.matches(selector) ? [document.root] : []), ...document.root.querySelectorAll(selector),
  ];
  const scroller = new Element();
  Object.assign(scroller, { scrollTop: normalBottom ? 300 : 0, scrollHeight: shortMessages ? 120 : 500, clientHeight: 200 });
  scroller.style.flexDirection = normalBottom ? 'column' : 'column-reverse';
  root.append(scroller);
  const makeRow = (text) => {
    const content = new Element('span', { dir: 'auto', text });
    const actions = new Element('div', { role: 'group', 'aria-label': 'Message actions' }, [
      new Element('button', { 'aria-label': 'See more options for message' }),
    ]);
    const group = new Element('div', { role: 'group' }, [content, actions]);
    const row = new Element('div', {}, [new Element('span', { text: 'Timestamp' }), group]);
    return { row, group, content };
  };
  const neighbors = [makeRow('Earlier message'), makeRow(duplicate ? 'Disposable message' : 'Adjacent message')]
    .slice(0, shortMessages ? shortMessages - 1 : 2);
  const target = makeRow('Disposable message');
  scroller.append(...neighbors.map(({ row }) => row), target.row);
  const context = vm.createContext({ Date, setTimeout, clearTimeout, DOMException });
  vm.runInContext(source, context);
  const proof = context.InstaToolboxDmThreadUnsender.messageProof;
  const before = proof.removalEvidence(target.row);
  return { document, root, scroller, target, neighbors, before, proof, makeRow, Element };
}

for (const shortMessages of [1, 2]) {
  test(`a proven non-scrollable ${shortMessages}-message native list verifies its exact detached message`, async () => {
    const { target, before, proof } = fixture({ shortMessages });
    target.row.remove();
    assert.equal(proof.removalProven(target.row, before), true);
    assert.equal(await proof.waitForRemoval(target.row, before, { timeoutMs: 220, stableMs: 75 }), true);
  });
}

test('short native content can shrink and lose an adjacent timestamp while the viewport stays fixed', () => {
  const { target, scroller, root, proof, Element } = fixture({ shortMessages: 2 });
  const list = new Element(), timestamp = new Element('span', { text: 'Today, 12:00' });
  Object.assign(list, { scrollHeight: 120, clientHeight: 120 });
  const messages = [...scroller.children];
  scroller.children = []; list.append(...messages, timestamp); scroller.append(list);
  Object.assign(scroller, { scrollHeight: 200, clientHeight: 200 });
  const before = proof.removalEvidence(target.row);
  target.row.remove(); timestamp.remove();
  Object.assign(list, { scrollHeight: 60, clientHeight: 60 });
  assert.equal(root.isConnected, true);
  assert.equal(proof.removalProven(target.row, before), true);
});

test('short-list proof rejects recycled slots, remounts, backfill and changed surviving messages', () => {
  for (const mutate of [
    ({ target, scroller }) => scroller.append(target.row),
    ({ target, scroller, makeRow }) => scroller.append(makeRow('Disposable message').row),
    ({ scroller, makeRow }) => scroller.append(makeRow('Backfilled message').row),
    ({ neighbors }) => { neighbors[0].content.attributes.text = 'Edited neighbor'; },
    ({ neighbors }) => neighbors[0].group.remove(),
    ({ neighbors }) => neighbors[0].row.remove(),
    ({ scroller, Element }) => scroller.append(new Element('span', { text: 'Unexpected content' })),
  ]) {
    const current = fixture({ shortMessages: 2 });
    current.target.row.remove(); mutate(current);
    assert.equal(current.proof.removalProven(current.target.row, current.before), false);
  }
  const current = fixture({ shortMessages: 1 });
  current.target.group.remove();
  assert.equal(current.proof.removalProven(current.target.row, current.before), false, 'an empty retained virtual row is not removal');
});

test('short-list proof rejects pane/list replacement, scrolling, viewport changes and loading', () => {
  for (const mutate of [
    ({ document, Element }) => { document.root = new Element('div', { 'data-pagelet': 'IGDMessagesList' }); },
    ({ scroller }) => scroller.remove(),
    ({ scroller }) => { scroller.scrollTop = -40; },
    ({ scroller }) => { scroller.scrollHeight = 300; },
    ({ scroller }) => { scroller.scrollHeight = 150; },
    ({ scroller }) => { scroller.clientHeight = 250; },
    ({ scroller }) => { scroller.clientHeight = 0; scroller.scrollHeight = 0; },
    ({ root }) => { root.attributes['aria-busy'] = 'true'; },
    ({ root }) => { root.attributes['aria-hidden'] = 'true'; },
    ({ root }) => { root.style.display = 'none'; },
    ({ root, Element }) => root.append(new Element('div', { 'data-pagelet': 'IGDMessagesList' })),
    ({ root, Element }) => root.append(new Element('div', { role: 'progressbar' })),
    ({ root, Element }) => root.append(new Element('div', { 'aria-busy': 'true' })),
  ]) {
    const current = fixture({ shortMessages: 2 });
    current.target.row.remove(); mutate(current);
    assert.equal(current.proof.removalProven(current.target.row, current.before), false);
  }
});

test('a scrollable native list cannot use short-list proof merely because one or two messages are mounted', () => {
  for (const shortMessages of [1, 2]) {
    const { target, scroller, proof } = fixture({ shortMessages });
    scroller.scrollHeight = 500;
    const before = proof.removalEvidence(target.row);
    target.row.remove(); scroller.scrollHeight = 120;
    assert.equal(proof.removalProven(target.row, before), false);
  }
});

test('short-list removal waits for stable disappearance and the exact conversation context', async () => {
  const current = fixture({ shortMessages: 1 });
  current.target.row.remove();
  const reverted = setTimeout(() => current.scroller.append(current.target.row), 50);
  assert.equal(await current.proof.waitForRemoval(current.target.row, current.before,
    { timeoutMs: 220, stableMs: 150 }), false);
  clearTimeout(reverted);
  current.target.row.remove();
  let exactContext = true;
  const switched = setTimeout(() => { exactContext = false; }, 50);
  assert.equal(await current.proof.waitForRemoval(current.target.row, current.before,
    { contextValid: () => exactContext, timeoutMs: 220, stableMs: 150 }), false);
  clearTimeout(switched);
});

test('short-list settlement does not turn preview edits or an open confirmation into success', async () => {
  const current = fixture({ shortMessages: 1 });
  current.target.content.attributes.text = 'Edited body';
  assert.equal(current.proof.removalProven(current.target.row, current.before), false);
  current.target.row.remove();
  const dialogButton = new current.Element('button'); current.root.append(dialogButton);
  assert.equal(await current.proof.waitForRemoval(current.target.row, current.before,
    { dialogButton, timeoutMs: 100, stableMs: 25 }), false);
});

test('native removal allows older history backfill without relying on mounted counts', () => {
  const { scroller, target, before, proof, makeRow } = fixture();
  target.row.remove();
  const older = makeRow('Backfilled older message');
  scroller.append(older.row);
  older.row.remove();
  older.row.parentElement = scroller;
  scroller.children.unshift(older.row);
  scroller.scrollHeight = 460;
  assert.equal(target.row.isConnected, false);
  assert.equal(scroller.querySelectorAll('[aria-label="Message actions"]').length, 3);
  assert.equal(proof.removalProven(target.row, before), true);
});

test('native row removal is proven despite harmless non-message layout changes', () => {
  const { scroller, target, before, proof, Element } = fixture();
  target.row.remove();
  scroller.append(new Element('span', { text: 'Seen' }));
  assert.equal(proof.removalProven(target.row, before), true);
});

test('bottom anchoring after native height shrink is not mistaken for scrolling away', () => {
  const { scroller, target, before, proof } = fixture({ normalBottom: true });
  target.row.remove();
  scroller.scrollHeight = 450;
  scroller.scrollTop = 250;
  assert.equal(proof.removalProven(target.row, before), true);
  scroller.scrollTop = 225;
  assert.equal(proof.removalProven(target.row, before), false);
});

test('keyed removal accepts native bottom anchoring after the list shrinks', () => {
  const current = fixture({ normalBottom: true });
  current.target.row.attributes['data-message-id'] = 'target-message';
  const before = current.proof.removalEvidence(current.target.row);
  current.target.row.remove();
  current.scroller.scrollHeight = 450;
  current.scroller.scrollTop = 250;
  assert.equal(current.proof.removalProven(current.target.row, before), true);
  current.scroller.scrollTop = 225;
  assert.equal(current.proof.removalProven(current.target.row, before), false);
});

test('keyed removal survives an exact virtual scroller remount with retained anchors', () => {
  const current = fixture();
  current.target.group.attributes['data-message-id'] = 'target-message';
  current.neighbors[0].group.attributes['data-message-id'] = 'neighbor-one';
  current.neighbors[1].group.attributes['data-message-id'] = 'neighbor-two';
  const before = current.proof.removalEvidence(current.target.row);

  const replacementRoot = new current.Element('div', { 'data-pagelet': 'IGDMessagesList' });
  const replacementScroller = new current.Element();
  Object.assign(replacementScroller, { scrollTop: 0, scrollHeight: 500, clientHeight: 200 });
  const first = current.makeRow('Earlier message');
  const second = current.makeRow('Adjacent message');
  first.group.attributes['data-message-id'] = 'neighbor-one';
  second.group.attributes['data-message-id'] = 'neighbor-two';
  replacementScroller.append(first.row, second.row);
  replacementRoot.append(replacementScroller);
  current.document.root = replacementRoot;

  assert.equal(current.proof.removalProven(current.target.row, before), true);
  const remountedTarget = current.makeRow('Disposable message');
  remountedTarget.group.attributes['data-message-id'] = 'target-message';
  replacementScroller.append(remountedTarget.row);
  assert.equal(current.proof.removalProven(current.target.row, before), false);
});

test('a native edited or recycled group is not an unsent message', () => {
  const { target, before, proof } = fixture();
  target.content.attributes.text = 'Edited or recycled message';
  assert.equal(proof.removalProven(target.row, before), false);
  target.content.attributes.text = '';
  assert.equal(proof.removalProven(target.row, before), false);
});

test('native backfill cannot conceal a remounted target or another identical message', () => {
  const { scroller, target, before, proof, makeRow } = fixture();
  target.row.remove();
  scroller.append(makeRow('Disposable message').row);
  assert.equal(proof.removalProven(target.row, before), false);
});

test('duplicate messages remain distinguishable through retained native group identity', () => {
  const { target, before, proof } = fixture({ duplicate: true });
  target.row.remove();
  assert.equal(proof.removalProven(target.row, before), true);
});

test('virtual window movement, detached containers, and loading states remain uncertain', () => {
  for (const mutate of [
    ({ scroller }) => { scroller.scrollTop = -40; },
    ({ neighbors }) => neighbors[0].group.remove(),
    ({ neighbors }) => { neighbors[0].content.attributes.text = 'Recycled neighbor'; },
    ({ scroller }) => scroller.remove(),
    ({ root }) => { root.attributes['aria-busy'] = 'true'; },
    ({ root, Element }) => root.append(new Element('div', { role: 'progressbar' })),
  ]) {
    const current = fixture();
    current.target.row.remove();
    mutate(current);
    assert.equal(current.proof.removalProven(current.target.row, current.before), false);
  }
});

test('new or reordered groups inside the retained neighborhood are not removal proof', () => {
  const { scroller, target, neighbors, before, proof, makeRow } = fixture();
  target.row.remove();
  const newRow = makeRow('Unexpected middle message').row;
  newRow.parentElement = scroller;
  scroller.children.splice(1, 0, newRow);
  assert.equal(proof.removalProven(target.row, before), false);
  newRow.remove();
  scroller.children = [neighbors[1].row, neighbors[0].row, target.row];
  assert.equal(proof.removalProven(target.row, before), false);
});

test('native optimistic disappearance that returns before settlement is not success', async () => {
  const { target, scroller, before, proof } = fixture();
  target.row.remove();
  const timer = setTimeout(() => scroller.append(target.row), 50);
  assert.equal(await proof.waitForRemoval(target.row, before, { timeoutMs: 220, stableMs: 150 }), false);
  clearTimeout(timer);
  target.row.remove();
  assert.equal(await proof.waitForRemoval(target.row, before, { timeoutMs: 220, stableMs: 75 }), true);
});

test('native removal with no retained message anchor stays uncertain', () => {
  const current = fixture();
  for (const neighbor of current.neighbors) neighbor.row.remove();
  const before = current.proof.removalEvidence(current.target.row);
  current.target.row.remove();
  assert.equal(current.proof.removalProven(current.target.row, before), false);
});

test('unmounting only a message group inside its retained virtual slot is not removal', () => {
  const { target, before, proof } = fixture();
  target.group.remove();
  assert.equal(target.row.isConnected, true);
  assert.equal(proof.removalProven(target.row, before), false);
});

test('far-off message virtualization does not invalidate retained local removal anchors', () => {
  const { scroller, target, proof, makeRow } = fixture();
  const newer = [0, 1, 2, 3].map((index) => makeRow(`Newer neighbor ${index}`));
  scroller.append(...newer.map(({ row }) => row));
  const before = proof.removalEvidence(target.row);
  target.row.remove();
  newer[2].group.remove();
  newer[3].group.remove();
  assert.equal(proof.removalProven(target.row, before), true);
  newer[1].group.remove();
  assert.equal(proof.removalProven(target.row, before), false, 'an immediate anchor may not disappear');
});
