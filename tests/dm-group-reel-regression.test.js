import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');

function fixture() {
  const view = { getComputedStyle: (element) => element.style };
  const document = { defaultView: view };
  class Element {
    constructor(tag = 'div', attributes = {}, children = [], style = {}) {
      Object.assign(this, { tag, attributes, children: [], parentElement: null,
        ownerDocument: document, style, scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
      this.append(...children);
    }
    get isConnected() { return this === document.root || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this.attributes.text || this.children.map((child) => child.textContent).join(''); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }
    matches(selector) {
      return selector.split(',').some((entry) => {
        const part = entry.trim();
        const attribute = part.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
        return attribute ? this.hasAttribute(attribute[1])
          && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2])
          : part === this.tag;
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
  const root = new Element('div', { 'data-pagelet': 'IGDMessagesList' });
  document.root = root;
  const context = vm.createContext({ __instaToolboxTestHooks: true, Date, Map, Set, Object,
    getComputedStyle: view.getComputedStyle });
  vm.runInContext(source, context);
  return { Element, root, proof: context.InstaToolboxDmThreadUnsender.messageProof,
    runner: context.InstaToolboxDmThreadUnsender, view };
}

test('outgoing payload wrapper remains discoverable beside a non-content spacer', () => {
  const { Element, root, proof, view } = fixture();
  const payload = new Element('img', { alt: 'Shared reel' });
  const outgoing = new Element('div', {}, [payload], { justifyContent: 'flex-end' });
  const row = new Element('div', { role: 'row' }, [
    new Element('div', { 'aria-hidden': 'true' }), outgoing,
  ]);
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), true);
});

test('received payload is not outgoing merely because its sibling controls align right', () => {
  const { Element, root, proof, view } = fixture();
  const received = new Element('div', {}, [new Element('img')], { justifyContent: 'flex-start' });
  const controls = new Element('div', {}, [new Element('button', { text: 'React' })],
    { justifyContent: 'flex-end' });
  const row = new Element('div', { role: 'row' }, [received, controls]);
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), false);
});

