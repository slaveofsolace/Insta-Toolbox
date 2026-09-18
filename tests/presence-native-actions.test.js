import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceNativeActions } from '../extension/presence-native-actions.js';

function element({ text = '', href = '', click = () => {}, children = {} } = {}) {
  return {
    isConnected: true,
    hidden: false,
    textContent: text,
    parentElement: null,
    click,
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'aria-label') return null;
      if (name === 'aria-hidden') return null;
      return null;
    },
    querySelector(selector) {
      return (children[selector] || [])[0] || null;
    },
    querySelectorAll(selector) {
      return children[selector] || [];
    },
    getClientRects: () => [{}],
  };
}

test('Presence reaches a feed by clicking the observed Home control before acting', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/direct/inbox/' };
  let homeClicks = 0;
  let likeClicks = 0;
  const contentLink = element({ href: '/p/abc123/' });
  const like = element({ text: 'Like', click() { likeClicks += 1; this.textContent = 'Unlike'; } });
  const article = element({ children: { 'a[href]': [contentLink], button: [like] } });
  const home = element({ text: 'Home', href: '/', click() {
    homeClicks += 1;
    location.pathname = '/';
    documentFixture.articles = [article];
  } });
  const documentFixture = {
    articles: [],
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'article') return this.articles;
      if (selector === 'a[href],button,[role="button"]') return [home];
      if (selector === 'button' || selector.includes('video') || selector.includes('img')) return [];
      return [];
    },
  };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({
    document: documentFixture,
    location,
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: Observer,
    timeoutMs: 500,
  });
  const candidate = await actions.find('likePosts', { seen: new Set(), signal: new AbortController().signal });
  assert.equal(homeClicks, 1);
  assert.equal(location.pathname, '/');
  assert.equal(candidate.id, 'post:abc123');
  const result = await actions.execute('likePosts', candidate, {
    signal: new AbortController().signal,
    assertCurrent: () => true,
  });
  assert.equal(likeClicks, 1);
  assert.equal(result.verified, true);
});

test('Presence never manufactures a destination when the matching native control is absent', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/direct/inbox/' };
  const documentFixture = {
    documentElement: {},
    querySelectorAll: () => [],
  };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({
    document: documentFixture,
    location,
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: Observer,
    timeoutMs: 500,
  });
  assert.equal(await actions.find('likePosts', { seen: new Set(), signal: new AbortController().signal }), null);
  assert.equal(location.pathname, '/direct/inbox/');
});

test('Presence scrolls the current native surface to find another exact target', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/' };
  let scrolls = 0;
  const contentLink = element({ href: '/p/after-scroll/' });
  const like = element({ text: 'Like' });
  const article = element({ children: { 'a[href]': [contentLink], button: [like] } });
  const documentFixture = {
    articles: [],
    documentElement: {},
    scrollingElement: { scrollBy() { scrolls += 1; documentFixture.articles = [article]; } },
    querySelectorAll(selector) {
      if (selector === 'article') return this.articles;
      return [];
    },
  };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({
    document: documentFixture, location,
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: Observer, timeoutMs: 500,
  });
  const candidate = await actions.find('likePosts', { seen: new Set(), signal: new AbortController().signal });
  assert.equal(scrolls, 1);
  assert.equal(candidate.id, 'post:after-scroll');
});

test('Presence advances stories through the observed Next control', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/stories/person/one/' };
  const media = element();
  const next = element({ text: 'Next', click() { location.pathname = '/stories/person/two/'; } });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'button') return [next];
      if (selector.includes('video') || selector.includes('img')) return [media];
      return [];
    },
  };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({
    document: documentFixture, location,
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: Observer, timeoutMs: 500,
  });
  const candidate = await actions.find('viewStories', { seen: new Set(), signal: new AbortController().signal });
  assert.equal(candidate.id, 'story-next:person:one');
  const result = await actions.execute('viewStories', candidate, {
    signal: new AbortController().signal, assertCurrent: () => true,
  });
  assert.equal(result.verified, true);
  assert.equal(result.reason, 'Next story opened');
});
