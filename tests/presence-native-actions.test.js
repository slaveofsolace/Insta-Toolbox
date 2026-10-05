import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceNativeActions } from '../extension/presence-native-actions.js';

function element({ text = '', href = '', ariaLabel = '', role = '', click = () => {}, children = {} } = {}) {
  return {
    isConnected: true,
    hidden: false,
    textContent: text,
    ariaLabel,
    role,
    parentElement: null,
    click,
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'aria-label') return this.ariaLabel || null;
      if (name === 'role') return this.role || null;
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

function connect(parent, ...children) {
  for (const child of children) child.parentElement = parent;
  return parent;
}

test('stories without URL slide IDs advance by active media and keep reactions bound to that slide', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/stories/person/' };
  let source = '/fixture/slide-one.mp4';
  const media = element();
  media.getAttribute = name => name === 'src' ? source : null;
  media.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 700, right: 400, width: 400, height: 700 });
  const pause = element({ text: 'Pause' });
  const next = element({ text: 'Next', click: () => { source = '/fixture/slide-two.mp4'; } });
  const like = element({ text: 'Like', click() { this.textContent = 'Unlike'; } });
  const viewer = connect(element({ children: { 'video,img': [media], button: [pause, next, like] } }), pause, next, like);
  const doc = { documentElement: {}, body: viewer,
    querySelectorAll: selector => selector === 'main' ? [viewer] : [] };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({ document: doc, location,
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ display: 'block', opacity: '1' }), MutationObserver: Observer, timeoutMs: 500 });
  const options = { signal: new AbortController().signal, assertCurrent: () => true };
  const first = await actions.find('viewStories', options);
  const oldReaction = await actions.find('reactStories', options);
  assert.match(first.id, /^story-next:person:media-/);
  assert.equal((await actions.execute('viewStories', first, options)).verified, true);
  assert.equal(location.pathname, '/stories/person/', 'Instagram can change slides without changing the URL');
  const second = await actions.find('viewStories', options);
  assert.notEqual(second.id, first.id);
  assert.equal((await actions.execute('reactStories', oldReaction, options)).skipped, true);
  const reaction = await actions.find('reactStories', options);
  assert.equal((await actions.execute('reactStories', reaction, options)).verified, true);
});

test('Presence closes the story before looking for feed controls rather than clicking behind the viewer', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/stories/person/one/' };
  const calls = [];
  const like = element({ text: 'Like' });
  const article = element({ children: { 'a[href]': [element({ href: '/p/post/' })], button: [like] } });
  const close = element({ text: 'Close', click() { calls.push('close'); location.pathname = '/'; this.isConnected = false; } });
  const doc = { documentElement: {}, querySelectorAll: selector => selector === 'article' ? [article]
    : selector === 'a[href],button,[role="button"]' ? [close] : [] };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({ document: doc, location,
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ opacity: '1' }), MutationObserver: Observer, timeoutMs: 500 });
  const candidate = await actions.find('likePosts', { signal: new AbortController().signal });
  assert.deepEqual(calls, ['close']); assert.equal(candidate.id, 'post:post');
});

test('an open notification drawer without aria-expanded is not toggled shut while searching for requests', async () => {
  let clicks = 0;
  const notifications = element({ text: 'Notifications', click: () => { clicks += 1; } });
  const close = element({ text: 'Close Notifications' });
  const doc = { documentElement: {}, querySelectorAll: selector => selector === 'a[href],button,[role="button"]'
    ? [notifications, close] : [] };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({ document: doc,
    location: { origin: 'https://www.instagram.com', pathname: '/' },
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ opacity: '1' }), MutationObserver: Observer, timeoutMs: 500 });
  assert.equal(await actions.find('acceptRequests', { signal: new AbortController().signal }), null);
  assert.equal(clicks, 0);
});

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

