import { PRESENCE_ACTION_LABELS, normalizePresenceSessionOptions } from './presence-session.js';
import { createPresenceActivityLog } from './presence-activity-log.js';

const ACTIONS = Object.freeze([
  ['viewStories', 'View stories'],
  ['reactStories', 'React to stories'],
  ['likePosts', 'Like posts'],
  ['followPeople', 'Follow people'],
  ['acceptRequests', 'Accept incoming requests'],
]);

const clean = (value) => String(value ?? '').trim();

export function mountPresenceSessionPanel({
  container,
  session,
  inspectAccount,
  confirmAction,
  readPreferences = () => null,
  writePreferences = () => {},
  readLog = () => null,
  writeLog = () => {},
  busy = () => false,
  onStatus = () => {},
  document = globalThis.document,
  window = globalThis.window,
  now = Date.now,
} = {}) {
  if (!container || !document?.createElement || typeof session?.createReview !== 'function'
    || typeof session?.start !== 'function' || typeof session?.snapshot !== 'function'
    || typeof inspectAccount !== 'function' || typeof confirmAction !== 'function'
    || typeof readPreferences !== 'function' || typeof writePreferences !== 'function'
    || typeof readLog !== 'function' || typeof writeLog !== 'function'
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
    .presence-session .presence-run-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .presence-session .presence-limit{max-width:none}
    .presence-session .presence-limit input,.presence-session .presence-limit select{box-sizing:border-box;width:100%;min-height:44px;font:inherit;color:inherit;background:var(--insta-toolbox-bg-sunken);border:1px solid var(--insta-toolbox-line);border-radius:8px;padding:8px 34px 8px 10px}
    .presence-session .presence-live-options{display:grid;grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:12px;border:1px solid var(--insta-toolbox-line);border-radius:10px;background:var(--insta-toolbox-bg-sunken)}
    .presence-session .presence-controls{display:flex;flex-wrap:wrap;gap:8px}
    .presence-session .presence-controls .button{flex:1 1 132px;white-space:normal}
    .presence-session .presence-status{display:grid;gap:5px;padding:12px;border-left:3px solid var(--insta-toolbox-accent);background:var(--insta-toolbox-bg-sunken);border-radius:0 8px 8px 0}
    .presence-session .presence-status strong,.presence-session .presence-status span{overflow-wrap:anywhere}
    .presence-session .presence-status span{font-size:12px;line-height:1.5;color:var(--insta-toolbox-muted,var(--insta-toolbox-text))}
    .presence-session .presence-results{list-style:none;display:grid;gap:8px;margin:0;padding:0}
    .presence-session .presence-results li{display:grid;gap:2px;min-width:0;padding-top:8px;border-top:1px solid var(--insta-toolbox-line);overflow-wrap:anywhere}
    .presence-session .presence-results small{color:var(--insta-toolbox-muted,var(--insta-toolbox-text));line-height:1.45}
    .presence-session .presence-log{border-top:1px solid var(--insta-toolbox-line);padding-top:4px}
    .presence-session .presence-log>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:700;-webkit-text-fill-color:currentColor}
    .presence-session .presence-log-body{display:grid;gap:12px;padding-top:8px}
    .presence-session .presence-log-empty{font-size:12px;color:var(--insta-toolbox-muted,var(--insta-toolbox-text))}
    .presence-session [hidden]{display:none!important}
    .presence-session :focus-visible{outline:2px solid var(--insta-toolbox-accent,Highlight);outline-offset:2px}
    @container (max-width:340px){.presence-session .presence-options,.presence-session .presence-run-grid,.presence-session .presence-live-options{grid-template-columns:1fr}.presence-session .presence-option:last-child:nth-child(odd){grid-column:auto}}
    @media(max-width:600px){.presence-session .presence-options,.presence-session .presence-run-grid,.presence-session .presence-live-options{grid-template-columns:1fr}.presence-session .presence-option:last-child:nth-child(odd){grid-column:auto}}
    @media(forced-colors:active){.presence-session .presence-option,.presence-session .presence-limit input,.presence-session .presence-limit select,.presence-session .presence-status{border:1px solid CanvasText}.presence-session .presence-log>summary{color:LinkText;-webkit-text-fill-color:LinkText}.presence-session :focus-visible{outline-color:Highlight}}
  `);
  const heading = create('h2', 'Presence');
  heading.id = 'insta-toolbox-presence-title';
  const intro = create('p', 'Choose what Presence can do.', 'lead');
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
  const runGrid = create('div', null, 'presence-run-grid');
  const modeLabel = create('label', 'Run style', 'presence-limit');
  const mode = create('select');
  mode.setAttribute('data-presence-mode', '');
  const sessionOption = create('option', 'One session');
  sessionOption.value = 'session';
  const liveOption = create('option', 'Live like me');
  liveOption.value = 'live';
  mode.append(sessionOption, liveOption);
  modeLabel.append(mode);
  const limitLabel = create('label', 'Actions this session', 'presence-limit');
  const limit = create('input');
  limit.type = 'number';
  limit.min = '1';
  limit.max = '50';
  limit.step = '1';
  limit.inputMode = 'numeric';
  limit.setAttribute('data-presence-limit', '');
  limitLabel.append(limit);
  const liveOptions = create('div', null, 'presence-live-options');
  const durationLabel = create('label', 'Keep running', 'presence-limit');
  const duration = create('select');
  for (const [value, label] of [[60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [720, '12 hours']]) {
    const option = create('option', label); option.value = String(value); duration.append(option);
  }
  durationLabel.append(duration);
  const breaksLabel = create('label', null, 'presence-option');
  const breaks = create('input');
  breaks.type = 'checkbox';
  breaks.setAttribute('data-presence-breaks', '');
  breaksLabel.append(breaks, document.createTextNode('Take scheduled breaks'));
  const burstLabel = create('label', 'Pause after', 'presence-limit');
  const burst = create('select');
  for (const value of [3, 5, 8, 10]) {
    const option = create('option', `${value} actions`); option.value = String(value); burst.append(option);
  }
  burstLabel.append(burst);
  const quietLabel = create('label', 'Rest for', 'presence-limit');
  const quiet = create('select');
  for (const value of [5, 10, 20, 30, 60]) {
    const option = create('option', `${value} minutes`); option.value = String(value); quiet.append(option);
  }
  quietLabel.append(quiet);
  liveOptions.append(durationLabel, breaksLabel, burstLabel, quietLabel);
  runGrid.append(modeLabel, limitLabel, liveOptions);
  const actions = create('div', null, 'presence-controls');
  const start = create('button', 'Start', 'button primary big');
  start.type = 'button';
  start.setAttribute('data-presence-start', '');
  const pause = create('button', 'Pause', 'button quiet');
  pause.type = 'button';
  const resume = create('button', 'Resume', 'button primary');
  resume.type = 'button';
  const stop = create('button', 'Stop', 'button danger');
  stop.type = 'button';
  stop.setAttribute('data-presence-stop', '');
  actions.append(start, pause, resume, stop);
  const statusBox = create('div', null, 'presence-status');
  const statusTitle = create('strong', 'Ready');
  const statusDetail = create('span', 'Nothing happens until you confirm.');
  statusBox.append(statusTitle, statusDetail);
  const results = create('ul', null, 'presence-results');
  results.setAttribute('aria-label', 'Presence results');
  const logDetails = create('details', null, 'presence-log');
  const logSummary = create('summary', 'Activity log');
  const logBody = create('div', null, 'presence-log-body');
  const logEmpty = create('p', 'No Presence activity yet.', 'presence-log-empty');
  const logRecent = create('ul', null, 'presence-results');
  logRecent.setAttribute('aria-label', 'Recent Presence activity');
  const logControls = create('div', null, 'presence-controls');
  const openLog = create('button', 'Open log window', 'button quiet'); openLog.type = 'button';
  const exportLog = create('button', 'Download log', 'button quiet'); exportLog.type = 'button';
  const clearLog = create('button', 'Clear log', 'button quiet'); clearLog.type = 'button';
  logControls.append(openLog, exportLog, clearLog);
  logBody.append(logEmpty, logRecent, logControls);
  logDetails.append(logSummary, logBody);
  root.append(style, heading, intro, options, runGrid, statusBox, actions, results, logDetails);
  container.replaceChildren(root);

  let disposed = false;
  let confirming = false;
  let logWindow = null;
  const loggedEvents = new Set();
  const listeners = [];
  const activityLog = createPresenceActivityLog({
    read: readLog,
    write: writeLog,
    onWriteError: () => onStatus('Presence activity could not be saved. Existing history is unchanged.'),
    now,
  });
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
      mode: mode.value,
      maxActions: mode.value === 'live' ? null : maxActions,
      liveDurationMinutes: Number(duration.value),
      scheduledBreaks: breaks.checked,
      liveBurstActions: Number(burst.value),
      quietMinutes: Number(quiet.value),
    });
  }
  function signature(options) {
    return JSON.stringify(options);
  }
  function save() {
    const options = readOptions();
    for (const [key, input] of controls) input.checked = options.actions[key];
    mode.value = options.mode;
    if (options.mode === 'session') limit.value = String(options.maxActions);
    duration.value = String(options.liveDurationMinutes);
    breaks.checked = options.scheduledBreaks;
    burst.value = String(options.liveBurstActions);
    quiet.value = String(options.quietMinutes);
    writePreferences({ ...structuredClone(options), sessionActions: Number(limit.value) });
    return options;
  }
  function load() {
    const source = readPreferences() || {
      actions: { viewStories: true, likePosts: true }, maxActions: 10,
    };
    const saved = normalizePresenceSessionOptions(source);
    for (const [key, input] of controls) input.checked = saved.actions[key];
    mode.value = saved.mode;
    const sessionActions = Number(source.sessionActions ?? (saved.mode === 'session' ? saved.maxActions : 10));
    limit.value = String(Number.isInteger(sessionActions) && sessionActions >= 1 && sessionActions <= 50
      ? sessionActions : 10);
    duration.value = String(saved.liveDurationMinutes);
    breaks.checked = saved.scheduledBreaks;
    burst.value = String(saved.liveBurstActions);
    quiet.value = String(saved.quietMinutes);
  }
  function describe(snapshot) {
    const count = Number(snapshot.completed || 0);
    if (snapshot.status === 'idle') return ['Ready', 'Nothing happens until you confirm.'];
    if (snapshot.status === 'running') return [snapshot.current?.label || 'Presence is running', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'searching') return ['Looking for something to do', `${count} verified action${count === 1 ? '' : 's'}. Presence is checking the loaded Instagram tab now.`];
    if (snapshot.status === 'waiting') return ['Presence is running', `${count} verified action${count === 1 ? '' : 's'}. Next action coming up.`];
    if (snapshot.status === 'quiet') return ['Scheduled break', `${count} verified action${count === 1 ? '' : 's'}. Presence will continue in this loaded tab.`];
    if (snapshot.status === 'paused') return ['Paused', `${count} verified action${count === 1 ? '' : 's'}. Resume or stop when ready.`];
    if (snapshot.status === 'stopping') return ['Stopping', 'No new action will begin.'];
    if (snapshot.status === 'stopped') return ['Stopped', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'completed') return ['Presence finished', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'expired') return ['Time limit reached', `${count} verified action${count === 1 ? '' : 's'}. Start again to continue.`];
    return ['Needs attention', clean(snapshot.reason) || 'Check Instagram before starting again.'];
  }
  function render(snapshot = session.snapshot()) {
    if (disposed) return;
    logResultEntries(snapshot);
    const [title, detail] = describe(snapshot);
    const active = ['running', 'searching', 'waiting', 'quiet', 'paused', 'stopping'].includes(snapshot.status);
    intro.hidden = active;
    options.hidden = active;
    runGrid.hidden = active;
    limitLabel.hidden = mode.value === 'live';
    liveOptions.hidden = mode.value !== 'live';
    burstLabel.hidden = !breaks.checked;
    quietLabel.hidden = !breaks.checked;
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
    mode.disabled = locked;
    duration.disabled = locked;
    breaks.disabled = locked;
    burst.disabled = locked;
    quiet.disabled = locked;
    results.replaceChildren();
    for (const entry of (snapshot.results || []).slice(0, 12)) {
      const row = create('li');
      row.append(create('strong', clean(entry.label) || PRESENCE_ACTION_LABELS[entry.action] || 'Presence action'));
      row.append(create('small', `${entry.status === 'completed' ? 'Done' : entry.status === 'skipped' ? 'Skipped' : 'Needs attention'}${entry.reason ? ` — ${entry.reason}` : ''}`));
      results.append(row);
    }
  }
  function formatEntry(entry) {
    const time = new Date(entry.at).toLocaleString();
    const label = entry.target || PRESENCE_ACTION_LABELS[entry.action] || 'Presence';
    return { label, detail: `${time} · ${entry.outcome}${entry.detail ? ` · ${entry.detail}` : ''}` };
  }
  function renderLog(record = activityLog.snapshot()) {
    if (disposed) return;
    logRecent.replaceChildren();
    logEmpty.hidden = record.entries.length > 0;
    for (const entry of record.entries.slice(0, 5)) {
      const row = create('li');
      const formatted = formatEntry(entry);
      row.append(create('strong', formatted.label), create('small', formatted.detail));
      logRecent.append(row);
    }
    clearLog.disabled = record.entries.length === 0;
    exportLog.disabled = record.entries.length === 0;
    renderLogWindow(record);
  }
  function downloadRecord(record = activityLog.exportRecord(), targetWindow = window) {
    const blob = new targetWindow.Blob([`${JSON.stringify(record, null, 2)}\n`], { type: 'application/json' });
    const href = targetWindow.URL.createObjectURL(blob);
    const link = targetWindow.document.createElement('a');
    link.href = href;
    link.download = `insta-toolbox-presence-log-${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    targetWindow.setTimeout(() => targetWindow.URL.revokeObjectURL(href), 0);
  }
  function renderLogWindow(record = activityLog.snapshot()) {
    if (!logWindow || logWindow.closed) return;
    const target = logWindow.document;
    const styleNode = target.createElement('style');
    styleNode.textContent = 'html{color-scheme:light dark}body{margin:0;padding:24px;background:#101114;color:#f4f1e8;font:15px/1.5 system-ui,sans-serif}main{max-width:760px;margin:auto}h1{font-size:22px;margin:0 0 4px}p{color:#b8b8bd;margin:0 0 20px}ol{list-style:none;margin:0;padding:0;border-top:1px solid #34363d}li{padding:12px 0;border-bottom:1px solid #34363d}strong,small{display:block;overflow-wrap:anywhere}small{color:#b8b8bd;margin-top:2px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px}button{min-height:44px;padding:8px 14px;border:1px solid #545760;border-radius:8px;background:#202228;color:inherit;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #d94d7c;outline-offset:2px}@media(forced-colors:active){button{border-color:CanvasText}}';
    const main = target.createElement('main');
    const title = target.createElement('h1'); title.textContent = 'Presence activity';
    const note = target.createElement('p'); note.textContent = 'Stored only in this browser.';
    const buttons = target.createElement('div'); buttons.className = 'actions';
    const download = target.createElement('button'); download.type = 'button'; download.textContent = 'Download log';
    download.disabled = record.entries.length === 0;
    download.addEventListener('click', () => downloadRecord(activityLog.exportRecord(), logWindow));
    const clear = target.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear log';
    clear.disabled = record.entries.length === 0;
    clear.addEventListener('click', () => { if (logWindow.confirm('Clear the local Presence activity log?')) activityLog.clear(); });
    buttons.append(download, clear);
    const list = target.createElement('ol');
    for (const entry of record.entries) {
      const row = target.createElement('li');
      const formatted = formatEntry(entry);
      const strong = target.createElement('strong'); strong.textContent = formatted.label;
      const small = target.createElement('small'); small.textContent = formatted.detail;
      row.append(strong, small); list.append(row);
    }
    if (!record.entries.length) {
      const empty = target.createElement('p'); empty.textContent = 'No Presence activity yet.'; list.append(empty);
    }
    main.append(title, note, buttons, list);
    target.head.replaceChildren(styleNode);
    target.title = 'Insta Toolbox · Presence activity';
    target.body.replaceChildren(main);
  }
  function appendLog(value) {
    try { activityLog.append(value); } catch { onStatus('Presence ran, but its activity log could not be updated.'); }
  }
  function logResultEntries(snapshot) {
    for (const entry of [...(snapshot.results || [])].reverse()) {
      if (!entry.eventId || loggedEvents.has(entry.eventId)) continue;
      appendLog({ eventId: entry.eventId, at: entry.at, kind: 'action', action: entry.action,
        target: entry.label, outcome: entry.status, detail: entry.reason });
      loggedEvents.add(entry.eventId);
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
    const expiresAt = now() + (options.mode === 'live'
      ? options.liveDurationMinutes * 60_000 : 15 * 60_000);
    confirming = true;
    render();
    const confirmation = await confirmAction({
      title: `Start Presence for @${account.accountId}?`,
      message: options.mode === 'live'
        ? `Run Presence for up to ${options.liveDurationMinutes / 60} hour${options.liveDurationMinutes === 60 ? '' : 's'} in this loaded tab.`
        : `Allow up to ${options.maxActions} action${options.maxActions === 1 ? '' : 's'} in this tab.`,
      detail: 'Presence stops on Instagram restrictions, an account change, an uncertain result, or when you press Stop.',
      confirmLabel: 'Start Presence',
      facts: [
        { label: 'Account', value: `@${account.accountId}` },
        { label: 'Actions', value: enabled.map(([, label]) => label).join(', ') },
        { label: 'Run style', value: options.mode === 'live' ? 'Live like me' : 'One session' },
        ...(options.mode === 'session' ? [{ label: 'Maximum', value: String(options.maxActions) }] : []),
        ...(options.mode === 'live' ? [
          { label: 'Rhythm', value: options.scheduledBreaks
            ? `${options.liveBurstActions} actions, then ${options.quietMinutes} minutes quiet`
            : 'Continuous, with normal spacing between actions' },
        ] : []),
      ],
      binding: { action: 'presence', accountId: account.accountId, expiresAt,
        maxActions: options.maxActions, options: reviewedSignature },
    });
    confirming = false;
    if (!confirmation) { render(); onStatus('Presence canceled. Nothing changed.'); return false; }
    const current = inspectAccount();
    const currentOptions = readOptions();
    if (current?.accountVerified !== true || current.usable !== true
      || current.accountId !== account.accountId || signature(currentOptions) !== reviewedSignature
      || confirmation.action !== 'presence' || confirmation.accountId !== account.accountId
      || confirmation.maxActions !== options.maxActions || confirmation.options !== reviewedSignature
      || Number(confirmation.expiresAt) !== expiresAt || expiresAt <= now()) {
      render();
      onStatus('The account or Presence choices changed. Start again.');
      return false;
    }
    const review = session.createReview({ accountId: account.accountId, options, expiresAt });
    appendLog({ eventId: `${review.reviewedDigest}:started`, at: now(), kind: 'session',
      outcome: 'started', detail: options.mode === 'live' ? 'Live like me started' : 'Presence started' });
    render(session.snapshot());
    let outcome;
    try {
      outcome = await session.start(review);
    } catch (error) {
      render(session.snapshot());
      onStatus(error?.message === 'presence-account-busy'
        ? 'Another Presence or Ghost run is already active.'
        : 'Presence could not start safely in this browser.');
      appendLog({ eventId: `${review.reviewedDigest}:start-failed`, at: now(), kind: 'session',
        outcome: 'needs-attention', detail: clean(error?.message) || 'Presence could not start' });
      return false;
    }
    logResultEntries(outcome);
    appendLog({ eventId: `${review.reviewedDigest}:${outcome.status}`, at: now(), kind: 'session',
      outcome: ['completed', 'stopped', 'expired', 'needs-attention'].includes(outcome.status)
        ? outcome.status : 'needs-attention', detail: describe(outcome)[0] });
    render(outcome);
    onStatus(describe(outcome).join('. '));
    return outcome.status === 'completed';
  }

  load();
  const unsubscribeLog = activityLog.subscribe(renderLog);
  listen(start, 'click', () => { void begin(); });
  listen(pause, 'click', () => { if (session.pause()) { const state = session.snapshot(); appendLog({ eventId: `${state.runId}:paused:${now()}`, at: now(), kind: 'session', outcome: 'paused', detail: 'Paused' }); render(); onStatus('Presence paused.'); } });
  listen(resume, 'click', () => { if (session.resume()) { const state = session.snapshot(); appendLog({ eventId: `${state.runId}:resumed:${now()}`, at: now(), kind: 'session', outcome: 'resumed', detail: 'Resumed' }); render(); onStatus('Presence resumed.'); } });
  listen(stop, 'click', () => { if (session.stop()) { const state = session.snapshot(); appendLog({ eventId: `${state.runId}:stopped:${now()}`, at: now(), kind: 'session', outcome: 'stopped', detail: 'Stop requested' }); render(); onStatus('Stopping Presence.'); } });
  for (const input of controls.values()) listen(input, 'change', () => { save(); render(); });
  listen(limit, 'change', () => { save(); render(); });
  for (const input of [mode, duration, breaks, burst, quiet]) listen(input, 'change', () => { save(); render(); });
  listen(openLog, 'click', () => {
    logWindow = window?.open?.('', 'insta-toolbox-presence-log', 'popup=yes,width=620,height=760,resizable=yes,scrollbars=yes') || null;
    if (!logWindow) { onStatus('Allow pop-ups to open the Presence log window.'); return; }
    logWindow.addEventListener?.('load', () => renderLogWindow(), { once: true });
    renderLogWindow();
    window.setTimeout?.(() => renderLogWindow(), 0);
  });
  listen(exportLog, 'click', () => downloadRecord());
  listen(clearLog, 'click', () => {
    if (window?.confirm?.('Clear the local Presence activity log?')) activityLog.clear();
  });
  render();

  return Object.freeze({
    begin,
    render,
    stop: () => session.stop(),
    busy: () => ['running', 'searching', 'waiting', 'quiet', 'paused', 'stopping']
      .includes(session.snapshot().status),
    snapshot: () => session.snapshot(),
    dispose() {
      if (disposed) return;
      session.stop();
      disposed = true;
      unsubscribeLog();
      listeners.splice(0).forEach((remove) => remove());
      root.remove();
    },
  });
}
