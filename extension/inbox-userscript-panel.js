import { createUserscriptInboxDiscovery } from './inbox-userscript-discovery.js';
import { inboxReviewKey } from './inbox-coordinator.js';
import { createSingleTabInboxController, createSingleTabInboxReview } from './inbox-single-tab.js';

export function mountUserscriptInboxPanel({
  container, document = globalThis.document, window = globalThis.window,
  viewer = globalThis.InstaToolboxInstagramViewer,
  runner = globalThis.InstaToolboxDmThreadUnsender,
  confirmAction, cancelConfirmation = () => {}, save, load = async () => null,
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
  const note = create('p', 'Open your inbox to find conversations. Nothing is removed during this step.', 'lead');
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
  container.append(note, section, acknowledgment, controls, inventoryStatus, filterLabel, filterStatus, list, supportNote, recovery, actions, storageNote, results);

  function context() {
    const value = viewer.inspect({ document, location: window.location });
    return { ...value, accountId: value.accountKey, documentId,
      usable: value.accountVerified === true && !value.restriction
        && (value.usable === true || /^\/direct\/inbox\/?$/.test(window.location.pathname)),
      challenge: Boolean(value.restriction), rateLimited: false, actionBlocked: false, sessionExpired: false };
  }
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
    section.disabled = active; acknowledged.disabled = active;
    selectAll.hidden = !inventory?.conversations.length; selectAll.disabled = active || !shown;
    selectAll.textContent = query ? 'Select visible matches' : 'Select all found';
    review.hidden = !inventory?.conversations.length;
    review.disabled = active || loading || loadFailed || !selected.size || !window.navigator?.locks?.request
      || (needsReconciliation && !reconciled.checked);
    review.textContent = `Review ${selected.size} conversation${selected.size === 1 ? '' : 's'}`;
    const remaining = remainingThreads();
    resume.hidden = active || !remaining.length;
    resume.disabled = loading || loadFailed || !window.navigator?.locks?.request
      || (needsReconciliation && !reconciled.checked);
    resume.textContent = `Review ${remaining.length} remaining to resume`;
    stop.hidden = !active; pause.hidden = !active || !controller; skip.hidden = !active || !controller;
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
  const discovery = createUserscriptInboxDiscovery({ document, window, viewer, onProgress: showInventory });
  function friendlyReason(reason) {
    const labels = {
      'inbox-route-required': 'Open your inbox first.',
      'inbox-viewer-unverified': 'Your signed-in account could not be verified.',
      'section-control-unavailable': 'This inbox section could not be identified.',
      'inbox-account-changed': 'The signed-in account changed. Find conversations again.',
      'account-activity-busy': 'Another cleanup is already running.',
      'account-pacing': 'Waiting before the next removal.',
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
  find.addEventListener('click', async () => {
    if (active || loading || loadFailed || busy()) return;
    if (!acknowledged.checked) { announce('Confirm that opening conversations may mark them read.'); acknowledged.focus(); return; }
    const epoch = ++operationEpoch;
    active = true; inventory = null; selected.clear(); rows.clear(); filter.value = ''; list.replaceChildren(); unsubscribe?.(); controller = null; updateControls();
    try {
      await loadCheckpoint();
      if (epoch !== operationEpoch) return;
      const sections = section.value === 'all' ? discovery.availableSections() : [section.value];
      if (!sections.length) throw new Error('section-control-unavailable');
      await discovery.discover({ navigationAcknowledged: true, sections });
    }
    catch (error) { announce(friendlyReason(error.message)); }
    finally { active = false; updateControls(); }
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
      const captured = discovery.review({ threadIds, scope: 'all' });
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
  return Object.freeze({ ready, busy: () => active, stop: stopAll, snapshot: () => checkpoint && structuredClone(checkpoint),
    dispose() { stopAll(); unsubscribe?.(); document.removeEventListener('freeze', stopAll); window.removeEventListener('pagehide', stopAll); },
  });
}