test('Presence recognizes Instagram navigation whose icon and caption duplicate Home text', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/direct/t/123/' };
  let homeClicks = 0;
  const contentLink = element({ href: '/p/live-feed-post/' });
  const like = element({ text: 'Like' });
  const article = element({ children: { 'a[href]': [contentLink], button: [like] } });
  const homeIcon = element({ ariaLabel: 'Home' });
  const home = element({
    text: 'HomeHome',
    href: '/',
    children: { '[aria-label]': [homeIcon] },
    click() {
      homeClicks += 1;
      location.pathname = '/';
      documentFixture.articles = [article];
    },
  });
  const documentFixture = {
    articles: [],
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'article') return this.articles;
      if (selector === 'a[href],button,[role="button"]') return [home];
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
  const candidate = await actions.find('likePosts', {
    seen: new Set(),
    signal: new AbortController().signal,
  });
  assert.equal(homeClicks, 1);
  assert.equal(candidate.id, 'post:live-feed-post');
});

test('Presence waits for the feed to mount after Home navigation and accepts native reels links', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/direct/inbox/' };
  let mounted = false, scrolls = 0;
  const article = element({ children: {
    'a[href]': [element({ href: '/reels/fixture-reel/' })], button: [element({ text: 'Like' })],
  } });
  const home = element({ text: 'Home', href: '/', click() {
    location.pathname = '/'; setTimeout(() => { mounted = true; }, 60);
  } });
  const doc = { documentElement: {}, scrollingElement: { scrollBy() { scrolls += 1; } },
    querySelectorAll: selector => selector === 'article' ? mounted ? [article] : []
      : selector === 'a[href],button,[role="button"]' ? [home] : [],
  };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({ document: doc, location,
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ opacity: '1' }), MutationObserver: Observer, timeoutMs: 500 });
  const result = await actions.find('likePosts', { seen: new Set(), signal: new AbortController().signal });
  assert.equal(result.id, 'post:fixture-reel');
  assert.equal(scrolls, 0, 'initial feed loading must not be mistaken for an exhausted viewport');
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
  const main = element({ children: { 'video,img': [media], button: [next] } });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'main') return [main];
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

test('Presence opens the current Instagram story-tray control directly', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/' };
  let surface = 'tray';
  let storyClicks = 0;
  const tile = element({ role: 'button', ariaLabel: 'Story by person, not seen', click() {
    storyClicks += 1;
    surface = 'story';
    location.pathname = '/stories/person/one/';
  } });
  const tray = connect(element(), tile);
  const media = element();
  const pause = element({ role: 'button', ariaLabel: 'Pause' });
  const main = element({ children: { 'video,img': [media], '[role="button"]': [pause] } });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'main') return surface === 'story' ? [main] : [];
      if (selector === '[role="button"]') return surface === 'tray' ? [tile] : [pause];
      if (selector === 'button' || selector === 'a[href]') return [];
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
  assert.equal(candidate.id, 'story-tray:person');
  assert.equal(candidate.root, tray);
  const result = await actions.execute('viewStories', candidate, {
    signal: new AbortController().signal, assertCurrent: () => true,
  });
  assert.equal(storyClicks, 1);
  assert.equal(result.verified, true);
  assert.equal(result.reason, 'Story opened');
});

test('Presence recognizes current role-button post controls through their icon label', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/' };
  let likeClicks = 0;
  const contentLink = element({ href: '/p/current-dom/' });
  const icon = element({ ariaLabel: 'Like' });
  const like = element({ role: 'button', children: { '[aria-label]': [icon] }, click() {
    likeClicks += 1;
    icon.ariaLabel = 'Unlike';
  } });
  const article = element({ children: {
    'a[href]': [contentLink],
    button: [],
    '[role="button"]': [like],
  } });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'article') return [article];
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
  assert.equal(candidate.id, 'post:current-dom');
  const result = await actions.execute('likePosts', candidate, {
    signal: new AbortController().signal, assertCurrent: () => true,
  });
  assert.equal(likeClicks, 1);
  assert.equal(result.verified, true);
});

