const ORIGIN = 'https://www.instagram.com';
const clean = (value, limit = 160) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
const visible = node => Boolean(node?.isConnected && node.getClientRects?.().length
  && !node.closest?.('[hidden], [aria-hidden="true"]'));
const route = href => {
  if (typeof href !== 'string' || !href.trim()) return null;
  try { const url = new URL(href, ORIGIN); return url.origin === ORIGIN ? url.pathname : null; }
  catch { return null; }
};

export function summarizeLoadedPosts(observations, { sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(observations) || observations.length > 1000) throw new Error('Too many loaded posts.');
  const source = route(sourceUrl);
  if (!source) throw new Error('Open Instagram first.');
  const posts = new Map();
  for (const observation of observations) {
    const path = route(observation.url);
    const match = path?.match(/^\/(p|reel|reels)\/([\w-]+)\/?$/);
    if (!match) continue;
    const id = match[2];
    const timestamp = Date.parse(observation.publishedAt);
    const hashtags = [...new Set((observation.hashtags || []).map(tag => clean(tag, 100).replace(/^#/, '').toLowerCase())
      .filter(tag => /^[\p{L}\p{M}\p{N}_]+$/u.test(tag)))];
    const previous = posts.get(id);
    posts.set(id, { id, url: `${ORIGIN}/p/${id}/`,
      type: ['photo', 'video', 'carousel'].includes(observation.type) ? observation.type : previous?.type || 'unknown',
      publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : previous?.publishedAt || null,
      hashtags: [...new Set([...(previous?.hashtags || []), ...hashtags])],
    });
  }
  const counts = { photo: 0, video: 0, carousel: 0, unknown: 0 };
  const tags = new Map();
  const weekdays = Array(7).fill(0);
  let datedPosts = 0;
  for (const post of posts.values()) {
    counts[post.type] += 1;
    for (const tag of post.hashtags) tags.set(tag, (tags.get(tag) || 0) + 1);
    if (post.publishedAt) { weekdays[new Date(post.publishedAt).getUTCDay()] += 1; datedPosts += 1; }
  }
  return { schema: 1, kind: 'insta-toolbox-loaded-insights', sourceUrl: `${ORIGIN}${source}`,
    capturedAt, coverage: 'loaded-posts-only', hashtagSource: 'post-or-comment-links', timezone: 'UTC', posts: [...posts.values()], counts,
    hashtags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, posts]) => ({ tag, posts })), weekdays, datedPosts };
}

export function readLoadedInsights({ document = globalThis.document, location = globalThis.location,
  now = () => new Date().toISOString() } = {}) {
  if (location.origin !== ORIGIN) throw new Error('Open Instagram first.');
  if (String(location.pathname).startsWith('/direct')) throw new Error('Open a profile or feed to inspect posts.');
  const articles = [...document.querySelectorAll('article')].filter(visible).slice(0, 1000);
  const observations = articles.flatMap(article => {
    const paths = [...article.querySelectorAll('a[href]')].filter(visible)
      .map(link => route(link.getAttribute('href'))).filter(Boolean);
    const identities = new Map(paths.map(path => {
      const match = path.match(/^\/(p|reel|reels)\/([\w-]+)\/?$/);
      return match ? [match[2], path] : null;
    }).filter(Boolean));
    if (identities.size !== 1) return [];
    const hashtags = paths.filter(path => path.startsWith('/explore/tags/')).flatMap(path => {
      try { return [decodeURIComponent(path.split('/')[3])]; } catch { return []; }
    });
    const carousel = [...article.querySelectorAll('[aria-label]')].some(node => visible(node)
      && /^(?:carousel|slide \d+ of \d+)$/i.test(node.getAttribute('aria-label') || ''));
    const type = carousel ? 'carousel' : article.querySelector('video') ? 'video' : 'unknown';
    const times = [...article.querySelectorAll('time[datetime]')].filter(node => {
      const path = route(node.closest('a[href]')?.getAttribute('href'));
      return path && identities.has(path.match(/^\/(?:p|reel|reels)\/([\w-]+)\/?$/)?.[1]);
    }).map(node => node.getAttribute('datetime'));
    return [{ url: `${ORIGIN}${[...identities.values()][0]}`, type, hashtags,
      publishedAt: new Set(times).size === 1 ? times[0] : null }];
  });
  for (const link of document.querySelectorAll('main a[href]')) {
    if (!visible(link) || link.closest('article') || observations.length >= 1000) continue;
    const path = route(link.getAttribute('href'));
    if (!/^\/(p|reel|reels)\/[\w-]+\/?$/.test(path || '')) continue;
    observations.push({ url: `${ORIGIN}${path}`, type: 'unknown', hashtags: [] });
  }
  const report = summarizeLoadedPosts(observations, { sourceUrl: location.href, capturedAt: now() });
  const username = String(location.pathname).match(/^\/([a-zA-Z0-9_.]{1,30})\/?$/)?.[1];
  report.profile = null;
  if (username) {
    const headers = [...document.querySelectorAll('main header')].filter(visible).filter(header =>
      [...header.querySelectorAll('a[href]')].some(link => route(link.getAttribute('href')) === `/${username}/followers/`));
    if (headers.length === 1) {
      const count = list => {
        const links = [...headers[0].querySelectorAll('a[href]')].filter(visible)
          .filter(link => route(link.getAttribute('href')) === `/${username}/${list}/`);
        return links.length === 1 ? clean(links[0].textContent) : null;
      };
      report.profile = { username, followers: count('followers'), following: count('following') };
    }
  }
  return report;
}