test('native outgoing message group is recognized beside a timestamp heading', () => {
  const { Element, root, proof, view } = fixture();
  const actions = new Element('div', { role: 'group', 'aria-label': 'Message actions' },
    [new Element('button', { text: 'Options' })]);
  const body = new Element('div', {}, [new Element('span', { dir: 'auto', text: 'Newest disposable message' }), actions],
    { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' });
  const group = new Element('div', { role: 'group' }, [body]);
  const row = new Element('div', {}, [new Element('span', { text: '12:00 PM' }), group],
    { display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' });
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), true);
  body.style.justifyContent = 'flex-start';
  assert.equal(proof.sentByCurrentUser(row, view), false);
});

test('multiple native message groups cannot provide combined ownership proof', () => {
  const { Element, root, proof, view } = fixture();
  const makeGroup = () => new Element('div', { role: 'group' }, [
    new Element('div', { role: 'group', 'aria-label': 'Message actions' }, [new Element('button')]),
    new Element('span', { dir: 'auto', text: 'Disposable' }),
  ], { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' });
  const row = new Element('div', {}, [makeGroup(), makeGroup()]);
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), false);
});

test('native own story and reply messages keep ownership across branched group headings', () => {
  for (const headingCount of [1, 2]) {
    const { Element, root, proof, view } = fixture();
    const actions = new Element('div', { role: 'group', 'aria-label': 'Message actions' },
      [new Element('button', { text: 'Options' })]);
    const content = new Element('span', { dir: 'auto', text: 'Newest disposable reply' });
    const reverseBody = new Element('div', {}, [actions, content],
      { display: 'flex', flexDirection: 'row-reverse', justifyContent: 'flex-start' });
    const lane = new Element('div', {}, [reverseBody],
      { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' });
    const column = new Element('div', {}, [
      ...Array.from({ length: headingCount }, (_, index) => new Element('div', {
        dir: 'auto', text: `Reply or story context ${index}`,
      })), lane,
    ], { display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' });
    const group = new Element('div', { role: 'group' }, [column]);
    const row = new Element('div', {}, [new Element('span', { text: 'Timestamp' }), group]);
    root.append(row);
    assert.equal(proof.sentByCurrentUser(row, view), true, `${headingCount} context headings`);
    lane.style.justifyContent = 'flex-start';
    assert.equal(proof.sentByCurrentUser(row, view), false, 'the same received layout is not outgoing');
  }
});

test('native received message with nested right-aligned controls retains contradictory ownership', () => {
  const { Element, root, proof, view } = fixture();
  const actions = new Element('div', { role: 'group', 'aria-label': 'Message actions' },
    [new Element('button')]);
  const controlLane = new Element('div', {}, [
    new Element('span', { dir: 'auto', text: 'Reaction' }), actions,
  ], { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' });
  const receivedLane = new Element('div', {}, [
    new Element('span', { dir: 'auto', text: 'Received message' }), controlLane,
  ], { display: 'flex', flexDirection: 'row', justifyContent: 'flex-start' });
  const group = new Element('div', { role: 'group' }, [receivedLane]);
  root.append(group);
  assert.equal(proof.sentByCurrentUser(group, view), false);
});

test('newest candidates include a branched reply rather than skipping back to older plain text', () => {
  const { Element, root, runner } = fixture();
  const make = (headings, text) => {
    const actions = new Element('div', { role: 'group', 'aria-label': 'Message actions' },
      [new Element('button', { text: 'Options' })]);
    const lane = new Element('div', {}, [new Element('span', { dir: 'auto', text }), actions],
      { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' });
    const column = new Element('div', {}, [
      ...Array.from({ length: headings }, () => new Element('span', { text: 'Context heading' })), lane,
    ], { display: 'flex', flexDirection: 'column' });
    return new Element('div', {}, [new Element('div', { role: 'group' }, [column])]);
  };
  const older = make(0, 'Older plain message');
  const story = make(1, 'Story reply');
  const newest = make(2, 'Newest replied message');
  root.append(older, story, newest);
  assert.deepEqual([...runner.__test.orderedCandidates(root, 'newest')], [newest, story, older]);
  assert.deepEqual([...runner.__test.orderedCandidates(root, 'oldest')], [older, story, newest]);
});

test('vertical start alignment does not override an outgoing horizontal payload wrapper', () => {
  const { Element, root, proof, view } = fixture();
  const outgoing = new Element('div', {}, [new Element('img')],
    { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' });
  const row = new Element('div', { role: 'row' }, [outgoing],
    { display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' });
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), true);
});

test('incoming horizontal placement remains contradictory despite a nested end-aligned payload', () => {
  const { Element, root, proof, view } = fixture();
  const outgoing = new Element('div', {}, [new Element('img')],
    { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' });
  const row = new Element('div', { role: 'row' }, [outgoing],
    { display: 'flex', flexDirection: 'row', justifyContent: 'flex-start' });
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), false);
});

test('column end alignment alone never proves an outgoing message', () => {
  const { Element, root, proof, view } = fixture();
  const row = new Element('div', { role: 'row' }, [new Element('img')],
    { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' });
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), false);
});

test('hidden branches containing message content are not discarded as spacers', () => {
  const { Element, root, proof, view } = fixture();
  const row = new Element('div', { role: 'row' }, [
    new Element('div', { 'aria-hidden': 'true' }, [new Element('img')]),
    new Element('div', {}, [new Element('img')], { justifyContent: 'flex-end' }),
  ]);
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), false);
});

test('an empty hidden spacer never overrides incoming message placement', () => {
  const { Element, root, proof, view } = fixture();
  const row = new Element('div', { role: 'row' }, [
    new Element('div', { 'aria-hidden': 'true' }),
    new Element('div', {}, [new Element('img')], { justifyContent: 'flex-start' }),
  ]);
  root.append(row);
  assert.equal(proof.sentByCurrentUser(row, view), false);
});

test('removing one id-less media row is provable when its pre-existing identical-preview sibling stays', () => {
  const { Element, root, proof } = fixture();
  const first = new Element('div', { role: 'row' }, [new Element('img', { src: '/disposable-first.jpg' })]);
  const second = new Element('div', { role: 'row' }, [new Element('img', { src: '/disposable-second.jpg' })]);
  root.append(first, second);
  const before = proof.removalEvidence(first);
  assert.equal(before.text, 'Sent message');
  first.remove();
  assert.equal(proof.removalProven(first, before), true);
});

test('an id-less media row replaced by a new identical-preview node is not a verified removal', () => {
  const { Element, root, proof } = fixture();
  const first = new Element('div', { role: 'row' }, [new Element('img')]);
  root.append(first);
  const before = proof.removalEvidence(first);
  first.remove();
  root.append(new Element('div', { role: 'row' }, [new Element('img')]));
  assert.equal(proof.removalProven(first, before), false);
});

test('pre-existing duplicate text does not hide a proven id-less row removal', () => {
  const { Element, root, proof } = fixture();
  const first = new Element('div', { role: 'row' }, [new Element('span', { dir: 'auto', text: 'Same text' })]);
  const second = new Element('div', { role: 'row' }, [new Element('span', { dir: 'auto', text: 'Same text' })]);
  root.append(first, second);
  const before = proof.removalEvidence(first);
  first.remove();
  assert.equal(proof.removalProven(first, before), true);
});

test('a recycled retained sibling with changed media is not stable removal evidence', () => {
  const { Element, root, proof } = fixture();
  const first = new Element('div', { role: 'row' }, [new Element('img')]);
  const image = new Element('img', { src: '/original-disposable.jpg' });
  const second = new Element('div', { role: 'row' }, [image]);
  root.append(first, second);
  const before = proof.removalEvidence(first);
  first.remove();
  image.attributes.src = '/different-disposable.jpg';
  assert.equal(proof.removalProven(first, before), false);
});

test('a reordered retained neighborhood is not stable id-less removal evidence', () => {
  const { Element, root, proof } = fixture();
  const first = new Element('div', { role: 'row' }, [new Element('img')]);
  const second = new Element('div', { role: 'row' }, [new Element('img')]);
  const third = new Element('div', { role: 'row' }, [new Element('img')]);
  root.append(first, second, third);
  const before = proof.removalEvidence(first);
  first.remove();
  root.children.reverse();
  assert.equal(proof.removalProven(first, before), false);
});

test('a sibling with a changed message identity is not stable id-less removal evidence', () => {
  const { Element, root, proof } = fixture();
  const first = new Element('div', { role: 'row' }, [new Element('img')]);
  const second = new Element('div', { role: 'row', 'data-message-id': 'before' }, [new Element('img')]);
  root.append(first, second);
  const before = proof.removalEvidence(first);
  first.remove();
  second.attributes['data-message-id'] = 'after';
  assert.equal(proof.removalProven(first, before), false);
});
