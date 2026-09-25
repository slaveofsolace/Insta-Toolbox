import { createUserscriptInboxDiscovery } from './inbox-userscript-discovery.js';
import { inboxReviewKey } from './inbox-coordinator.js';
import { createSingleTabInboxController, createSingleTabInboxReview } from './inbox-single-tab.js';
import { createUserscriptGhostBridge, userscriptGhostReviewKey } from './inbox-userscript-workers.js';

export function mountUserscriptInboxPanel({
  container, document = globalThis.document, window = globalThis.window,
  viewer = globalThis.InstaToolboxInstagramViewer,
  runner = globalThis.InstaToolboxDmThreadUnsender,
  confirmAction, cancelConfirmation = () => {}, save, load = async () => null,
  workerTransport = null,
  defaultWorkerCount = 2,
  openWorkersInBackground = true,
  discoveryTiming = {},
  messageOptions = () => ({ scope: 'all', limit: null }),
  busy = () => false, onStatus = () => {},
}) {
  if (!container || typeof confirmAction !== 'function' || typeof save !== 'function') throw new Error('inbox-panel-unavailable');
  const documentId = crypto.randomUUID();
  const selected = new Set();
  const rows = new Map();
  let inventory = null, controller = null, active = false, checkpoint = null, operationEpoch = 0;
  let loading = true, loadFailed = false, needsReconciliation = false, unsubscribe = null;
  const create = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const controls = create('div', null, 'toolbar');
  const startGhost = create('button', 'Start Ghost Mode', 'button danger big');
  startGhost.type = 'button';
  startGhost.setAttribute('data-ghost-start', '');
  const find = create('button', 'Find conversations', 'button quiet');
  find.type = 'button';
  const section = create('select');
  section.setAttribute('aria-label', 'Inbox section');
  for (const [value, label] of [['all', 'All available'], ['primary', 'Primary'], ['general', 'General'], ['requests', 'Requests']]) {
    const option = create('option', label); option.value = value; section.append(option);
  }
  const acknowledgment = create('label', null, 'inbox-choice');
  const acknowledged = create('input'); acknowledged.type = 'checkbox';
  acknowledgment.append(acknowledged, document.createTextNode(' Opening conversations may mark them read.'));
  const note = create('p', 'Find your conversations, then unsend your messages after one confirmation. Opening chats may mark them read.', 'lead');
  const advanced = create('details', null, 'settings-inline');
  advanced.append(create('summary', 'Choose conversations and tabs'));
  const workersLabel = create('label', 'Worker tabs', 'field');
  const workers = create('select');
  workers.setAttribute('aria-label', 'Managed worker tabs');
  for (let value = 1; value <= 5; value += 1) {
    const option = create('option', `${value}`); option.value = String(value); workers.append(option);
  }
  workers.value = String(Number.isInteger(Number(defaultWorkerCount))
    && Number(defaultWorkerCount) >= 1 && Number(defaultWorkerCount) <= 5
    ? Number(defaultWorkerCount) : 2);
  workersLabel.append(workers);
  const workerModeLabel = create('label', 'Open worker tabs', 'field');
  const workerMode = create('select');
  workerMode.setAttribute('aria-label', 'Worker tab opening');
  const backgroundOption = create('option', 'In the background'); backgroundOption.value = 'background';
  const foregroundOption = create('option', 'In front'); foregroundOption.value = 'foreground';
  workerMode.append(backgroundOption, foregroundOption);
  workerMode.value = openWorkersInBackground === false ? 'foreground' : 'background';
  workerModeLabel.append(workerMode);
  const workerNote = create('p', workerTransport
    ? 'Worker tabs prepare conversations together. Removals run one conversation at a time.'
    : 'Multiple worker tabs are unavailable in this userscript manager.', 'lead');
  workers.disabled = !workerTransport; workerMode.disabled = !workerTransport;
  const inbox = create('a', 'Open inbox', 'button quiet');
  inbox.href = 'https://www.instagram.com/direct/inbox/';
  const inventoryStatus = create('p', '', 'lead');
  const filterLabel = create('label', 'Find a person or chat', 'field');
  const filter = create('input'); filter.type = 'search'; filter.maxLength = 160;
  filter.placeholder = 'Name or @username'; filter.setAttribute('aria-label', 'Filter conversations');
  filterLabel.append(filter);
  const filterStatus = create('p', '', 'lead');
  const list = create('div', null, 'inbox-selection');
  list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Conversations to clean up');
  const selectAll = create('button', 'Select all found', 'button quiet'); selectAll.type = 'button';
  const review = create('button', 'Review conversations', 'button danger'); review.type = 'button'; review.disabled = true;
  const pause = create('button', 'Pause', 'button quiet'); pause.type = 'button'; pause.hidden = true;
  const resume = create('button', 'Review remaining', 'button quiet'); resume.type = 'button'; resume.hidden = true;
  const skip = create('button', 'Skip conversation', 'button quiet'); skip.type = 'button'; skip.hidden = true;
  const stop = create('button', 'Stop all', 'button danger'); stop.type = 'button'; stop.hidden = true;
  const results = create('ul', null, 'list list--compact');
  const recovery = create('label', null, 'inbox-choice');
  const reconciled = create('input'); reconciled.type = 'checkbox';
  recovery.append(reconciled, document.createTextNode(' I checked the interrupted conversation before starting again.'));
  recovery.hidden = true;
  const storageNote = create('p', '', 'lead');
  const supportNote = create('p', '', 'lead');
  if (!window.navigator?.locks?.request) supportNote.textContent = 'Inbox cleanup is unavailable: this browser does not provide exclusive tab locks.';
  supportNote.hidden = !supportNote.textContent;
  controls.append(find, inbox);
  const actions = create('div', null, 'toolbar'); actions.append(selectAll, review, resume, pause, skip, stop);
  advanced.append(section, acknowledgment, controls, filterLabel, filterStatus,
    list, workersLabel, workerModeLabel, workerNote);
  container.append(startGhost, note, inventoryStatus, advanced, supportNote, recovery, actions, storageNote, results);

  function context() {
    const value = viewer.inspect({ document, location: window.location });
    return { ...value, accountId: value.accountKey, accountLabel: value.accountId, documentId,
      usable: value.accountVerified === true && !value.restriction
        && (value.usable === true || /^\/direct\/inbox\/?$/.test(window.location.pathname)),
      challenge: Boolean(value.restriction), rateLimited: false, actionBlocked: false, sessionExpired: false };
  }
  const ghostBridge = workerTransport ? createUserscriptGhostBridge({
    storage: workerTransport.storage,
    locks: window.navigator?.locks,
    openTab: workerTransport.openTab,
    runner,
    inspectContext: context,
    location: window.location,
  }) : null;
  const workerStartup = ghostBridge?.attachWorker().catch((error) => {
    announce(friendlyReason(error?.message || 'worker-start-failed'));
    return null;
  });
  function announce(text) { onStatus(text); }
  function remainingThreads() {
    if (!checkpoint || !['paused', 'stopped'].includes(checkpoint.status)) return [];
    let account;
    try { account = context(); } catch { return []; }
    if (!account.accountVerified || account.accountId !== checkpoint.review?.accountId) return [];
    const found = new Set(inventory?.conversations.map(thread => thread.threadId) || []);
    const remaining = checkpoint.tasks.filter(task => ['pending', 'partial'].includes(task.status)).map(task => task.threadId);
    return remaining.length && remaining.every(id => found.has(id)) ? remaining : [];
  }
  function updateControls() {
    inventoryStatus.hidden = !inventoryStatus.textContent;
    list.hidden = !rows.size;
    filterLabel.hidden = !rows.size; filter.disabled = active;
    const query = filter.value.trim().toLowerCase();
    let shown = 0, hiddenSelected = 0;
    for (const [id, row] of rows) {
      const matches = !query || (query.startsWith('@')
        ? Boolean(row.username) && row.username.includes(query.slice(1))
        : row.title.toLowerCase().includes(query) || Boolean(row.username?.includes(query)));
      row.label.hidden = !matches;
      if (matches) shown += 1; else if (selected.has(id)) hiddenSelected += 1;
    }
    filterStatus.textContent = query
      ? `${shown} shown${hiddenSelected ? ` · ${hiddenSelected} selected outside this filter` : ''}${query.startsWith('@') ? '. Only verified profile links match @usernames.' : ''}` : '';
    filterStatus.hidden = !filterStatus.textContent;
    results.hidden = !checkpoint?.tasks?.length;
    storageNote.hidden = !storageNote.textContent;
    find.disabled = active || loading || loadFailed;
    startGhost.hidden = active;
    startGhost.disabled = loading || loadFailed || !window.navigator?.locks?.request
      || (needsReconciliation && !reconciled.checked);
    section.disabled = active; acknowledged.disabled = active;
    workers.disabled = active || !workerTransport; workerMode.disabled = active || !workerTransport;
    selectAll.hidden = !inventory?.conversations.length; selectAll.disabled = active || !shown;
    selectAll.textContent = query ? 'Select visible matches' : 'Select all found';
    review.hidden = !inventory?.conversations.length;
    review.disabled = active || loading || loadFailed || !selected.size || !window.navigator?.locks?.request
      || (needsReconciliation && !reconciled.checked);
    review.textContent = `Review ${selected.size} conversation${selected.size === 1 ? '' : 's'}`;
    const remaining = remainingThreads();
    resume.hidden = Boolean(ghostBridge) || active || !remaining.length;
    resume.disabled = loading || loadFailed || !window.navigator?.locks?.request
      || (needsReconciliation && !reconciled.checked);
    resume.textContent = `Review ${remaining.length} remaining to resume`;
    const multiTab = controller?.kind === 'multi-tab';
    stop.hidden = !active;
    pause.hidden = !active || !controller || multiTab;
    skip.hidden = !active || !controller || multiTab;
    for (const row of rows.values()) row.input.disabled = active;
  }
  function showInventory(value) {
    inventory = value.inventory;
    const threads = inventory?.conversations || [];
    let labels;
    try { labels = new Map((threads.length ? discovery.reviewLabels() : []).map(label => [label.threadId, label])); }
    catch { inventory = null; selected.clear(); rows.clear(); list.replaceChildren(); updateControls(); return; }
    for (const thread of threads) {
      const display = labels.get(thread.threadId);
      const existing = rows.get(thread.threadId);
      if (existing) {
        existing.title = display?.title || `Conversation ${existing.index}`;
        existing.username = display?.username || null;
        existing.name.textContent = existing.title;
        existing.identity.textContent = `${existing.username ? `@${existing.username} · ` : ''}Thread ${thread.threadId}`;
        continue;
      }
      const label = create('label', null, 'inbox-choice');
      const input = create('input'); input.type = 'checkbox';
      const index = rows.size + 1;
      const title = display?.title || `Conversation ${index}`, username = display?.username || null;
      const name = create('span', title);
      const identity = create('small', `${username ? `@${username} · ` : ''}Thread ${thread.threadId}`);
      const text = create('span'); text.append(name, identity); label.append(input, text);
      input.addEventListener('change', () => {
        if (input.checked) selected.add(thread.threadId); else selected.delete(thread.threadId);
        updateControls();
      });
      rows.set(thread.threadId, { label, input, name, identity, index, title, username }); list.append(label);
    }
    if (!inventory) { selected.clear(); rows.clear(); list.replaceChildren(); }
    const finding = value.status === 'discovering';
    inventoryStatus.textContent = finding ? `Found ${threads.length} conversations…`
      : `${threads.length} conversations found.${inventory?.complete ? '' : ' This may not include your whole inbox.'}`;
    if (value.reason) inventoryStatus.textContent += ` ${friendlyReason(value.reason)}`;
    updateControls();
  }
  const discovery = createUserscriptInboxDiscovery({ document, window, viewer, onProgress: showInventory,
    routeTimeoutMs: discoveryTiming.routeTimeoutMs ?? 8_000, settleMs: discoveryTiming.settleMs ?? 400 });
  function friendlyReason(reason) {
    const labels = {
      'inbox-route-required': 'Open your inbox first.',
      'inbox-viewer-unverified': 'Your signed-in account could not be verified.',
      'section-control-unavailable': 'This inbox section could not be identified.',
      'inbox-account-changed': 'The signed-in account changed. Find conversations again.',
      'account-activity-busy': 'Another cleanup is already running.',
      'account-pacing': 'Waiting before the next removal.',
      'ghost-job-active': 'Another Ghost mode job is already running.',
      'ghost-coordinator-lost': 'The Ghost mode manager closed. No new removal will begin.',
      'worker-lost': 'A worker tab stopped responding. Review the conversation before continuing.',
      'tab-open-failed': 'A worker tab could not be opened. Check the userscript pop-up permission.',
      'removal-not-proven': 'Instagram did not confirm the last removal. Review the conversation before continuing.',
      'approval-expired': 'This cleanup approval expired. Review the conversations again.',
      cancelled: 'Stopped.', 'end-unverified': '', 'repeated-window-unverified': '',
    };
    return labels[reason] ?? String(reason || '').replaceAll('-', ' ');
  }
  function renderCheckpoint(value) {
    checkpoint = structuredClone(value);
    results.hidden = !value.tasks?.length;
    results.replaceChildren(...(value.tasks || []).map(task => {
      const count = Number(task.messageRemovals) || 0;
      return create('li', `Thread ${task.threadId}: ${count} unsent · ${task.status}${task.reason ? ` — ${friendlyReason(task.reason)}` : ''}`);
    }));
  }
  async function persist(value) {
    renderCheckpoint(value);
    try { await save(value); storageNote.textContent = ''; storageNote.hidden = true; }
    catch (error) {
      loadFailed = true;
      storageNote.textContent = 'Progress could not be saved. Cleanup stopped; the counts below include verified removals.';
      storageNote.hidden = false;
      throw error;
    }
  }
  reconciled.addEventListener('change', updateControls);
  filter.addEventListener('input', updateControls);
  async function loadCheckpoint() {
    const value = await load();
    if (!value) {
      checkpoint = null; results.replaceChildren(); needsReconciliation = false;
      recovery.hidden = true; reconciled.checked = false; storageNote.textContent = '';
      return;
    }
    if (value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 1000
      || value.tasks.some(task => !/^[A-Za-z0-9_-]{1,128}$/.test(task.threadId)
        || !Number.isSafeInteger(task.messageRemovals) || task.messageRemovals < 0)) throw new Error('inbox-checkpoint-invalid');
    renderCheckpoint(value);
    needsReconciliation = Boolean(value.pendingMutation || value.pendingMutations?.length
      || !['completed', 'stopped', 'paused'].includes(value.status)
      || value.tasks.some(task => ['running', 'uncertain'].includes(task.status)));
    recovery.hidden = !needsReconciliation;
    storageNote.textContent = needsReconciliation
      ? 'Previous cleanup was interrupted. Check its last conversation; nothing resumes automatically.'
      : 'Previous cleanup. Find conversations to start a new review.';
  }
  const ready = Promise.resolve().then(loadCheckpoint).catch(() => {
    loadFailed = true;
    storageNote.textContent = 'Saved cleanup progress could not be read. Reload before starting another cleanup.';
  }).finally(() => { loading = false; updateControls(); });
  async function findConversations({ all = false } = {}) {
    if (active || loading || loadFailed || busy()) return;
    if (!all && !acknowledged.checked) { announce('Confirm that opening conversations may mark them read.'); acknowledged.focus(); return; }
    const epoch = ++operationEpoch;
    active = true; inventory = null; selected.clear(); rows.clear(); filter.value = ''; list.replaceChildren(); unsubscribe?.(); controller = null; updateControls();
    let found = null;
    try {
      await loadCheckpoint();
      if (epoch !== operationEpoch) return;
      const sections = all || section.value === 'all' ? null : [section.value];
      found = await discovery.discover({ navigationAcknowledged: true, sections });
    }
    catch (error) { announce(friendlyReason(error.message)); }
    finally { active = false; updateControls(); }
    if (epoch !== operationEpoch || found?.status !== 'ready') return null;
    return found;
  }
  find.addEventListener('click', () => findConversations());
  startGhost.addEventListener('click', async () => {
    if (busy()) { announce('Stop the active Presence or Unsend run before starting Ghost Mode.'); return; }
    if (active || loading || loadFailed || (needsReconciliation && !reconciled.checked)) return;
    const found = await findConversations({ all: true });
    if (!found) return;
    const ids = found.inventory?.conversations.map(thread => thread.threadId) || [];
    if (!ids.length) { announce('No conversations found. Nothing was removed.'); return; }
    for (const id of ids) { selected.add(id); if (rows.has(id)) rows.get(id).input.checked = true; }
    updateControls();
    await startReview(ids);
  });
  selectAll.addEventListener('click', () => {
    if (active) return;
    for (const [id, row] of rows) {
      if (row.label.hidden) continue;
      selected.add(id); row.input.checked = true;
    }
    updateControls();
  });
  async function startReview(threadIds) {
    if (active || loading || loadFailed || busy() || !threadIds.length
      || (needsReconciliation && !reconciled.checked)) return;
    const epoch = ++operationEpoch;
    active = true; updateControls();
    let threadNavigator = null;
    try {
      const options = messageOptions();
      const captured = discovery.review({ threadIds, scope: options.scope, limit: options.limit });
      if (ghostBridge) {
        const account = context();
        const plan = ghostBridge.createReview({
          accountId: account.accountId,
          threadIds: captured.threadIds,
          scope: captured.scope, limit: captured.limit,
          workerCount: Number(workers.value),
          openInBackground: workerMode.value === 'background',
          expiresAt: Date.now() + 12 * 60 * 60_000,
        });
        const key = userscriptGhostReviewKey(plan);
        const confirmed = await confirmAction({
          title: `Clean up ${plan.threadIds.length} conversation${plan.threadIds.length === 1 ? '' : 's'}?`,
          message: plan.scope === 'all' ? 'Permanently unsend your messages in the selected conversations.'
            : `Permanently unsend the ${plan.scope} ${plan.limit} message${plan.limit === 1 ? '' : 's'} you sent in each selected conversation?`,
          detail: 'Keep the inbox tab and worker tabs open. Worker tabs prepare conversations in parallel; removals stay account-paced and stop together.',
          confirmLabel: 'Start Ghost mode',
          facts: [{ label: 'Account', value: account.accountLabel ? `@${account.accountLabel}` : 'Current signed-in account' },
            { label: 'Conversations', value: String(plan.threadIds.length) },
            { label: 'Worker tabs', value: String(plan.workerCount) },
            { label: 'Open tabs', value: plan.openInBackground ? 'In the background' : 'In front' },
            { label: 'Messages', value: plan.scope === 'all' ? 'All messages you sent'
              : `${plan.scope === 'newest' ? 'Newest' : 'Oldest'} ${plan.limit} in each conversation` }],
          binding: { action: 'inbox-unsend-workers', reviewKey: key },
        });
        if (!confirmed || epoch !== operationEpoch) { announce('Canceled. Nothing was removed.'); return; }
        if (confirmed.action !== 'inbox-unsend-workers' || confirmed.reviewKey !== key || busy()) {
          throw new Error('inbox-review-changed');
        }
        controller = ghostBridge.createManager(plan);
        needsReconciliation = false; recovery.hidden = true; reconciled.checked = false;
        unsubscribe = controller.subscribe(value => {
          if (value) renderCheckpoint(value);
        });
        updateControls();
        const state = await controller.start();
        if (state) renderCheckpoint(state);
        announce(state?.reason ? friendlyReason(state.reason) : 'Selected conversations finished.');
        return;
      }
      const { version, arrivalPolicy, ...base } = captured;
      const plan = createSingleTabInboxReview({ ...base, version: 2, messageWindow: 'during-run' });
      const key = inboxReviewKey(plan);
      const account = viewer.inspect({ document, location: window.location });
      const confirmed = await confirmAction({
        title: `Clean up ${plan.threadIds.length} conversation${plan.threadIds.length === 1 ? '' : 's'}?`,
        message: 'Permanently unsend your messages in the selected conversations.',
        detail: 'Messages you send while cleanup is running may also be removed. Keep this Instagram tab loaded and do not send messages in these conversations until it finishes.',
        confirmLabel: 'Start cleanup',
        facts: [{ label: 'Account', value: `@${account.accountId}` },
          { label: 'Conversations', value: plan.threadIds.join(', ') },
          { label: 'Messages', value: 'All messages you sent; one conversation at a time' }],
        binding: { action: 'inbox-unsend', reviewKey: key },
      });
      if (!confirmed || epoch !== operationEpoch) { announce('Canceled. Nothing was removed.'); return; }
      if (confirmed.action !== 'inbox-unsend' || confirmed.reviewKey !== key || busy()) throw new Error('inbox-review-changed');
      threadNavigator = discovery.createNavigator({ expiresAt: plan.expiresAt });
      controller = createSingleTabInboxController({
        review: plan, runner, inspectCurrent: context, locks: window.navigator?.locks,
        navigate: ({ threadId, signal }) => threadNavigator.navigate(threadId, { signal }), save: persist,
      });
      needsReconciliation = false; recovery.hidden = true; reconciled.checked = false;
      unsubscribe = controller.subscribe(renderCheckpoint);
      updateControls();
      const token = controller.approve(key);
      await controller.start(token);
      const state = controller.snapshot();
      announce(state.reason ? friendlyReason(state.reason) : 'Selected conversations finished.');
    } catch (error) { announce(friendlyReason(error.message)); }
    finally {
      threadNavigator?.stop(); active = false;
      const latest = controller?.snapshot();
      if (latest) {
        renderCheckpoint(latest);
        needsReconciliation = Boolean(latest.pendingMutation || latest.pendingMutations?.length
          || latest.tasks.some(task => task.status === 'uncertain'));
        recovery.hidden = !needsReconciliation;
      }
      updateControls();
    }
  }
  review.addEventListener('click', () => startReview([...selected]));
  resume.addEventListener('click', () => startReview(remainingThreads()));
  const stopAll = () => {
    if (!active) return false;
    operationEpoch += 1;
    cancelConfirmation();
    if (controller) void controller.stop().catch(error => announce(friendlyReason(error.message))); else discovery.stop();
    return true;
  };
  stop.addEventListener('click', stopAll);
  pause.addEventListener('click', () => { void controller?.pause().catch(error => announce(friendlyReason(error.message))); });
  skip.addEventListener('click', () => { void controller?.skip(); });
  document.addEventListener('freeze', stopAll);
  window.addEventListener('pagehide', stopAll);
  updateControls();
  return Object.freeze({ ready: Promise.all([ready, workerStartup]), busy: () => active, stop: stopAll, snapshot: () => checkpoint && structuredClone(checkpoint),
    dispose() { stopAll(); unsubscribe?.(); document.removeEventListener('freeze', stopAll); window.removeEventListener('pagehide', stopAll); },
  });
}
