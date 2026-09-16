const MAX_THREADS = 10_000;
const MAX_PARTICIPANTS = 250;
const record = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const numericId = (value) => typeof value === 'string' && /^[0-9]{1,128}$/.test(value);
const username = (value) => typeof value === 'string'
  && /^@?[a-z0-9._]{1,30}$/i.test(value.trim())
  ? value.trim().replace(/^@/, '').toLowerCase() : null;

// This is metadata, not action authority. Its transport and live identity must
// be verified separately before an inventory can become a reviewed run.
export function parseNativeInboxThread(response, { expectedAccountId } = {}) {
  if (!numericId(expectedAccountId)) throw new Error('account-identity-required');
  if (!record(response) || !record(response.data)
    || !record(response.data.get_slide_thread_nullable)
    || !record(response.data.get_slide_thread_nullable.as_ig_direct_thread)) {
    throw new Error('native-thread-response-unrecognized');
  }
  const thread = response.data.get_slide_thread_nullable.as_ig_direct_thread;
  if (thread.viewer_id !== expectedAccountId) throw new Error('account-changed');
  if (!numericId(thread.thread_id) || typeof thread.is_group !== 'boolean'
    || !Array.isArray(thread.users) || thread.users.length > MAX_PARTICIPANTS) {
    throw new Error('native-thread-identity-invalid');
  }
  const participants = new Set();
  let unresolvedParticipants = 0;
  for (const user of thread.users) {
    if (!record(user)) throw new Error('native-participant-invalid');
    if (String(user.pk ?? user.id ?? '') === expectedAccountId) continue;
    const handle = username(user.username);
    if (handle) participants.add(handle);
    else unresolvedParticipants += 1;
  }
  return {
    threadId: thread.thread_id,
    accountId: expectedAccountId,
    participantUsernames: [...participants].sort(),
    unresolvedParticipants,
    isGroup: thread.is_group,
    source: 'native-inbox-response',
    requiresLiveResolution: true,
  };
}

export function createInboxInventory({ accountId, maxThreads = 1_000 } = {}) {
  if (!numericId(accountId)) throw new Error('account-identity-required');
  if (!Number.isSafeInteger(maxThreads) || maxThreads < 1 || maxThreads > MAX_THREADS) {
    throw new Error('inventory-bound-invalid');
  }
  const threads = new Map();
  const conflicted = new Set();
  let stopped = false;
  const snapshot = () => ({
    version: 1, accountId, complete: false,
    reason: stopped ? 'inventory-limit' : 'coverage-unverified',
    conversations: [...threads.values()].map((value) => ({
      ...value, participantUsernames: [...value.participantUsernames],
      identityConflict: conflicted.has(value.threadId),
    })),
  });
  return Object.freeze({
    snapshot,
    clear() {
      threads.clear();
      conflicted.clear();
      stopped = false;
      return snapshot();
    },
    observe(response) {
      if (stopped) return snapshot();
      const candidate = parseNativeInboxThread(response, { expectedAccountId: accountId });
      const previous = threads.get(candidate.threadId);
      if (!previous && threads.size >= maxThreads) {
        stopped = true;
        return snapshot();
      }
      if (previous && (previous.isGroup !== candidate.isGroup
        || previous.unresolvedParticipants !== candidate.unresolvedParticipants
        || JSON.stringify(previous.participantUsernames) !== JSON.stringify(candidate.participantUsernames))) {
        // A changed membership/name needs review; never silently retarget it.
        conflicted.add(candidate.threadId);
      }
      if (!previous) threads.set(candidate.threadId, candidate);
      return snapshot();
    },
  });
}

export function resolveInboxUsernames(inventory, input) {
  if (!record(inventory) || !numericId(inventory.accountId)
    || !Array.isArray(inventory.conversations) || inventory.conversations.length > MAX_THREADS) {
    throw new Error('inventory-invalid');
  }
  const raw = typeof input === 'string' ? input.split(/[\s,;]+/).filter(Boolean) : input;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_PARTICIPANTS) {
    throw new Error('selected-usernames-invalid');
  }
  const handles = [...new Set(raw.map((value) => {
    const normalized = username(value);
    if (!normalized) throw new Error('selected-username-invalid');
    return normalized;
  }))];
  return handles.map((handle) => {
    const candidates = inventory.conversations.filter((thread) => record(thread)
      && thread.accountId === inventory.accountId && numericId(thread.threadId)
      && thread.isGroup === false && thread.identityConflict !== true
      && thread.unresolvedParticipants === 0
      && Array.isArray(thread.participantUsernames)
      && thread.participantUsernames.length === 1 && thread.participantUsernames[0] === handle);
    const ids = [...new Set(candidates.map((thread) => thread.threadId))];
    return {
      username: handle,
      state: ids.length === 1 ? 'candidate' : ids.length ? 'ambiguous' : 'not-found',
      threadId: ids.length === 1 ? ids[0] : null,
      requiresLiveResolution: true,
    };
  });
}

// Meta export paths and titles are archive identities, not native thread IDs.
// Do not infer a live target from a numeric folder suffix or a display name.
export function parseMetaInboxInventory(files) {
  if (!Array.isArray(files) || files.length > MAX_THREADS) throw new Error('export-file-limit');
  const conversations = new Map();
  for (const file of files) {
    if (!record(file) || !record(file.data) || !Array.isArray(file.data.messages)
      || !Array.isArray(file.data.participants) || file.data.participants.length > MAX_PARTICIPANTS) {
      throw new Error('meta-conversation-invalid');
    }
    const sourceName = typeof file.sourceName === 'string' ? file.sourceName.replace(/\\/g, '/') : '';
    const archivePath = typeof file.data.thread_path === 'string' ? file.data.thread_path
      : sourceName.replace(/\/message_\d+\.json$/i, '');
    if (!archivePath || archivePath.length > 1_024 || /[\u0000-\u001f]/.test(archivePath)
      || archivePath.split(/[\\/]/).includes('..')) throw new Error('export-path-invalid');
    const labels = [...new Set(file.data.participants.map((participant) => {
      if (!record(participant) || typeof participant.name !== 'string'
        || participant.name.length > 200) throw new Error('export-participant-invalid');
      return participant.name.trim();
    }).filter(Boolean))].sort();
    const previous = conversations.get(archivePath);
    if (previous && JSON.stringify(previous.participantLabels) !== JSON.stringify(labels)) {
      previous.identityConflict = true;
    } else if (!previous) {
      conversations.set(archivePath, {
        archivePath, participantLabels: labels, threadId: null,
        source: 'meta-export', identityConflict: false, requiresLiveResolution: true,
      });
    }
  }
  return { version: 1, complete: false, reason: 'export-is-a-snapshot', conversations: [...conversations.values()] };
}
