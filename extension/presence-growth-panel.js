import {
  createGrowthCampaign, dueGrowthUnfollows, growthUsername, rankGrowthCandidates,
} from './presence-growth.js';

const label = (name) => `@${name}`;

export function mountPresenceGrowthPanel({
  container, inspectAccount, readFollowing, readFollowers, scanSeed,
  readCampaigns, writeCampaigns, confirmAction, runBatch,
  canRunBatch = () => true,
  busy = () => false, onStatus = () => {}, document = globalThis.document,
  now = Date.now,
} = {}) {
  if (!container || !document?.createElement || ![inspectAccount, readFollowing, readFollowers,
    scanSeed, readCampaigns, writeCampaigns, confirmAction, runBatch].every((fn) => typeof fn === 'function')) {
    throw new Error('presence-growth-adapter-required');
  }
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const root = make('details');
  root.className = 'presence-growth';
  root.open = true;
  const summary = make('summary', 'Grow through mutuals');
  const note = make('p', 'Choose up to three accounts from your Following list.');
  const seedLabel = make('label', 'Accounts you follow');
  const seedInput = make('input');
  seedInput.type = 'text';
  seedInput.placeholder = '@first, @second';
  seedInput.autocomplete = 'off';
  seedInput.setAttribute('aria-label', 'Accounts you follow, separated by commas');
  seedLabel.append(seedInput);
  const daysLabel = make('label', 'Review unfollows after');
  const days = make('select');
  for (let count = 7; count <= 14; count += 1) {
    const option = make('option', `${count} days`);
    option.value = String(count);
    days.append(option);
  }
  days.value = '7';
  daysLabel.append(days);
  const find = make('button', 'Find mutual connections');
  const cancel = make('button', 'Stop search');
  const follow = make('button', 'Review follows');
  const due = make('button', 'Review due unfollows');
  for (const button of [find, cancel, follow, due]) button.type = 'button';
  find.className = 'button primary';
  cancel.className = 'button quiet';
  follow.className = 'button primary';
  due.className = 'button quiet';
  const progress = make('p', 'Check your Following list in Mutual Checker first.');
  const candidatesList = make('div');
  candidatesList.className = 'presence-growth-candidates';
  const dueList = make('p');
  const style = make('style', `
    .presence-growth{border-top:1px solid var(--insta-toolbox-line);padding-top:8px;min-width:0}
    .presence-growth>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:700;-webkit-text-fill-color:currentColor}
    .presence-growth>summary::after{content:'▾';margin-left:auto;font-size:16px}
    .presence-growth:not([open])>summary::after{content:'▸'}
    .presence-growth>p{margin:4px 0 12px;line-height:1.45}
    .presence-growth label{display:grid;gap:6px;margin:0 0 12px}
    .presence-growth input:not([type=checkbox]),.presence-growth select{box-sizing:border-box;width:100%;min-height:44px;padding:8px 10px;border:1px solid var(--insta-toolbox-line);border-radius:8px;color:var(--insta-toolbox-text);background:var(--insta-toolbox-bg-sunken);font:inherit}
    .presence-growth button{margin:0 8px 8px 0;white-space:normal}
    .presence-growth-candidates{display:grid;gap:4px;max-height:220px;overflow:auto;margin:8px 0}
    .presence-growth-candidates label{display:flex;align-items:center;min-height:44px;margin:0;padding:6px;border-bottom:1px solid var(--insta-toolbox-line);overflow-wrap:anywhere}
    .presence-growth-candidates input{margin-right:8px;flex:none}
    .presence-growth [hidden]{display:none!important}
    .presence-growth :focus-visible{outline:2px solid var(--insta-toolbox-accent,Highlight);outline-offset:2px}
    @media(forced-colors:active){.presence-growth input,.presence-growth select{border-color:CanvasText}.presence-growth>summary{color:LinkText;-webkit-text-fill-color:LinkText}}
  `);
  root.append(style, summary, note, seedLabel, daysLabel, find, cancel, progress,
    candidatesList, follow, dueList, due);
  container.prepend(root);

  let controller = null;
  let candidates = [];
  let selectedSeeds = [];
  let incompleteSeeds = [];
  const setProgress = (message) => { progress.textContent = message; onStatus(message); };
  const account = () => {
    const value = inspectAccount();
    return value?.accountVerified === true && value.usable === true
      ? growthUsername(value.accountId) : '';
  };
  const campaigns = () => {
    const saved = readCampaigns();
    return (Array.isArray(saved) ? saved : [])
    .filter((item) => item?.schemaVersion === 1 && item.account === account()
      && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100
      && Number.isInteger(item.delayDays) && item.delayDays >= 7 && item.delayDays <= 14
      && Array.isArray(item.targets) && item.targets.length > 0 && item.targets.length <= 50
      && item.targets.every((target) => growthUsername(target) === target)
      && item.followed && typeof item.followed === 'object'
      && item.unfollowed && typeof item.unfollowed === 'object').slice(-100);
  };

  function render() {
    const owner = account();
    const savedCampaigns = campaigns();
    const nextDue = savedCampaigns.map((campaign) => ({ campaign,
      targets: dueGrowthUnfollows(campaign, { account: owner, now: now() }) }))
      .find(({ targets }) => targets.length);
    dueList.hidden = savedCampaigns.length === 0;
    due.hidden = !nextDue;
    daysLabel.hidden = candidates.length === 0;
    follow.hidden = candidates.length === 0;
    dueList.textContent = nextDue
      ? `${nextDue.targets.length} campaign follow${nextDue.targets.length === 1 ? '' : 's'} due for review.`
      : 'No campaign unfollows due yet. Reopen Instagram after your chosen wait to review them.';
    due.disabled = !nextDue || Boolean(controller) || busy() || !canRunBatch();
    cancel.hidden = !controller;
    find.disabled = Boolean(controller) || busy();
    follow.disabled = !candidates.length || Boolean(controller) || busy() || !canRunBatch();
  }

  function renderCandidates() {
    candidatesList.replaceChildren();
    for (const [index, candidate] of candidates.entries()) {
      const row = make('label');
      const checkbox = make('input');
      checkbox.type = 'checkbox';
      checkbox.value = candidate.username;
      checkbox.checked = index < 10;
      row.append(checkbox, document.createTextNode(
        `${label(candidate.username)} · mutual with ${candidate.via.map(label).join(', ')}`));
      candidatesList.append(row);
    }
    render();
  }

  async function findCandidates() {
    if (controller || busy()) return;
    const owner = account();
    const following = readFollowing();
    const followingNames = new Set((Array.isArray(following) ? following : [])
      .map((entry) => growthUsername(entry?.username || entry)).filter(Boolean));
    const seeds = [...new Set(seedInput.value.split(/[\s,]+/).map(growthUsername).filter(Boolean))];
    if (!owner || !followingNames.size) {
      setProgress('Check your own Following list in Mutual Checker first.'); return;
    }
    if (!seeds.length || seeds.length > 3 || seeds.some((name) => !followingNames.has(name))) {
      setProgress('Enter one to three accounts found in your captured Following list.'); return;
    }
    const active = new AbortController();
    controller = active;
    candidates = [];
    selectedSeeds = [];
    incompleteSeeds = [];
    renderCandidates();
    try {
      for (const [index, seed] of seeds.entries()) {
        setProgress(`Checking ${label(seed)} (${index + 1} of ${seeds.length})…`);
        const result = await scanSeed(seed, active.signal, (update) => {
          if (active.signal.aborted) return;
          const part = update?.listType === 'followers' || update?.listType === 'following'
            ? `${update.listType}: ${Math.max(0, Number(update.found) || 0)} read`
            : 'resolving profile';
          setProgress(`Checking ${label(seed)} (${index + 1} of ${seeds.length}) · ${part}`);
        });
        if (active.signal.aborted || account() !== owner) throw new Error('Search stopped or account changed.');
        selectedSeeds.push({ username: seed, followers: result.followers, following: result.following });
        if (result.complete?.followers !== true || result.complete?.following !== true) {
          incompleteSeeds.push(seed);
        }
      }
      candidates = rankGrowthCandidates({ account: owner, seeds: selectedSeeds,
        following, followers: readFollowers() });
      renderCandidates();
      const partial = incompleteSeeds.length
        ? ` Partial lists: ${incompleteSeeds.map(label).join(', ')}; other connections may be missing.` : '';
      setProgress(candidates.length
        ? `${candidates.length} observed mutual connections. Select exact accounts to review.${partial}`
        : `No observed mutual connections to review.${partial}`);
    } catch (error) {
      setProgress(active.signal.aborted ? 'Search stopped.' : String(error?.message || 'Search failed.'));
    } finally {
      controller = null;
      render();
    }
  }

  async function reviewFollow() {
    const owner = account();
    const targets = [...candidatesList.querySelectorAll('input:checked')].map((input) => input.value);
    if (!owner || busy() || !canRunBatch() || !targets.length || targets.length > 25) {
      setProgress('Select 1 to 25 candidates and stop other runs first.'); return;
    }
    const waitDays = Number(days.value);
    const expiresAt = now() + 15 * 60_000;
    const binding = { action: 'presence-growth-follow', account: owner,
      targets: JSON.stringify(targets), delayDays: waitDays, expiresAt };
    const approval = await confirmAction({ title: `Follow ${targets.length} accounts?`,
      message: 'Each profile is checked again before following.',
      detail: `After ${waitDays} days, these verified follows will appear here for unfollow review.`,
      confirmLabel: 'Start following', items: targets.map(label),
      facts: [{ label: 'Account', value: label(owner) }, { label: 'Targets', value: String(targets.length) }],
      binding });
    const currentTargets = [...candidatesList.querySelectorAll('input:checked')].map((input) => input.value);
    if (!approval || account() !== owner || busy() || !canRunBatch()
      || JSON.stringify(currentTargets) !== binding.targets || Number(days.value) !== waitDays
      || Object.keys(binding).some((key) => approval[key] !== binding[key])
      || expiresAt <= now()) return;
    const campaign = createGrowthCampaign({ account: owner, targets, delayDays: waitDays,
      createdAt: now(), id: globalThis.crypto?.randomUUID?.() || `growth-${now()}` });
    writeCampaigns([...campaigns(), campaign].slice(-100));
    setProgress(`Following ${targets.length} reviewed accounts. Use Stop in the run bar to end the batch.`);
    await runBatch({ action: 'follow', usernames: targets, growthCampaignId: campaign.id,
      growthAccount: owner });
    render();
  }

  async function reviewDue() {
    const owner = account();
    const entry = campaigns().map((campaign) => ({ campaign,
      targets: dueGrowthUnfollows(campaign, { account: owner, now: now() }) }))
      .find(({ targets }) => targets.length);
    if (!entry || busy() || !canRunBatch()) return;
    const targets = entry.targets.slice(0, 25);
    const expiresAt = now() + 15 * 60_000;
    const binding = { action: 'presence-growth-unfollow', account: owner,
      campaignId: entry.campaign.id, targets: JSON.stringify(targets), expiresAt };
    const approval = await confirmAction({ title: `Unfollow ${targets.length} campaign accounts?`,
      message: 'Only verified follows from this campaign are listed. Each relationship is checked again.',
      confirmLabel: 'Start unfollowing', items: targets.map(label),
      facts: [{ label: 'Account', value: label(owner) }, { label: 'Targets', value: String(targets.length) }],
      binding });
    const fresh = campaigns().find((campaign) => campaign.id === entry.campaign.id);
    if (!approval || account() !== owner || busy() || !canRunBatch() || !fresh
      || JSON.stringify(dueGrowthUnfollows(fresh, { account: owner, now: now() }).slice(0, 25)) !== binding.targets
      || Object.keys(binding).some((key) => approval[key] !== binding[key])
      || expiresAt <= now()) return;
    setProgress(`Unfollowing ${targets.length} reviewed campaign accounts.`);
    await runBatch({ action: 'unfollow', usernames: targets,
      growthCampaignId: entry.campaign.id, growthAccount: owner });
    render();
  }

  const launch = (operation) => {
    void operation().catch((error) => setProgress(String(error?.message || 'Campaign could not start.')));
  };
  find.addEventListener('click', () => launch(findCandidates));
  cancel.addEventListener('click', () => controller?.abort());
  follow.addEventListener('click', () => launch(reviewFollow));
  due.addEventListener('click', () => launch(reviewDue));
  render();
  return Object.freeze({ render, findCandidates, reviewFollow, reviewDue,
    busy: () => Boolean(controller),
    dispose() { controller?.abort(); root.remove(); } });
}
