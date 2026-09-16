import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/instagram-viewer.js', import.meta.url), 'utf8');
function fixture() {
  const context = vm.createContext({ URL, Object }); vm.runInContext(source, context);
  const node = (attributes = {}) => ({ attributes, isConnected: true, parentElement: null,
    getAttribute(name) { return this.attributes[name] || null; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    closest() { return null; }, querySelectorAll() { return []; }, contains(other) { return other === this; },
  });
  const picker = node();
  const heading = node(); heading.textContent = 'fixture_viewer';
  heading.closest = (selector) => selector === '[role="button"][tabindex="0"]' ? picker : null;
  const list = node(); list.querySelectorAll = () => [heading]; list.contains = (item) => [list, picker, heading].includes(item);
  const picture = node({ alt: "fixture_viewer's profile picture" });
  const profile = node({ href: '/fixture_viewer/', role: 'link' }); profile.querySelectorAll = () => [picture];
  const links = [node({ href: '/' }), node({ href: '/reels/' }), node({ href: '/direct/inbox/' }), profile];
  const rail = node(); rail.querySelectorAll = () => links; profile.parentElement = rail;
  const document = { body: node(), querySelectorAll: (selector) => selector === '[aria-label="Thread list"]' ? [list] : [profile] };
  rail.parentElement = document.body;
  const options = { document, location: { origin: 'https://www.instagram.com', pathname: '/direct/t/12345/' }, session: {} };
  return { inspect: () => context.InstaToolboxInstagramViewer.inspect(options), options,
    list, heading, picker, profile, picture, rail, links, document, node };
}

test('viewer identity requires matching account picker and global navigation', () => {
  const f = fixture(), result = f.inspect();
  assert.equal(result.accountVerified, true); assert.equal(result.accountId, 'fixture_viewer');
  assert.equal(result.threadId, '12345'); assert.equal(result.usable, true);
});

test('a conversation peer or generic avatar does not identify the viewer', () => {
  for (const mutate of [
    (f) => { f.profile.attributes['aria-label'] = 'Open the profile page of fixture_viewer'; },
    (f) => { f.links.splice(1, 1); },
    (f) => { f.picture.attributes.alt = "someone_else's profile picture"; },
    (f) => { f.heading.textContent = 'different_viewer'; },
    (f) => { f.rail.contains = () => true; },
    (f) => { f.profile.attributes.href = 'https://example.com/fixture_viewer/'; },
    (f) => { f.profile.hidden = true; },
    (f) => { f.picker.hidden = true; },
  ]) { const f = fixture(); mutate(f); assert.equal(f.inspect().accountVerified, false); }
});

test('missing or ambiguous identity is unavailable, not guessed from a fallback', () => {
  for (const mutate of [
    (f) => { f.list.querySelectorAll = () => [f.heading, f.heading]; },
    (f) => { f.document.querySelectorAll = (selector) => selector === '[aria-label="Thread list"]' ? [f.list] : [f.profile, f.profile]; },
    (f) => { f.heading.textContent = 'Messages'; f.profile.attributes.href = '/not_messages/'; },
    (f) => { f.heading.closest = () => null; },
  ]) { const f = fixture(); mutate(f); assert.equal(f.inspect().accountVerified, false); }
});

test('restrictions, non-Instagram origins, and non-thread routes cannot be usable', () => {
  for (const restriction of ['sessionExpired', 'challenge', 'actionBlocked', 'rateLimited']) {
    const f = fixture(); f.options.session[restriction] = true;
    assert.equal(f.inspect().usable, false); assert.equal(f.inspect().restriction, true);
  }
  const other = fixture(); other.options.location.origin = 'https://example.com';
  assert.equal(other.inspect().accountVerified, false);
  const inbox = fixture(); inbox.options.location.pathname = '/direct/inbox/';
  assert.equal(inbox.inspect().accountVerified, true); assert.equal(inbox.inspect().usable, false);
});
