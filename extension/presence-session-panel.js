import { PRESENCE_ACTION_LABELS, normalizePresenceSessionOptions } from './presence-session.js';

const ACTIONS = Object.freeze([
  ['viewStories', 'View stories'],
  ['reactStories', 'React to stories'],
  ['likePosts', 'Like posts'],
  ['followPeople', 'Follow people'],
  ['acceptRequests', 'Accept follow requests'],
]);

const clean = (value) => String(value ?? '').trim();

export function mountPresenceSessionPanel({
  container,
  session,
  inspectAccount,
  confirmAction,
  readPreferences = () => null,
  writePreferences = () => {},
  busy = () => false,
  onStatus = () => {},
  document = globalThis.document,
  now = Date.now,
} = {}) {
  if (!container || !document?.createElement || typeof session?.createReview !== 'function'
    || typeof session?.start !== 'function' || typeof session?.snapshot !== 'function'
    || typeof inspectAccount !== 'function' || typeof confirmAction !== 'function'
    || typeof readPreferences !== 'function' || typeof writePreferences !== 'function'
    || typeof busy !== 'function' || typeof onStatus !== 'function' || typeof now !== 'function') {
    throw new Error('presence-panel-adapter-required');
  }

  const create = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = create('section', null, 'presence-session');
  root.setAttribute('aria-labelledby', 'insta-toolbox-presence-title');
  const style = create('style', `
    .presence-session{display:grid;gap:16px;min-width:0;color:var(--insta-toolbox-text);font:inherit}
    .presence-session h2,.presence-session p{margin:0;overflow-wrap:anywhere}
    .presence-session h2{font-size:18px;line-height:1.35}
    .presence-session .presence-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .presence-session .presence-option{display:flex;align-items:center;gap:10px;min-width:0;min-height:44px;padding:8px 10px;border:1px solid var(--insta-toolbox-line);border-radius:10px;background:var(--insta-toolbox-bg-sunken)}
    .presence-session .presence-option:last-child:nth-child(odd){grid-column:1/-1}
    .presence-session .presence-option input{flex:0 0 auto;width:18px;height:18px;accent-color:var(--insta-toolbox-accent)}
    .presence-session .presence-limit{display:grid;gap:6px;max-width:180px}
    .presence-session .presence-limit input{box-sizing:border-box;width:100%;min-height:44px;font:inherit;color:inherit;background:var(--insta-toolbox-bg-sunken);border:1px solid var(--insta-toolbox-line);border-radius:8px;padding:8px 10px}
    .presence-session .presence-controls{display:flex;flex-wrap:wrap;gap:8px}
    .presence-session .presence-controls .button{flex:1 1 132px;white-space:normal}
    .presence-session .presence-status{display:grid;gap:5px;padding:12px;border-left:3px solid var(--insta-toolbox-accent);background:var(--insta-toolbox-bg-sunken);border-radius:0 8px 8px 0}
    .presence-session .presence-status strong,.presence-session .presence-status span{overflow-wrap:anywhere}
    .presence-session .presence-status span{font-size:12px;line-height:1.5;color:var(--insta-toolbox-muted,var(--insta-toolbox-text))}
    .presence-session .presence-results{list-style:none;display:grid;gap:8px;margin:0;padding:0}
    .presence-session .presence-results li{display:grid;gap:2px;min-width:0;padding-top:8px;border-top:1px solid var(--insta-toolbox-line);overflow-wrap:anywhere}
    .presence-session .presence-results small{color:var(--insta-toolbox-muted,var(--insta-toolbox-text));line-height:1.45}
    .presence-session [hidden]{display:none!important}
    .presence-session :focus-visible{outline:2px solid var(--insta-toolbox-accent,Highlight);outline-offset:2px}
    @container (max-width:280px){.presence-session .presence-options{grid-template-columns:1fr}.presence-session .presence-option:last-child:nth-child(odd){grid-column:auto}}
    @media(max-width:600px){.presence-session .presence-options{grid-template-columns:1fr}.presence-session .presence-option:last-child:nth-child(odd){grid-column:auto}}
    @media(forced-colors:active){.presence-session .presence-option,.presence-session .presence-limit input,.presence-session .presence-status{border:1px solid CanvasText}.presence-session :focus-visible{outline-color:Highlight}}
  `);
  const heading = create('h2', 'Presence');
  heading.id = 'insta-toolbox-presence-title';
  const intro = create('p', 'Choose what Presence may do while this Instagram tab stays open.', 'lead');
  const options = create('div', null, 'presence-options');
  const controls = new Map();
  for (const [key, label] of ACTIONS) {
    const wrapper = create('label', null, 'presence-option');
    const input = create('input');
    input.type = 'checkbox';
    input.setAttribute('data-presence-action', key);
    wrapper.append(input, document.createTextNode(label));
    controls.set(key, input);
    options.append(wrapper);
  }
  const limitLabel = create('label', 'Maximum actions', 'presence-limit');
  const limit = create('input');
  limit.type = 'number';
  limit.min = '1';
  limit.max = '50';
  limit.step = '1';
  limit.inputMode = 'numeric';
  limit.setAttribute('data-presence-limit', '');
  limitLabel.append(limit);
  const actions = create('div', null, 'presence-controls');
  const start = create('button', 'Start Presence', 'button primary big');
  start.type = 'button';
  const pause = create('button', 'Pause', 'button quiet');
  pause.type = 'button';
  const resume = create('button', 'Resume', 'button primary');
  resume.type = 'button';
  const stop = create('button', 'Stop', 'button danger');
  stop.type = 'button';
  actions.append(start, pause, resume, stop);
  const statusBox = create('div', null, 'presence-status');
  const statusTitle = create('strong', 'Ready');
  const statusDetail = create('span', 'No actions run until you review and confirm this session.');
  statusBox.append(statusTitle, statusDetail);
  const results = create('ul', null, 'presence-results');
  results.setAttribute('aria-label', 'Presence results');
  root.append(style, heading, intro, options, limitLabel, statusBox, actions, results);
  container.replaceChildren(root);

  let disposed = false;
  let confirming = false;
  const listeners = [];
  const listen = (node, type, handler) => {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  };

  function readOptions() {
    const maxActions = Number(limit.value);
    if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 50) {
      throw new Error('presence-action-limit-invalid');
    }
    return normalizePresenceSessionOptions({
      actions: Object.fromEntries([...controls].map(([key, input]) => [key, input.checked])),
      maxActions,
    });
  }
  function signature(options) {
    return JSON.stringify({ actions: options.actions, maxActions: options.maxActions });
  }
  function save() {
    const options = readOptions();
    for (const [key, input] of controls) input.checked = options.actions[key];
    limit.value = String(options.maxActions);
    writePreferences(structuredClone(options));
    return options;
  }
  function load() {
    const saved = normalizePresenceSessionOptions(readPreferences() || {
      actions: { viewStories: true, likePosts: true }, maxActions: 10,
    });
    for (const [key, input] of controls) input.checked = saved.actions[key];
    limit.value = String(saved.maxActions);
  }
  function describe(snapshot) {
    const count = Number(snapshot.completed || 0);
    if (snapshot.status === 'idle') return ['Ready', 'No actions run until you review and confirm this session.'];
    if (snapshot.status === 'running') return [snapshot.current?.label || 'Presence is running', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'waiting') return ['Taking a short pause', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'paused') return ['Paused', `${count} verified action${count === 1 ? '' : 's'}. Resume or stop when ready.`];
    if (snapshot.status === 'stopping') return ['Stopping', 'No new action will begin.'];
    if (snapshot.status === 'stopped') return ['Stopped', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'completed') return ['Session complete', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'expired') return ['Session expired', `${count} verified action${count === 1 ? '' : 's'}. Start a new session to continue.`];
    return ['Needs attention', clean(snapshot.reason) || 'Check Instagram before starting again.'];
  }
  function render(snapshot = session.snapshot()) {
    if (disposed) return;
    const [title, detail] = describe(snapshot);
    const active = ['running', 'waiting', 'paused', 'stopping'].includes(snapshot.status);
    intro.hidden = active;
    options.hidden = active;
    limitLabel.hidden = active;
    statusBox.hidden = snapshot.status === 'idle';
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
    start.hidden = snapshot.status !== 'idle' && !['completed', 'stopped', 'expired', 'needs-attention'].includes(snapshot.status);
    start.disabled = confirming || busy();
    pause.hidden = snapshot.canPause !== true;
    pause.disabled = snapshot.canPause !== true;
    resume.hidden = snapshot.canResume !== true;
    resume.disabled = snapshot.canResume !== true;
    stop.hidden = snapshot.canStop !== true;
    stop.disabled = snapshot.canStop !== true;
    const locked = confirming || snapshot.canStop === true || snapshot.canResume === true;
    for (const input of controls.values()) input.disabled = locked;
    limit.disabled = locked;
    results.replaceChildren();
    for (const entry of (snapshot.results || []).slice(0, 12)) {
      const row = create('li');
      row.append(create('strong', clean(entry.label) || PRESENCE_ACTION_LABELS[entry.action] || 'Presence action'));
      row.append(create('small', `${entry.status === 'completed' ? 'Done' : entry.status === 'skipped' ? 'Skipped' : 'Needs attention'}${entry.reason ? ` — ${entry.reason}` : ''}`));
      results.append(row);
    }
  }
  async function begin() {
    if (disposed || confirming || busy()) return false;
    let options;
    try { options = save(); } catch { onStatus('Choose a valid action limit.'); return false; }
    const enabled = ACTIONS.filter(([key]) => options.actions[key]);
    if (!enabled.length) { onStatus('Choose at least one Presence action.'); return false; }
    const account = inspectAccount();
    if (account?.accountVerified !== true || account.usable !== true || !clean(account.accountId)) {
      onStatus('Instagram account could not be verified. Reload Instagram and try again.');
      return false;
    }
    const reviewedSignature = signature(options);
    const expiresAt = now() + 15 * 60_000;
    confirming = true;
    render();
    const confirmation = await confirmAction({
      title: `Start Presence for @${account.accountId}?`,
      message: `Allow up to ${options.maxActions} action${options.maxActions === 1 ? '' : 's'} in this tab.`,
      detail: 'Presence stops on Instagram restrictions, an account change, an uncertain result, or when you press Stop.',
      confirmLabel: 'Start Presence',
      facts: [
        { label: 'Account', value: `@${account.accountId}` },
        { label: 'Actions', value: enabled.map(([, label]) => label).join(', ') },
        { label: 'Maximum', value: String(options.maxActions) },
      ],
      binding: { action: 'presence', accountId: account.accountId, expiresAt,
        maxActions: options.maxActions, options: reviewedSignature },
    });
    confirming = false;
    if (!confirmation) { render(); onStatus('Presence canceled. Nothing was changed.'); return false; }
    const current = inspectAccount();
    const currentOptions = readOptions();
    if (current?.accountVerified !== true || current.usable !== true
      || current.accountId !== account.accountId || signature(currentOptions) !== reviewedSignature
      || confirmation.action !== 'presence' || confirmation.accountId !== account.accountId
      || confirmation.maxActions !== options.maxActions || confirmation.options !== reviewedSignature
      || Number(confirmation.expiresAt) !== expiresAt || expiresAt <= now()) {
      render();
      onStatus('Presence choices or account changed after review. Nothing was changed.');
      return false;
    }
    const review = session.createReview({ accountId: account.accountId, options, expiresAt });
    render(session.snapshot());
    const outcome = await session.start(review);
    render(outcome);
    onStatus(describe(outcome).join('. '));
    return outcome.status === 'completed';
  }

  load();
  listen(start, 'click', () => { void begin(); });
  listen(pause, 'click', () => { if (session.pause()) { render(); onStatus('Presence paused.'); } });
  listen(resume, 'click', () => { if (session.resume()) { render(); onStatus('Presence resumed.'); } });
  listen(stop, 'click', () => { if (session.stop()) { render(); onStatus('Stopping Presence.'); } });
  for (const input of controls.values()) listen(input, 'change', () => { save(); render(); });
  listen(limit, 'change', () => { save(); render(); });
  render();

  return Object.freeze({
    begin,
    render,
    stop: () => session.stop(),
    busy: () => ['running', 'waiting', 'paused', 'stopping'].includes(session.snapshot().status),
    snapshot: () => session.snapshot(),
    dispose() {
      if (disposed) return;
      session.stop();
      disposed = true;
      listeners.splice(0).forEach((remove) => remove());
      root.remove();
    },
  });
}