test('Presence opens an exact profile before clicking its visible story control', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/' };
  const clicks = [];
  let surface = 'home';
  const storyHint = element({ href: '/stories/person/one/', click() { clicks.push('direct-story'); } });
  const profileLink = element({ text: 'person', href: '/person/', click() {
    clicks.push('profile'); surface = 'profile'; location.pathname = '/person/';
  } });
  const row = connect(element({ children: { 'a[href]': [storyHint, profileLink] } }), storyHint, profileLink);
  const storyControl = element({ ariaLabel: 'View story', click() {
    clicks.push('story'); surface = 'story'; location.pathname = '/stories/person/one/';
  } });
  const media = element();
  const pause = element({ ariaLabel: 'Pause' });
  const main = element();
  main.querySelectorAll = (selector) => {
    if (selector === 'video,img') return surface === 'story' ? [media] : [];
    if (selector === 'button') return surface === 'profile' ? [storyControl] : surface === 'story' ? [pause] : [];
    return [];
  };
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'main') return [main];
      if (selector === 'a[href]') return surface === 'home' ? [storyHint, profileLink] : [];
      if (selector === 'a[href],button,[role="button"]') {
        if (surface === 'home') return [storyHint, profileLink];
        if (surface === 'profile') return [storyControl];
        return [pause];
      }
      if (selector === 'button') return surface === 'profile' ? [storyControl] : surface === 'story' ? [pause] : [];
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
  assert.equal(candidate.id, 'story-profile:person');
  assert.equal(candidate.root, row);
  const result = await actions.execute('viewStories', candidate, {
    signal: new AbortController().signal, assertCurrent: () => true,
  });
  assert.deepEqual(clicks, ['profile', 'story']);
  assert.equal(result.verified, true);
  assert.equal(result.reason, 'Story opened');
});

test('Presence does not click a direct story link without one exact profile route', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/' };
  let storyClicks = 0;
  const storyHint = element({ href: '/stories/person/one/', click() { storyClicks += 1; } });
  const profileOne = element({ text: 'person', href: '/person/' });
  const profileTwo = element({ text: 'person', href: '/person/' });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [storyHint, profileOne, profileTwo];
      if (selector === 'a[href],button,[role="button"]') return [storyHint, profileOne, profileTwo];
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
  assert.equal(candidate, null);
  assert.equal(storyClicks, 0);
  assert.equal(location.pathname, '/');
});

test('Presence rechecks the account context after profile navigation and before opening a story', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/' };
  let surface = 'home';
  let storyClicks = 0;
  let checks = 0;
  const storyHint = element({ href: '/stories/person/one/' });
  const profileLink = element({ text: 'person', href: '/person/', click() {
    surface = 'profile'; location.pathname = '/person/';
  } });
  connect(element({ children: { 'a[href]': [storyHint, profileLink] } }), storyHint, profileLink);
  const storyControl = element({ ariaLabel: 'View story', click() { storyClicks += 1; } });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'a[href]') return surface === 'home' ? [storyHint, profileLink] : [];
      if (selector === 'a[href],button,[role="button"]') return surface === 'home'
        ? [storyHint, profileLink] : [storyControl];
      if (selector === 'button') return surface === 'profile' ? [storyControl] : [];
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
  await assert.rejects(actions.execute('viewStories', candidate, {
    signal: new AbortController().signal,
    assertCurrent() {
      checks += 1;
      if (checks === 2) throw new Error('presence-context-changed');
      return true;
    },
  }), /presence-context-changed/);
  assert.equal(checks, 2);
  assert.equal(storyClicks, 0);
  assert.equal(location.pathname, '/person/');
});

test('Presence does not accept unrelated global media and controls as a loaded story viewer', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/stories/person/one/' };
  const media = element();
  const pause = element({ ariaLabel: 'Pause' });
  const main = element({ children: { 'video,img': [media], button: [] } });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'main') return [main];
      if (selector === 'button') return [pause];
      if (selector === 'main video, main img, [role="dialog"] video, [role="dialog"] img') return [media];
      return [];
    },
  };
  class Observer { observe() {} disconnect() {} }
  let clock = 0;
  const actions = createPresenceNativeActions({
    document: documentFixture, location, now: () => { clock += 500; return clock; },
    inspectViewer: () => ({ accountVerified: true, usable: true, accountId: 'viewer' }),
    getStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: Observer, timeoutMs: 500,
  });
  const candidate = await actions.find('viewStories', { seen: new Set(), signal: new AbortController().signal });
  assert.equal(candidate, null);
});

