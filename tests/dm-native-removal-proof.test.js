import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');

function fixture({ duplicate = false, normalBottom = false } = {}) {
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
    getBoundingClientRect() { return { top: 10, bottom: 50, left: 10, right: 110, width: 100, height: 40 }; }
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
  const scroller = new Element();
  Object.assign(scroller, { scrollTop: normalBottom ? 300 : 0, scrollHeight: 500, clientHeight: 200 });
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
  const neighbors = [makeRow('Earlier message'), makeRow(duplicate ? 'Disposable message' : 'Adjacent message')];
  const target = makeRow('Disposable message');
  scroller.append(...neighbors.map(({ row }) => row), target.row);
  const context = vm.createContext({ Date, setTimeout, clearTimeout, DOMException });
  vm.runInContext(source, context);
  const proof = context.InstaToolboxDmThreadUnsender.messageProof;
  const before = proof.removalEvidence(target.row);
  return { root, scroller, target, neighbors, before, proof, makeRow, Element };
}

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
