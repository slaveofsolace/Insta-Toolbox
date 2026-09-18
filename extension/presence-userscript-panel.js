import { compilePlan, normalizeHandle } from '../src/core/presence.js';
import { createPresenceBatchDraft } from './presence-batch-review.js';

const MESSAGES = Object.freeze({
  'fresh-runtime-capture-required': 'Run Mutual Checker for your account from the inbox, then build a plan.',
  'viewer-changed-or-unavailable': 'Open your inbox so the signed-in account can be checked.',
  'capture-expired': 'These lists are out of date. Run Mutual Checker again.',
  'profile-account-mismatch': 'The saved routine belongs to another account.',
  'routine-source-unavailable': 'These lists support follow-back plans only.',
  'review-expired': 'This plan expired. Build it again.',
  'capture-changed': 'The checked lists changed. Build a new plan.',
  'targets-changed': 'The suggested accounts changed. Build a new plan.',
  'routine-changed': 'The routine changed. Build a new plan.',
  'account-changed': 'The signed-in account changed. Build a new plan.',
  'outside-active-window': 'This is outside your routine’s active hours.',
});
const LIVE_REASON = 'Planning only. No actions run here.';
const PAGE_SIZE = 25;

export function mountUserscriptPresencePanel({
  container, document = globalThis.document, nativeAdapter, getCapture, getProfile,
  onReview = null, onManual, onStatus = () => {}, now = Date.now, preferenceStore = null,
} = {}) {
  if (!container || !document?.createElement || typeof nativeAdapter?.prepareProductionInputs !== 'function'
    || typeof getCapture !== 'function' || typeof getProfile !== 'function'
    || typeof onManual !== 'function' || (onReview !== null && typeof onReview !== 'function')
    || typeof onStatus !== 'function' || typeof now !== 'function'
    || (preferenceStore !== null && (typeof preferenceStore.load !== 'function'
      || typeof preferenceStore.update !== 'function'))) throw new Error('presence-panel-adapter-required');
  const create = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = create('section', null, 'presence-routine');
  root.setAttribute('aria-label', 'Presence');
  const style = create('style', `
    .presence-routine{display:grid;gap:12px;min-width:0;color:var(--insta-toolbox-text);font:inherit}
    .presence-routine h3,.presence-routine p{margin:0;overflow-wrap:anywhere}
    .presence-routine h3{font-size:16px;line-height:1.4}
    .presence-routine .presence-fields{display:grid;gap:12px;min-width:0}
    .presence-routine label{display:grid;gap:4px;min-width:0}
    .presence-routine input:not([type=checkbox]),.presence-routine textarea{box-sizing:border-box;width:100%;min-height:44px;font:inherit;color:inherit;background:var(--insta-toolbox-bg-sunken);border:1px solid var(--insta-toolbox-line);border-radius:8px;padding:8px}
    .presence-routine textarea{min-height:64px;resize:vertical}
    .presence-routine .presence-choice{display:flex;align-items:center;gap:8px;min-height:44px;overflow-wrap:anywhere}
    .presence-routine input[type=checkbox]{flex:0 0 auto;accent-color:var(--insta-toolbox-accent)}
    .presence-routine .presence-actions{display:flex;flex-wrap:wrap;gap:8px}
    .presence-routine .presence-actions button{flex:1 1 140px;white-space:normal}
    .presence-routine .presence-note{font-size:12px;line-height:1.5;color:var(--insta-toolbox-muted,var(--insta-toolbox-text))}
    .presence-routine .presence-results{display:grid;gap:8px;min-width:0}
    .presence-routine ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
    .presence-routine li{min-width:0;overflow-wrap:anywhere}
    .presence-routine .presence-target-text{display:grid;gap:4px;min-width:0}
    .presence-routine details{border-top:1px solid var(--insta-toolbox-line);padding-top:8px}
    .presence-routine summary{display:list-item;cursor:pointer;min-height:44px;align-content:center;list-style:disclosure-closed inside}
    .presence-routine details[open]>summary{list-style-type:disclosure-open}
    .presence-routine :focus-visible{outline:2px solid var(--insta-toolbox-accent,Highlight);outline-offset:2px}
    .presence-routine [hidden]{display:none!important}
    @media(forced-colors:active){.presence-routine input,.presence-routine textarea,.presence-routine button{border:1px solid ButtonText}.presence-routine summary{color:CanvasText;-webkit-text-fill-color:CanvasText}.presence-routine :focus-visible{outline-color:Highlight}}
  `);
  const context = create('p', 'Follow back from your latest checked lists.', 'presence-note');
  const choicesDisclosure = create('details'); choicesDisclosure.open = true;
  choicesDisclosure.setAttribute('data-presence', 'choices');
  const choicesSummary = create('summary', 'Plan choices');
  const fields = create('div', null, 'presence-fields');
  const allowanceLabel = create('label', 'Accounts in this plan');
  const allowance = create('input'); allowance.type = 'number'; allowance.min = '0'; allowance.max = '50'; allowance.step = '1';
  allowance.setAttribute('data-presence', 'allowance');
  const keepLabel = create('label', 'Keep these accounts unchanged');
  const keep = create('textarea'); keep.rows = 2; keep.placeholder = '@account, @another';
  keep.setAttribute('data-presence', 'protected');
  const includeLabel = create('label', null, 'presence-choice');
  const includePrivate = create('input'); includePrivate.type = 'checkbox'; includePrivate.setAttribute('data-presence', 'private');
  includeLabel.append(includePrivate, document.createTextNode('Include private accounts'));
  const privacyNote = create('p', 'Privacy is not included in checked lists. Leave this off to hold accounts with unknown privacy.', 'presence-note');
  const hours = create('details');
  const hoursSummary = create('summary', 'Hours and privacy');
  const hoursFields = create('div', null, 'presence-fields');
  const startLabel = create('label', 'From');
  const start = create('input'); start.type = 'time'; start.setAttribute('data-presence', 'start');
  const endLabel = create('label', 'Until');
  const end = create('input'); end.type = 'time'; end.setAttribute('data-presence', 'end');
  const zone = create('p', '', 'presence-note');
  startLabel.append(start); endLabel.append(end);
  hoursFields.append(startLabel, endLabel, zone, includeLabel, privacyNote);
  hours.append(hoursSummary, hoursFields);
  allowanceLabel.append(allowance); keepLabel.append(keep);
  fields.append(allowanceLabel, keepLabel, hours);
  const actions = create('div', null, 'presence-actions');
  const buildButton = create('button', 'Build my plan', 'button primary'); buildButton.type = 'button';
  const reviewButton = create('button', 'Review selected', 'button primary'); reviewButton.type = 'button'; reviewButton.hidden = true;
  const manualButton = create('button', 'Manual Follow / Unfollow', 'button quiet'); manualButton.type = 'button';
  actions.append(buildButton, reviewButton, manualButton);
  const feedback = create('p', '', 'presence-note');
  feedback.hidden = true;
  const storageNote = create('p', '', 'presence-note'); storageNote.hidden = true;
  storageNote.setAttribute('data-presence', 'storage');
  const repairButton = create('button', 'Save corrected choices', 'button quiet');
  repairButton.type = 'button'; repairButton.hidden = true;
  const results = create('div', null, 'presence-results'); results.hidden = true;
  const summary = create('p');
  summary.setAttribute('data-presence', 'plan-summary');
  summary.setAttribute('tabindex', '-1');
  const targets = create('ul'); targets.setAttribute('aria-label', 'Suggested accounts');
  const held = create('details');
  const heldSummary = create('summary');
  const heldList = create('ul');
  const moreHeld = create('button', 'Show more', 'button quiet'); moreHeld.type = 'button';
  held.append(heldSummary, heldList, moreHeld);
  const executionNote = create('p', LIVE_REASON, 'presence-note');
  results.append(summary, targets, held);
  choicesDisclosure.append(choicesSummary, fields, storageNote, repairButton);
  root.append(style, context, executionNote, choicesDisclosure, feedback, results, actions);
  container.append(root);

  const listeners = [];
  const listen = (node, type, handler) => { node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler)); };
  let disposed = false, epoch = 0, status = 'idle', reason = null;
  let plan = null, capture = null, heldRows = [], heldCount = PAGE_SIZE, reviewPending = false;
  let storageWritable = true, saveEpoch = 0, preferencesLoading = Boolean(preferenceStore);
  let needsRepair = false, repairing = false;
  const edited = new Set();
  const selected = new Set();
  const initial = getProfile() || {};
  allowance.value = String(initial.followLimit ?? 6);
  keep.value = (initial.protectedHandles || []).map(name => `@${name}`).join(', ');
  includePrivate.checked = initial.skipPrivate === false;
  const formatMinute = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  start.value = formatMinute(initial.window?.start ?? 540);
  end.value = formatMinute(initial.window?.end ?? 1200);
  zone.textContent = `Plan hours · ${initial.timezone || 'UTC'}`;

  const choices = [
    [allowance, 'followLimit'], [keep, 'protectedHandles'], [start, 'window.start'],
    [end, 'window.end'], [includePrivate, 'skipPrivate'],
  ];
  const showStorage = text => {
    if (disposed) return;
    storageNote.textContent = text; storageNote.hidden = !text;
    repairButton.hidden = !needsRepair || !storageWritable;
    repairButton.disabled = repairing;
  };
  const ready = preferenceStore ? Promise.resolve().then(() => preferenceStore.load()).then(saved => {
    if (disposed) return;
    storageWritable = saved.writable !== false;
    needsRepair = saved.issues?.some(issue => !['older-record', 'version-unsupported', 'write-outcome-uncertain'].includes(issue)) || false;
    const value = saved.preferences;
    if (!edited.has('followLimit')) allowance.value = String(value.followLimit);
    if (!edited.has('protectedHandles')) keep.value = value.protectedHandles.map(name => `@${name}`).join(', ');
    if (!edited.has('skipPrivate')) includePrivate.checked = !value.skipPrivate;
    if (!edited.has('window.start')) start.value = formatMinute(value.window.start);
    if (!edited.has('window.end')) end.value = formatMinute(value.window.end);
    if (plan) invalidate(null);
    showStorage(!storageWritable ? saved.issues?.includes('version-unsupported')
      ? 'Saved choices use a newer format. Changes stay in this tab.'
      : 'Saving choices is unavailable. Changes stay in this tab.'
      : needsRepair ? 'Check the saved choices above, then save the corrected values.' : '');
  }).catch(() => {
    storageWritable = false;
    showStorage('Saved choices could not load. Changes stay in this tab.');
  }).finally(() => {
    preferencesLoading = false;
    if (!disposed) controls();
  }) : Promise.resolve();

  function readChoices() {
    const countText = String(allowance.value).trim();
    if (!/^\d+$/.test(countText) || Number(countText) > 50) throw new Error('Choose a whole number from 0 to 50.');
    const readMinute = value => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Choose valid plan hours.');
      const [hour, minute] = value.split(':').map(Number);
      return hour * 60 + minute;
    };
    const window = { start: readMinute(start.value), end: readMinute(end.value) };
    if (window.start === window.end) throw new Error('Choose different start and end times.');
    const tokens = String(keep.value || '').split(/[\s,;]+/).filter(Boolean);
    if (tokens.length > 500) throw new Error('Keep at most 500 protected accounts.');
    return { followLimit: Number(countText), skipPrivate: !includePrivate.checked, window,
      protectedHandles: [...new Set(tokens.map(name => normalizeHandle(name)))] };
  }

  async function saveChoice(key) {
    if (!preferenceStore || disposed) return;
    const ticket = ++saveEpoch;
    await ready;
    if (disposed || !storageWritable) return;
    if (needsRepair) { showStorage('Check the saved choices above, then save the corrected values.'); return; }
    let patch;
    try {
      const value = readChoices();
      patch = key.startsWith('window.') ? { window: { [key.split('.')[1]]: value.window[key.split('.')[1]] } }
        : { [key]: value[key] };
    }
    catch { showStorage('Finish the choices above to save them.'); return; }
    try {
      await preferenceStore.update(patch);
      if (!disposed && ticket === saveEpoch) showStorage('');
    } catch {
      if (!disposed && ticket === saveEpoch) showStorage('Choices could not save. Changes stay in this tab.');
    }
  }

  async function repairChoices() {
    if (disposed || !preferenceStore || !storageWritable || !needsRepair || repairing) return;
    let values;
    try { values = readChoices(); }
    catch { showStorage('Finish the choices above to save them.'); return; }
    const ticket = ++saveEpoch;
    repairing = true; showStorage('Saving corrected choices…');
    try {
      await preferenceStore.update(values);
      if (!disposed) {
        if (ticket === saveEpoch) { needsRepair = false; showStorage(''); }
        else showStorage('Choices changed while saving. Save the current choices.');
      }
    } catch {
      showStorage('Choices could not save. Changes stay in this tab.');
    } finally {
      repairing = false;
      if (!disposed) repairButton.disabled = false;
    }
  }

  function announce(text) { feedback.textContent = text; feedback.hidden = !text; onStatus(text); }
  function controls() {
    buildButton.disabled = preferencesLoading;
    buildButton.hidden = Boolean(plan);
    choicesSummary.textContent = plan ? 'Edit plan choices' : 'Plan choices';
    reviewButton.hidden = !plan?.targets.length || typeof onReview !== 'function';
    reviewButton.disabled = reviewPending || !selected.size || typeof onReview !== 'function';
    reviewButton.textContent = `Review ${selected.size} account${selected.size === 1 ? '' : 's'}`;
    buildButton.className = plan?.targets.length && typeof onReview === 'function' ? 'button quiet' : 'button primary';
  }
  function invalidate(message = 'Build a new plan to review these choices.') {
    if (disposed) return;
    epoch += 1; plan = null; capture = null; selected.clear(); reviewPending = false;
    status = 'idle'; reason = null; results.hidden = true; targets.replaceChildren(); heldList.replaceChildren();
    context.textContent = 'Follow back from your latest checked lists.';
    controls();
    if (message) announce(message);
    else { feedback.textContent = ''; feedback.hidden = true; }
  }
  function unavailable(code) {
    invalidate(null); status = 'unavailable'; reason = code;
    announce(MESSAGES[code] || 'This plan is unavailable. Check the lists and choices, then try again.');
  }
  function prepare() {
    const base = getProfile() || {};
    const { protectedHandles: names, ...choice } = readChoices();
    const preferences = { ...base, goal: 'maintain', ...choice };
    const original = getCapture();
    const prepared = nativeAdapter.prepareProductionInputs({ capture: original, profile: preferences });
    if (prepared.status !== 'ready-for-review') return { original, prepared };
    const protectedIds = new Set(prepared.inputs.profile.protectedIds);
    const unresolved = [];
    for (const name of names) {
      const matches = prepared.inputs.candidates.filter((candidate) => candidate.username === name);
      if (matches.length !== 1) unresolved.push(`@${name}`);
      else protectedIds.add(matches[0].targetId);
    }
    if (unresolved.length) throw new Error(`Not found in these checked lists: ${unresolved.slice(0, 3).join(', ')}${unresolved.length > 3 ? '…' : ''}. Refresh the lists or update the protected accounts.`);
    const final = nativeAdapter.prepareProductionInputs({ capture: original, profile: { ...preferences, protectedIds: [...protectedIds] } });
    return { original, prepared: final };
  }
  function renderHeld() {
    heldList.replaceChildren();
    for (const decision of heldRows.slice(0, heldCount)) {
      const row = create('li');
      row.append(create('strong', `@${decision.username}`), create('p', decision.reason, 'presence-note'));
      heldList.append(row);
    }
    moreHeld.hidden = heldRows.length <= heldCount;
    moreHeld.textContent = `Show ${Math.min(PAGE_SIZE, Math.max(0, heldRows.length - heldCount))} more`;
  }
  function renderPlan(prepared) {
    context.textContent = `Follow-back plan for @${plan.profile.username}`;
    results.hidden = false; targets.replaceChildren();
    summary.textContent = `${plan.targets.length} suggested · ${plan.decisions.length - plan.targets.length} held`;
    for (const target of plan.targets) {
      const row = create('li');
      const text = create('span', null, 'presence-target-text');
      text.append(create('strong', `@${target.username}`), create('span', target.reason, 'presence-note'));
      if (typeof onReview !== 'function') { row.append(text); targets.append(row); continue; }
      const label = create('label', null, 'presence-choice');
      const input = create('input'); input.type = 'checkbox'; input.checked = true;
      input.setAttribute('data-presence-target', target.targetId);
      label.append(input, text); row.append(label); targets.append(row);
      input.addEventListener('change', () => {
        if (disposed || !plan) return;
        if (input.checked) selected.add(target.targetId); else selected.delete(target.targetId);
        epoch += 1; reviewPending = false; status = 'planned'; controls();
      });
    }
    heldRows = plan.decisions.filter((decision) => !plan.targets.some((target) => target.targetId === decision.targetId));
    heldCount = PAGE_SIZE; held.hidden = !heldRows.length;
    heldSummary.textContent = `Held accounts (${heldRows.length})`; renderHeld(); controls();
    const extras = [];
    if (!prepared.evidence.followersComplete) extras.push('Follower list is partial; only found accounts are considered.');
    if (!prepared.evidence.negativeFollowingEvidence) extras.push('Following is incomplete or unresolved; missing accounts stay unknown.');
    if (prepared.evidence.unresolvedFollowers || prepared.evidence.identityConflicts) extras.push('Unresolved account identities were left out.');
    if (prepared.evidence.truncated) extras.push(`${prepared.evidence.omitted} accounts are outside this plan’s input limit.`);
    const message = plan.targets.length ? '' : 'No accounts match these choices.';
    feedback.textContent = [message, ...extras].filter(Boolean).join(' ');
    feedback.hidden = !feedback.textContent;
    onStatus([summary.textContent, feedback.textContent].filter(Boolean).join('. '));
  }
  function build() {
    if (disposed || preferencesLoading) return false;
    const activeElement = root.getRootNode?.()?.activeElement || document.activeElement;
    const focusFromBuild = activeElement === buildButton;
    invalidate(null);
    try {
      const value = prepare();
      if (value.prepared.status !== 'ready-for-review') { unavailable(value.prepared.reason); return false; }
      capture = value.original;
      plan = compilePlan({ ...value.prepared.inputs, now: now() });
      selected.clear(); for (const target of plan.targets) selected.add(target.targetId);
      status = 'planned'; renderPlan(value.prepared);
      // A deliberate Build can compact the form; background refresh never
      // closes a disclosure or moves focus away from an edited control.
      if (!choicesDisclosure.contains?.(activeElement)) choicesDisclosure.open = false;
      if (focusFromBuild) summary.focus?.({ preventScroll: true });
      return true;
    } catch (error) {
      invalidate(null); status = 'unavailable'; reason = 'invalid-choices';
      const message = String(error?.message || '');
      announce(/^(Choose a whole number|Choose valid plan hours|Choose different start|Keep at most|Not found in these checked lists)/.test(message)
        ? message : 'Check the account names and routine choices.');
      return false;
    }
  }
  function currentDraft({ allowEmptySelection = false } = {}) {
    if (!plan || (!selected.size && !allowEmptySelection)) return { status: 'unavailable', reason: 'exact-selection-required' };
    const value = prepare();
    if (value.original !== capture) return { status: 'unavailable', reason: 'capture-changed' };
    if (value.prepared.status !== 'ready-for-review') return value.prepared;
    return createPresenceBatchDraft({ reviewedPlan: plan, current: value.prepared.inputs,
      selectedTargetIds: selected.size ? [...selected] : plan.targets.map((target) => target.targetId), now: now() });
  }
  async function review() {
    if (disposed || reviewPending || typeof onReview !== 'function') return false;
    let token = epoch;
    try {
      const draft = currentDraft();
      if (draft.status !== 'review-required') { unavailable(draft.reason); return false; }
      token = ++epoch; reviewPending = true; status = 'reviewing'; controls();
      await onReview(draft);
      if (disposed || token !== epoch) return false;
      const checked = currentDraft();
      if (checked.status !== 'review-required') { unavailable(checked.reason); return false; }
      reviewPending = false; status = 'reviewed'; controls();
      announce('Selection reviewed. No actions have run.');
      return true;
    } catch {
      if (!disposed && token === epoch) { invalidate(null); status = 'unavailable'; reason = 'review-unavailable'; announce('Review could not open. Build the plan again.'); }
      return false;
    }
  }
  function refresh() {
    if (disposed) return;
    if (plan?.targets.length) {
      try { const draft = currentDraft({ allowEmptySelection: true }); if (draft.status !== 'review-required') unavailable(draft.reason); }
      catch { unavailable('routine-changed'); }
    } else if (plan) {
      try {
        const value = prepare();
        if (value.original !== capture) unavailable('capture-changed');
        else if (value.prepared.status !== 'ready-for-review') unavailable(value.prepared.reason);
        else if (now() < plan.createdAt || now() >= plan.expiresAt) unavailable('review-expired');
        else {
          const fresh = compilePlan({ ...value.prepared.inputs, now: now() });
          if (JSON.stringify(fresh.profile) !== JSON.stringify(plan.profile)
            || JSON.stringify(fresh.targets) !== JSON.stringify(plan.targets)) unavailable('routine-changed');
        }
      } catch { unavailable('routine-changed'); }
    }
  }
  listen(buildButton, 'click', build); listen(reviewButton, 'click', review);
  listen(repairButton, 'click', repairChoices);
  listen(manualButton, 'click', () => { invalidate(null); onManual(); });
  for (const [node, key] of choices) {
    if (node !== includePrivate) listen(node, 'input', () => { edited.add(key); saveEpoch += 1; invalidate(); });
    listen(node, 'change', () => {
      edited.add(key); invalidate();
      return saveChoice(key);
    });
  }
  listen(moreHeld, 'click', () => { heldCount += PAGE_SIZE; renderHeld(); });
  controls();
  return Object.freeze({
    build, review, refresh, invalidate, ready,
    snapshot: () => ({ status, reason, executable: false, selectedTargetIds: [...selected], plan: plan ? structuredClone(plan) : null }),
    dispose() {
      if (disposed) return;
      invalidate(null); disposed = true; status = 'disposed'; listeners.forEach((remove) => remove());
      root.remove();
    },
  });
}