test('Presence waits for delayed story and profile discovery after clicking Home', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/direct/inbox/' };
  let ready = false;
  let homeClicks = 0;
  const storyHint = element({ href: '/stories/person/one/' });
  const profileLink = element({ text: 'person', href: '/person/' });
  connect(element({ children: { 'a[href]': [storyHint, profileLink] } }), storyHint, profileLink);
  const home = element({ text: 'Home', href: '/', click() {
    homeClicks += 1;
    location.pathname = '/';
    setTimeout(() => { ready = true; }, 20);
  } });
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'a[href]') return ready ? [storyHint, profileLink] : [home];
      if (selector === 'a[href],button,[role="button"]') return ready ? [storyHint, profileLink] : [home];
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
  assert.equal(homeClicks, 1);
  assert.equal(candidate.id, 'story-profile:person');
});

test('Presence rejects a restriction surface even when stale story media remains visible', async () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/' };
  let surface = 'home';
  let restricted = false;
  const storyHint = element({ href: '/stories/person/one/' });
  const profileLink = element({ text: 'person', href: '/person/', click() {
    surface = 'profile'; location.pathname = '/person/';
  } });
  connect(element({ children: { 'a[href]': [storyHint, profileLink] } }), storyHint, profileLink);
  const storyControl = element({ ariaLabel: 'View story', click() {
    surface = 'story'; location.pathname = '/stories/person/one/'; restricted = true;
  } });
  const media = element();
  const pause = element({ ariaLabel: 'Pause' });
  const main = element();
  main.querySelectorAll = (selector) => {
    if (selector === 'video,img') return surface === 'story' ? [media] : [];
    if (selector === 'button') return surface === 'profile' ? [storyControl] : surface === 'story' ? [pause] : [];
    return [];
  };
  const documentFixture = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'main') return [main];
      if (selector === 'a[href]') return surface === 'home' ? [storyHint, profileLink] : [];
      if (selector === 'a[href],button,[role="button"]') return surface === 'home'
        ? [storyHint, profileLink] : surface === 'profile' ? [storyControl] : [pause];
      if (selector === 'button') return surface === 'profile' ? [storyControl] : surface === 'story' ? [pause] : [];
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
  await assert.rejects(actions.execute('viewStories', candidate, {
    signal: new AbortController().signal,
    assertCurrent() {
      if (restricted) throw new Error('presence-context-changed');
      return true;
    },
  }), /presence-context-changed/);
  assert.equal(location.pathname, '/stories/person/one/');
});

test('Presence retains a verified account across same-tab full-screen routes', () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/viewer/' };
  const observations = [
    {
      accountVerified: true,
      usable: true,
      accountId: 'viewer',
      accountKey: 'iguser-v1-viewer',
    },
    {
      accountVerified: false,
      usable: false,
      accountId: '',
      accountKey: '',
    },
    {
      accountVerified: true,
      usable: true,
      accountId: 'other-account',
      accountKey: 'iguser-v1-other-account',
    },
  ];
  const documentFixture = {
    visibilityState: 'visible',
    wasDiscarded: false,
    querySelectorAll: () => [],
  };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({
    document: documentFixture,
    location,
    inspectViewer: () => observations.shift(),
    getStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: Observer,
  });

  assert.equal(actions.inspectContext().accountId, 'viewer');
  const storyContext = actions.inspectContext();
  assert.equal(storyContext.accountId, 'viewer');
  assert.equal(storyContext.accountVerified, true);
  assert.equal(storyContext.routeIdentityRetained, true);
  assert.equal(actions.inspectContext().accountId, 'other-account');
});

test('Presence never masks an Instagram restriction with retained account identity', () => {
  const location = { origin: 'https://www.instagram.com', pathname: '/stories/person/one/' };
  const observations = [
    {
      accountVerified: true,
      usable: true,
      accountId: 'viewer',
      accountKey: 'iguser-v1-viewer',
    },
    {
      accountVerified: false,
      usable: false,
      accountId: '',
      accountKey: '',
      challenge: true,
    },
  ];
  const documentFixture = {
    visibilityState: 'visible',
    wasDiscarded: false,
    querySelectorAll: () => [],
  };
  class Observer { observe() {} disconnect() {} }
  const actions = createPresenceNativeActions({
    document: documentFixture,
    location,
    inspectViewer: () => observations.shift(),
    getStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: Observer,
  });

  actions.inspectContext();
  const restricted = actions.inspectContext();
  assert.equal(restricted.accountVerified, false);
  assert.equal(restricted.usable, false);
  assert.equal(restricted.challenge, true);
  assert.equal(restricted.routeIdentityRetained, undefined);
});