export function formatInsightsReport(report) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return ['Insta Toolbox · Loaded post insights', `Page: ${report.sourceUrl}`, `Captured: ${report.capturedAt}`,
    `Sample: ${report.posts.length} loaded posts — not complete account history.`,
    ...(report.profile ? [`Profile: @${report.profile.username}`, report.profile.followers, report.profile.following].filter(Boolean) : []),
    '', 'MEDIA', ...Object.entries(report.counts).map(([type, count]) => `${type}: ${count}`),
    '', 'LINKED HASHTAGS · sampled posts containing the link',
    'Links may be in captions or comments; they are not attributed to the post author.',
    ...report.hashtags.map(item => `#${item.tag}: ${item.posts}`),
    '', `POSTING DAYS · UTC · ${report.datedPosts} dated posts`, ...report.weekdays.map((n, i) => `${days[i]}: ${n}`),
    '', 'POSTS', ...report.posts.map((post, index) => `${index + 1}. ${post.url} · ${post.type} · ${post.publishedAt || 'Date unavailable'}`),
    '', 'Missing types and dates are unknown, not zero. No additional Instagram requests were made.', ''].join('\n');
}

export function mountLoadedInsights({ container, document = globalThis.document, window = globalThis.window,
  onStatus = () => {} } = {}) {
  const create = (tag, text, className) => {
    const node = document.createElement(tag); if (text) node.textContent = text;
    if (className) node.className = className; return node;
  };
  const details = create('details', null, 'settings-inline');
  details.append(create('summary', 'Profile and content insights'));
  const note = create('p', 'Summarize posts already loaded on this page. No extra requests.', 'lead');
  const read = create('button', 'Read loaded posts', 'button quiet'); read.type = 'button';
  const output = create('div', null, 'card'); output.hidden = true;
  const download = create('button', 'Download report', 'button quiet'); download.type = 'button'; download.hidden = true;
  const json = create('button', 'Download JSON', 'button quiet'); json.type = 'button'; json.hidden = true;
  const actions = create('div', null, 'toolbar'); actions.append(read, download, json);
  details.append(note, actions, output); container.replaceChildren(details);
  let report = null;
  read.addEventListener('click', () => {
    try {
      report = readLoadedInsights({ document, location: window.location });
      output.replaceChildren(create('strong', `${report.posts.length} loaded posts`),
        create('p', 'A sample of this page, not the account’s complete history.', 'lead'),
        create('p', `${report.sourceUrl} · ${new Date(report.capturedAt).toLocaleString()}`, 'lead'));
      if (report.profile) output.append(create('p', `@${report.profile.username} · ${[report.profile.followers, report.profile.following].filter(Boolean).join(' · ')}`));
      output.append(create('p', Object.entries(report.counts).filter(([, n]) => n > 0).map(([type, n]) => `${n} ${type}`).join(' · ') || 'Open a post or scroll your feed, then read again.'));
      if (report.hashtags.length) output.append(create('strong', 'Linked hashtags'),
        create('p', 'From loaded captions and comments; not attributed to the post author.', 'lead'),
        create('p', report.hashtags.slice(0, 30).map(item => `#${item.tag} (${item.posts})`).join(' · ')));
      const list = create('ul', null, 'list list--compact');
      for (const post of report.posts.slice(0, 50)) {
        const row = create('li'); const link = create('a', `Post ${post.id}`);
        link.href = post.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        row.append(link, create('span', ` · ${post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : 'Date unavailable'}`));
        list.append(row);
      }
      output.append(list); output.hidden = false;
      download.hidden = json.hidden = false;
      onStatus(`Read ${report.posts.length} loaded posts. No additional requests.`);
    } catch (error) { onStatus(`${error.message}${report ? ' Previous sample shown below.' : ''}`); }
  });
  const save = type => {
    if (!report) return;
    const data = type === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatInsightsReport(report);
    const url = window.URL.createObjectURL(new window.Blob([data], { type: type === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
    const link = create('a'); link.href = url; link.download = `insta-toolbox-insights.${type}`; link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  };
  download.addEventListener('click', () => save('txt')); json.addEventListener('click', () => save('json'));
  return Object.freeze({ dispose: () => details.remove() });
}
