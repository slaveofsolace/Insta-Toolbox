(() => {
  'use strict';
  if (globalThis.InstaToolboxInstagramViewer) return;
  const origin = 'https://www.instagram.com';
  const username = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(normalized) ? normalized : null;
  };
  function accountKey(value) {
    const normalized = username(value);
    if (!normalized) return null;
    return `iguser-v1-${[...normalized].map((character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
  }
  const visible = (node) => Boolean(node?.isConnected
    && !node.closest?.('[hidden], [aria-hidden="true"]')
    && node.getClientRects?.().length);
  function pathOf(link) {
    try {
      const url = new URL(link.getAttribute('href'), origin);
      return url.origin === origin && !url.username && !url.password
        && !url.search && !url.hash ? url.pathname : '';
    } catch { return ''; }
  }
  function inspect({ document = globalThis.document, location = globalThis.location,
    session = globalThis.InstaToolboxInstagramInspector?.inspectSession?.() || {} } = {}) {
    const unavailable = { accountVerified: false, usable: false, accountId: null, threadId: null };
    if (location?.origin !== origin) return { ...unavailable, reason: 'instagram-origin-required' };
    const threadId = String(location.pathname).match(/^\/direct\/t\/([0-9]+)\/?$/)?.[1] || null;
    const restriction = session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited;
    if (restriction) return { ...unavailable, threadId, restriction: true, reason: 'instagram-restricted' };
    const lists = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
    if (lists.length !== 1) return { ...unavailable, threadId, reason: 'account-picker-unavailable' };
    const list = lists[0];
    const headings = [...list.querySelectorAll('h2')].filter((heading) => {
      const picker = heading.closest('[role="button"][tabindex="0"]');
      return visible(heading) && picker && list.contains(picker) && visible(picker);
    });
    if (headings.length !== 1) return { ...unavailable, threadId, reason: 'account-picker-ambiguous' };
    const accountId = username(headings[0].textContent);
    if (!accountId) return { ...unavailable, threadId, reason: 'account-name-unavailable' };
    const profiles = [...document.querySelectorAll('a[role="link"][href]')].filter((link) => {
      if (!visible(link) || list.contains(link)
        || link.getAttribute('aria-label')?.startsWith('Open the profile page of')) return false;
      const match = pathOf(link).match(/^\/([a-z0-9._]+)\/?$/i);
      if (!match || username(match[1]) !== accountId) return false;
      const pictures = [...link.querySelectorAll('img')].filter(visible);
      if (pictures.length !== 1
        || String(pictures[0].getAttribute('alt')).toLowerCase() !== `${accountId}'s profile picture`) return false;
      for (let rail = link.parentElement; rail && rail !== document.body; rail = rail.parentElement) {
        if (rail.contains(list)) return false;
        const paths = new Set([...rail.querySelectorAll('a[href]')].filter(visible).map(pathOf));
        if (paths.has('/') && (paths.has('/reels/') || paths.has('/reels'))
          && (paths.has('/direct/inbox/') || paths.has('/direct/inbox'))) return true;
      }
      return false;
    });
    if (profiles.length !== 1) return { ...unavailable, threadId, reason: 'account-navigation-unavailable' };
    return { accountVerified: true, accountId, threadId, usable: Boolean(threadId),
      accountKey: accountKey(accountId), identityKind: 'verified-viewer-username',
      restriction: false, evidence: 'visible-account-picker-and-navigation' };
  }
  Object.defineProperty(globalThis, 'InstaToolboxInstagramViewer', {
    configurable: false, writable: false, value: Object.freeze({ inspect, accountKey }),
  });
})();
