const PROFILE_PATH = /^\/([A-Za-z0-9._]{1,30})\/?$/;
const STORY_PATH = /^\/stories\/([A-Za-z0-9._]{1,30})\/([^/?#]+)\/?/;
const CONTENT_PATH = /^\/(?:p|reel)\/([^/?#]+)\/?/;
const STORY_TILE_LABEL = /^story by ([A-Za-z0-9._]{1,30})(?:,|$)/i;
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
  const controlNames = (node) => new Set([
    node?.getAttribute?.('aria-label'),
    node?.textContent,
    ...[...node?.querySelectorAll?.('[aria-label]') || []]
      .map((element) => element.getAttribute?.('aria-label')),
    ...[...node?.querySelectorAll?.('title') || []].map((element) => element.textContent),
  ].map(lower).filter(Boolean));
  const hasControlName = (node, names) => [...controlNames(node)].some((name) => names.has(name));
  const buttonControls = (root) => [...new Set([
    ...root.querySelectorAll('button'),
    ...root.querySelectorAll('[role="button"]'),
  ])];
  const exactButtons = (root, names) => buttonControls(root)
    .filter(visible)
    .filter((node) => hasControlName(node, names));
  const exactControls = (root, names) => [...root.querySelectorAll('a[href],button,[role="button"]')]
    .filter(visible)
    .filter((node, index, all) => all.indexOf(node) === index)
    .filter((node) => hasControlName(node, names));
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
  const storyTile = (node) => {
    const match = clean(node?.getAttribute?.('aria-label')).match(STORY_TILE_LABEL);
    return match ? { username: match[1].toLocaleLowerCase() } : null;
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
  const storyViewerRoot = (expected) => {
    const match = String(location.pathname || '').match(STORY_PATH);
    if (!match || match[1].toLocaleLowerCase() !== expected.username
      || (expected.storyId && match[2] !== expected.storyId)) return null;
    const qualifying = (roots) => roots.filter(visible).filter((root) => {
      const media = [...root.querySelectorAll('video,img')].filter(visible);
      const controls = exactButtons(root, new Set(['pause', 'next', 'like', 'unlike']));
      return media.length > 0 && controls.length > 0;
    });
    const dialogs = qualifying([...document.querySelectorAll('[role="dialog"]')]);
    if (dialogs.length) return dialogs.length === 1 ? dialogs[0] : null;
    const mains = qualifying([...document.querySelectorAll('main')]);
    return mains.length === 1 ? mains[0] : null;
  };
  const storyLoaded = (expected) => Boolean(storyViewerRoot(expected));
  const profileControls = (root, username) => [...root.querySelectorAll('a[href]')]
    .filter(visible)
    .filter((node) => profile(node)?.username === username);
  const profileRouteForStory = (hint, username) => {
    let node = hint?.parentElement || null;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const matches = profileControls(node, username);
      if (matches.length === 1) return { root: node, control: matches[0] };
      if (matches.length > 1) return null;
    }
    const matches = profileControls(document, username);
    return matches.length === 1 ? { root: document, control: matches[0] } : null;
  };
  const profileStoryControl = (username) => {
    const names = new Set(['view story', 'watch story', `${username}'s story`, `view ${username}'s story`]);
    const matches = exactControls(document, names).filter((node) => {
      const target = story(node);
      return !target || target.username === username;
    });
    return matches.length === 1 ? matches[0] : null;
  };
  const exactProfilePath = (username) => String(location.pathname || '').replace(/\/+$/, '') === `/${username}`;
  const waitFor = (predicate, signal, guard = null) => new Promise((resolve, reject) => {
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
      try {
        guard?.();
        result = predicate() === true;
      } catch (error) {
        return finish(false, error);
      }
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
      ready = () => location.pathname === '/'
        && (action !== 'viewStories' || candidates('viewStories').length > 0);
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
      const currentTarget = current
        ? { username: current[1].toLocaleLowerCase(), storyId: current[2] }
        : null;
      const viewerRoot = currentTarget ? storyViewerRoot(currentTarget) : null;
      if (viewerRoot) {
        const controls = exactButtons(viewerRoot, new Set(['next']));
        if (controls.length !== 1) return [];
        return [{ action, id: `story-next:${current[1].toLocaleLowerCase()}:${current[2]}`,
          label: 'Next story', target: { fromPath: String(location.pathname) },
          root: viewerRoot, control: controls[0] }];
      }
      const unique = new Map();
      for (const control of buttonControls(document).filter(visible)) {
        const target = storyTile(control);
        if (!target || unique.has(target.username)) continue;
        unique.set(target.username, { action,
          id: `story-tray:${target.username}`, label: `@${target.username}'s story`,
          target: { ...target, source: 'tray' }, root: control.parentElement || document, control });
      }
      if (unique.size) return [...unique.values()];
      for (const link of [...document.querySelectorAll('a[href]')].filter(visible)) {
        const target = story(link);
        if (!target || unique.has(target.username)) continue;
        const route = profileRouteForStory(link, target.username);
        if (!route) continue;
        unique.set(target.username, { action,
          id: `story-profile:${target.username}`, label: `@${target.username}'s story`,
          target: { username: target.username }, root: route.root, control: route.control });
      }
      return [...unique.values()];
    }
    if (action === 'reactStories') {
      const current = String(location.pathname || '').match(STORY_PATH);
      if (!current) return [];
      const target = { username: current[1].toLocaleLowerCase(), storyId: current[2] };
      const viewerRoot = storyViewerRoot(target);
      if (!viewerRoot) return [];
      const controls = exactButtons(viewerRoot, new Set(['like']));
      if (controls.length !== 1) return [];
      return [{ action, id: `story-reaction:${target.username}:${target.storyId}`,
        label: `React to @${target.username}'s story`, target, root: viewerRoot, control: controls[0] }];
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
        if (current.target.source === 'tray') {
          current.control.click();
          const verified = await waitFor(() => {
            const next = String(location.pathname || '').match(STORY_PATH);
            if (!next || next[1].toLocaleLowerCase() !== current.target.username) return false;
            return storyLoaded({ username: next[1].toLocaleLowerCase(), storyId: next[2] });
          }, signal, assertCurrent);
          return verified
            ? { verified: true, label: current.label, reason: 'Story opened' }
            : { verified: false, uncertain: true, reason: 'Story view could not be verified' };
        }
        if (!current.target.fromPath) {
          current.control.click();
          const profileReady = await waitFor(() => exactProfilePath(current.target.username)
            && Boolean(profileStoryControl(current.target.username)), signal, assertCurrent);
          if (!profileReady) {
            return { verified: false, skipped: true,
              reason: 'The profile or its story control was not available' };
          }
          assertCurrent();
          const storyControl = profileStoryControl(current.target.username);
          if (!storyControl) {
            return { verified: false, skipped: true, reason: 'The story control changed' };
          }
          const expected = story(storyControl) || { username: current.target.username };
          storyControl.click();
          const verified = await waitFor(() => storyLoaded(expected), signal, assertCurrent);
          return verified
            ? { verified: true, label: current.label, reason: 'Story opened' }
            : { verified: false, uncertain: true, reason: 'Story view could not be verified' };
        }
        current.control.click();
        const verified = await waitFor(() => {
          if (String(location.pathname) === current.target.fromPath) return false;
          const next = String(location.pathname).match(STORY_PATH);
          return Boolean(next) && storyLoaded({ username: next[1].toLocaleLowerCase(), storyId: next[2] });
        }, signal, assertCurrent);
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
