const PROFILE_PATH = /^\/([A-Za-z0-9._]{1,30})\/?$/;
const STORY_PATH = /^\/stories\/([A-Za-z0-9._]{1,30})\/([^/?#]+)\/?/;
const CONTENT_PATH = /^\/(?:p|reel)\/([^/?#]+)\/?/;
const RESERVED = new Set(['accounts', 'about', 'api', 'direct', 'explore', 'reels', 'settings', 'stories', 'web']);

const clean = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const fail = (reason, details = {}) => Object.assign(new Error(reason), details);

export function createPresenceNativeActions({
  document = globalThis.document,
  location = globalThis.location,
  inspectViewer,
  getStyle = globalThis.getComputedStyle,
  MutationObserver = globalThis.MutationObserver,
  now = Date.now,
  timeoutMs = 6_000,
} = {}) {
  if (!document?.querySelectorAll || !location || typeof inspectViewer !== 'function'
    || typeof getStyle !== 'function' || typeof MutationObserver !== 'function'
    || typeof now !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 500) {
    throw new Error('presence-native-adapter-required');
  }

  const visible = (node) => {
    if (!node?.isConnected || node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
    const style = getStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || Number(style?.opacity) === 0) return false;
    const rects = node.getClientRects?.();
    return !rects || rects.length > 0;
  };
  const controlName = (node) => clean(node?.getAttribute?.('aria-label')
    || node?.textContent
    || node?.querySelector?.('[aria-label]')?.getAttribute?.('aria-label')
    || node?.querySelector?.('title')?.textContent);
  const exactButtons = (root, names) => [...root.querySelectorAll('button')]
    .filter(visible)
    .filter((node) => names.has(lower(controlName(node))));
  const exactControls = (root, names) => [...root.querySelectorAll('a[href],button,[role="button"]')]
    .filter(visible)
    .filter((node, index, all) => all.indexOf(node) === index)
    .filter((node) => names.has(lower(controlName(node))));
  const url = (node) => {
    try { return new URL(node?.getAttribute?.('href') || '', location.origin); }
    catch { return null; }
  };
  const profile = (node) => {
    const candidate = url(node);
    if (!candidate || candidate.origin !== location.origin) return null;
    const match = candidate.pathname.match(PROFILE_PATH);
    const username = match?.[1]?.toLocaleLowerCase() || '';
    return username && !RESERVED.has(username) ? { username, href: candidate.href } : null;
  };
  const content = (node) => {
    const candidate = url(node);
    if (!candidate || candidate.origin !== location.origin) return null;
    const match = candidate.pathname.match(CONTENT_PATH);
    return match ? { contentId: match[1], href: candidate.href } : null;
  };
  const story = (node) => {
    const candidate = url(node);
    if (!candidate || candidate.origin !== location.origin) return null;
    const match = candidate.pathname.match(STORY_PATH);
    return match ? { username: match[1].toLocaleLowerCase(), storyId: match[2], href: candidate.href } : null;
  };
  const logicalContainer = (control, buttonName) => {
    let node = control;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const matches = exactButtons(node, new Set([buttonName]));
      const profiles = [...node.querySelectorAll('a[href]')].map(profile).filter(Boolean);
      const names = new Set(profiles.map(value => value.username));
      if (matches.length === 1 && names.size === 1) return { node, profile: profiles[0] };
    }
    return null;
  };
  const storyLoaded = (expected) => {
    const match = String(location.pathname || '').match(STORY_PATH);
    if (!match || match[1].toLocaleLowerCase() !== expected.username || match[2] !== expected.storyId) return false;
    const media = [...document.querySelectorAll('main video, main img, [role="dialog"] video, [role="dialog"] img')].filter(visible);
    const controls = exactButtons(document, new Set(['pause', 'next', 'like', 'unlike']));
    return media.length > 0 && controls.length > 0;
  };
  const waitFor = (predicate, signal) => new Promise((resolve, reject) => {
    const startedAt = now();
    let observer = null;
    let timer = null;
    let settled = false;
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(false, new DOMException('Stopped', 'AbortError'));
    const check = () => {
      if (signal?.aborted) return abort();
      let result = false;
      try { result = predicate() === true; } catch {}
      if (result) return finish(true);
      if (now() - startedAt >= timeoutMs) return finish(false);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(check, 100);
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-label', 'href', 'hidden'] });
    check();
  });

  const routeControl = (pathnames, names) => {
    const matches = exactControls(document, names).filter((node) => {
      const candidate = url(node);
      return candidate?.origin === location.origin && pathnames.has(candidate.pathname);
    });
    return matches.length === 1 ? matches[0] : null;
  };
  const openSurface = async (action, signal) => {
    let control = null;
    let ready = null;
    if (['viewStories', 'likePosts'].includes(action) && location.pathname !== '/') {
      control = routeControl(new Set(['/']), new Set(['home']));
      ready = () => location.pathname === '/';
    } else if (action === 'followPeople' && !String(location.pathname).startsWith('/explore')) {
      control = routeControl(new Set(['/explore/', '/explore']), new Set(['explore']));
      ready = () => String(location.pathname).startsWith('/explore');
    } else if (action === 'acceptRequests') {
      const controls = exactControls(document, new Set(['notifications']));
      if (controls.length === 1 && controls[0].getAttribute?.('aria-expanded') !== 'true') {
        control = controls[0];
        ready = () => candidates('acceptRequests').length > 0
          || control.getAttribute?.('aria-expanded') === 'true';
      }
    }
    if (!control || typeof control.click !== 'function') return false;
    control.click();
    return waitFor(ready, signal);
  };
  const advanceSurface = async (action, seen, signal) => {
    if (!['likePosts', 'followPeople'].includes(action)) return false;
    const surface = document.scrollingElement || document.documentElement;
    if (typeof surface?.scrollBy !== 'function') return false;
    surface.scrollBy({ top: Math.max(320, Math.round(Number(globalThis.innerHeight || 800) * .75)),
      left: 0, behavior: 'auto' });
    return waitFor(() => candidates(action).some(candidate => !seen.has(candidate.id)), signal);
  };

  function candidates(action) {
    if (action === 'likePosts') {
      return [...document.querySelectorAll('article')].filter(visible).flatMap((article) => {
        const links = [...article.querySelectorAll('a[href]')].map(content).filter(Boolean);
        const distinct = new Map(links.map(item => [item.contentId, item]));
        const controls = exactButtons(article, new Set(['like']));
        if (distinct.size !== 1 || controls.length !== 1) return [];
        const target = [...distinct.values()][0];
        return [{ action, id: `post:${target.contentId}`, label: `Post ${target.contentId}`,
          target, root: article, control: controls[0] }];
      });
    }
    if (action === 'followPeople') {
      return exactButtons(document, new Set(['follow'])).flatMap((control) => {
        const resolved = logicalContainer(control, 'follow');
        if (!resolved) return [];
        const viewer = inspectViewer();
        if (resolved.profile.username === lower(viewer?.accountId)) return [];
        return [{ action, id: `profile:${resolved.profile.username}`, label: `@${resolved.profile.username}`,
          target: resolved.profile, root: resolved.node, control }];
      });
    }
    if (action === 'viewStories') {
      const current = String(location.pathname || '').match(STORY_PATH);
      if (current && storyLoaded({ username: current[1].toLocaleLowerCase(), storyId: current[2] })) {
        const controls = exactButtons(document, new Set(['next']));
        if (controls.length !== 1) return [];
        return [{ action, id: `story-next:${current[1].toLocaleLowerCase()}:${current[2]}`,
          label: 'Next story', target: { fromPath: String(location.pathname) },
          root: document, control: controls[0] }];
      }
      const unique = new Map();
      for (const link of [...document.querySelectorAll('a[href]')].filter(visible)) {
        const target = story(link);
        if (target && !unique.has(target.storyId)) unique.set(target.storyId, { action,
          id: `story:${target.username}:${target.storyId}`, label: `@${target.username}'s story`,
          target, root: link, control: link });
      }
      return [...unique.values()];
    }
    if (action === 'reactStories') {
      const current = String(location.pathname || '').match(STORY_PATH);
      if (!current) return [];
      const controls = exactButtons(document, new Set(['like']));
      if (controls.length !== 1) return [];
      const target = { username: current[1].toLocaleLowerCase(), storyId: current[2] };
      return [{ action, id: `story-reaction:${target.username}:${target.storyId}`,
        label: `React to @${target.username}'s story`, target, root: document, control: controls[0] }];
    }
    if (action === 'acceptRequests') {
      return exactButtons(document, new Set(['confirm'])).flatMap((control) => {
        const resolved = logicalContainer(control, 'confirm');
        if (!resolved) return [];
        return [{ action, id: `request:${resolved.profile.username}`, label: `@${resolved.profile.username}`,
          target: resolved.profile, root: resolved.node, control }];
      });
    }
    return [];
  }

  function resolve(action, id) {
    const matches = candidates(action).filter((candidate) => candidate.id === id);
    return matches.length === 1 ? matches[0] : null;
  }

  return Object.freeze({
    inspectContext() {
      const viewer = inspectViewer();
      return Object.freeze({ ...viewer,
        frozen: document.visibilityState === 'hidden' && document.wasDiscarded === true,
        discarded: document.wasDiscarded === true });
    },
    async find(action, { seen = new Set(), signal } = {}) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      let available = candidates(action).filter((candidate) => !seen.has(candidate.id));
      if (!available.length && await openSurface(action, signal)) {
        available = candidates(action).filter((candidate) => !seen.has(candidate.id));
      }
      if (!available.length && await advanceSurface(action, seen, signal)) {
        available = candidates(action).filter((candidate) => !seen.has(candidate.id));
      }
      return available.length ? Object.freeze(available[0]) : null;
    },
    async execute(action, candidate, { signal, assertCurrent } = {}) {
      if (!candidate || candidate.action !== action || typeof assertCurrent !== 'function') {
        throw new Error('presence-native-target-invalid');
      }
      assertCurrent();
      const current = resolve(action, candidate.id);
      if (!current || current.control !== candidate.control || current.root !== candidate.root) {
        return { verified: false, skipped: true, reason: 'Target changed before the action' };
      }
      if (action === 'viewStories') {
        current.control.click();
        const verified = await waitFor(() => {
          if (!current.target.fromPath) return storyLoaded(current.target);
          if (String(location.pathname) === current.target.fromPath) return false;
          const next = String(location.pathname).match(STORY_PATH);
          return Boolean(next) && storyLoaded({ username: next[1].toLocaleLowerCase(), storyId: next[2] });
        }, signal);
        return verified
          ? { verified: true, label: current.label,
            reason: current.target.fromPath ? 'Next story opened' : 'Story opened' }
          : { verified: false, uncertain: true, reason: 'Story view could not be verified' };
      }
      current.control.click();
      const verified = await waitFor(() => {
        if (!current.root.isConnected) return false;
        if (action === 'likePosts' || action === 'reactStories') {
          return exactButtons(current.root, new Set(['unlike'])).length === 1;
        }
        if (action === 'followPeople') {
          return exactButtons(current.root, new Set(['following', 'requested'])).length === 1;
        }
        if (action === 'acceptRequests') {
          return exactButtons(current.root, new Set(['following', 'remove'])).length === 1;
        }
        return false;
      }, signal);
      if (!verified) return { verified: false, uncertain: true, reason: 'Instagram did not confirm the action' };
      const reason = action === 'likePosts' ? 'Post liked'
        : action === 'reactStories' ? 'Story reaction added'
          : action === 'followPeople'
            ? (exactButtons(current.root, new Set(['requested'])).length === 1
              ? 'Follow requested'
              : 'Follow confirmed')
            : 'Incoming request accepted';
      return { verified: true, label: current.label, reason };
    },
    inspectAvailable: () => Object.freeze(Object.fromEntries([
      'viewStories', 'reactStories', 'likePosts', 'followPeople', 'acceptRequests',
    ].map(action => [action, candidates(action).length]))),
  });
}
