(() => {
  'use strict';

  const modules = globalThis.__instaToolboxOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.messagesView) return;

  const runner = globalThis.InstaToolboxDmThreadUnsender;
  const subscriptions = new WeakMap();
  const styledShadows = new WeakSet();
  const pendingReservations = new WeakMap();
  const pendingReviews = new WeakSet();
  const DM_PLAN_TTL_MS = 15 * 60 * 1_000;
  const DM_WRITE_TIMEOUT_MS = 8_000;

  function activeConversationId() {
    const match = String(location.pathname || '').match(/^\/direct\/t\/([^/?#]+)\/?$/i);
    return match?.[1] || '';
  }

  function currentPreview(runtime) {
    const preview = runtime.model.dmThreadPreview;
    return preview?.ready
      && preview.threadId === activeConversationId()
      && Number(preview.detectedCount ?? preview.eligibleCount) >= 0
      ? preview
      : null;
  }

  function inspectIntent(runtime, intent) {
    if (!intent || typeof runtime.inspector.inspectReviewedDmItem !== 'function') return null;
    return runtime.inspector.inspectReviewedDmItem({
      conversationId: intent.conversationId,
      contentDigest: intent.contentDigest,
      messageId: intent.messageId,
      sentByMe: true,
      timestamp: intent.timestamp,
    });
  }

  function observationMatches(intent, observation) {
    return Boolean(
      intent
      && observation?.conversationId === intent.conversationId
      && observation?.messageId === intent.messageId
      && Number(observation?.timestamp) === Number(intent.timestamp)
      && observation?.contentDigest === intent.contentDigest
      && observation?.sentByMe === true
      && observation?.exactIdentityAvailable === true
      && observation?.ownershipAvailable === true
      && observation?.resolutionToken
      && !observation?.ambiguous
      && !observation?.unexpectedUi
      && !observation?.sessionExpired
      && !observation?.challenge
      && !observation?.actionBlocked
      && !observation?.rateLimited,
    );
  }

  function applyInstagramDesign(runtime) {
    if (styledShadows.has(runtime.shadow)) return;
    styledShadows.add(runtime.shadow);
    const style = runtime.document.createElement('style');
    style.id = 'insta-toolbox-instagram-design';
    style.textContent = `
      :host([data-theme-preference="auto"]) {
        --insta-toolbox-surface: rgb(var(--ig-primary-background, 255, 255, 255)) !important;
        --insta-toolbox-surface-raised: rgb(var(--ig-elevated-background, 255, 255, 255)) !important;
        --insta-toolbox-rail: rgb(var(--ig-secondary-background, 250, 250, 250)) !important;
        --insta-toolbox-ink: rgb(var(--ig-primary-text, 38, 38, 38)) !important;
        --insta-toolbox-muted: rgb(var(--ig-secondary-text, 115, 115, 115)) !important;
        --insta-toolbox-line: rgb(var(--ig-separator, 219, 219, 219)) !important;
        --insta-toolbox-signal: rgb(var(--ig-primary-button, 0, 149, 246)) !important;
        --insta-toolbox-signal-ink: #fff !important;
        --insta-toolbox-focus: rgb(var(--ig-primary-button, 0, 149, 246)) !important;
        --insta-toolbox-good: rgb(var(--ig-primary-button, 0, 149, 246)) !important;
        --insta-toolbox-shadow: 0 12px 38px rgba(0, 0, 0, .18) !important;
        font-family: var(--font-family-system, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif) !important;
      }
      .insta-toolbox-panel {
        border-radius: 16px !important;
        backdrop-filter: blur(14px) saturate(1.02) !important;
        -webkit-backdrop-filter: blur(14px) saturate(1.02) !important;
        animation: insta-toolbox-instagram-open 160ms cubic-bezier(.2,.8,.2,1) !important;
      }
      .insta-toolbox-brand-mark {
        border: 1px solid var(--insta-toolbox-line) !important;
        background: var(--insta-toolbox-surface-raised) !important;
        color: var(--insta-toolbox-ink) !important;
        font-size: 12px !important;
      }
      .insta-toolbox-tab, .insta-toolbox-icon-button, .insta-toolbox-settings summary {
        transition: background 140ms ease, color 140ms ease, transform 140ms ease !important;
      }
      .insta-toolbox-tab:hover, .insta-toolbox-icon-button:hover, .insta-toolbox-settings summary:hover { transform: translateY(-1px); }
      .insta-toolbox-tab[aria-selected="true"] {
        box-shadow: none !important;
        background: var(--insta-toolbox-surface-raised) !important;
        color: var(--insta-toolbox-ink) !important;
      }
      .insta-toolbox-tab[aria-selected="true"]::after {
        position: absolute;
        bottom: 4px;
        width: 16px;
        height: 2px;
        border-radius: 999px;
        background: var(--insta-toolbox-signal);
        content: "";
      }
      .insta-toolbox-card, .insta-toolbox-tool-card, .insta-toolbox-next, .insta-toolbox-checker-metric, .insta-toolbox-disclosure {
        border-radius: 12px !important;
      }
      .insta-toolbox-tool-card, .insta-toolbox-button, .insta-toolbox-link-button, .insta-toolbox-file-label, .insta-toolbox-disclosure summary {
        transition: background 140ms ease, border-color 140ms ease, filter 140ms ease, transform 140ms ease !important;
      }
      .insta-toolbox-tool-card:hover { transform: translateY(-1px); background: var(--insta-toolbox-rail) !important; }
      .insta-toolbox-button, .insta-toolbox-link-button, .insta-toolbox-file-label {
        min-height: 44px !important;
        border-color: var(--insta-toolbox-line) !important;
        border-radius: 8px !important;
        background: var(--insta-toolbox-rail) !important;
        color: var(--insta-toolbox-ink) !important;
        font-size: var(--system-14-font-size, 14px) !important;
        line-height: var(--system-14-line-height, 18px) !important;
        font-weight: 600 !important;
      }
      .insta-toolbox-button:hover, .insta-toolbox-link-button:hover, .insta-toolbox-file-label:hover { filter: brightness(.97); }
      .insta-toolbox-button--signal {
        border-color: var(--insta-toolbox-signal) !important;
        background: var(--insta-toolbox-signal) !important;
        color: #fff !important;
      }
      .insta-toolbox-button--danger {
        border-color: var(--insta-toolbox-danger) !important;
        background: var(--insta-toolbox-danger) !important;
        color: #fff !important;
      }
      .insta-toolbox-badge { font-weight: 600 !important; }
      .insta-toolbox-message-row { border-color: var(--insta-toolbox-line) !important; border-radius: 12px !important; background: var(--insta-toolbox-surface-raised) !important; }
      .insta-toolbox-direct-unsend-progress {
        display: grid;
        gap: 6px;
        margin-top: 10px;
        padding: 10px 12px;
        border: 1px solid var(--insta-toolbox-line);
        border-radius: 10px;
        background: var(--insta-toolbox-surface-raised);
      }
      .insta-toolbox-direct-unsend-progress strong { font-size: 13px; }
      .insta-toolbox-direct-unsend-progress span { color: var(--insta-toolbox-muted); font-size: 12px; }
      @keyframes insta-toolbox-instagram-open {
        from { opacity: 0; transform: translateY(6px) scale(.99); }
        to { opacity: 1; transform: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .insta-toolbox-panel, .insta-toolbox-tab, .insta-toolbox-icon-button, .insta-toolbox-tool-card, .insta-toolbox-button, .insta-toolbox-link-button, .insta-toolbox-file-label { animation: none !important; transition: none !important; }
      }
    `;
    runtime.shadow.append(style);

    const brand = runtime.query('.insta-toolbox-brand-mark');
    if (brand) brand.textContent = 'IT';
    const scan = runtime.query('[data-insta-toolbox-action="scan-sent-dms"]');
    if (scan) scan.textContent = 'Check conversation';
    const disclosure = runtime.query('[data-insta-toolbox-role="unsend-disclosure"]');
    if (disclosure) {
      disclosure.hidden = false;
      const summary = disclosure.querySelector('strong');
      if (summary) summary.textContent = 'Conversation plan';
      let progress = disclosure.querySelector('.insta-toolbox-direct-unsend-progress');
      if (!progress) {
        progress = runtime.document.createElement('div');
        progress.className = 'insta-toolbox-direct-unsend-progress';
        progress.hidden = true;
        const title = runtime.document.createElement('strong');
        title.dataset.instaToolboxRole = 'thread-unsend-progress-title';
        const detail = runtime.document.createElement('span');
        detail.dataset.instaToolboxRole = 'thread-unsend-progress-detail';
        progress.append(title, detail);
        disclosure.querySelector('.insta-toolbox-disclosure-body')?.append(progress);
      }
    }
  }

  function runnerState(runtime) {
    return runtime.model.threadUnsend || runner?.snapshot?.() || {
      status: 'idle', processed: 0, failed: 0, retryAttempts: 0, message: 'Ready', canStop: false,
    };
  }

  function bridgeRequest(runtime, message, timeoutMs = DM_WRITE_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ error: 'extension-bridge-timeout' }), timeoutMs);
      Promise.resolve()
        .then(() => runtime.sendBridge(message))
        .then(
          (response) => finish(response && typeof response === 'object'
            ? response
            : { error: 'extension-bridge-empty-response' }),
          (error) => finish({ error: error?.message || 'extension-bridge-request-failed' }),
        );
    });
  }

  function reservationMatchesPlan(response, plan) {
    const reservation = response?.reservation;
    const pacing = response?.pacing;
    const expectedCount = plan.scope === 'all' ? null : plan.limit;
    const expiresAt = Date.parse(String(reservation?.expiresAt || ''));
    const reservedAt = Date.parse(String(reservation?.reservedAt || ''));
    return Boolean(
      !response?.error
      && /^thread-unsend-[A-Za-z0-9_-]{8,256}$/u.test(String(reservation?.id || ''))
      && reservation?.threadId === plan.threadId
      && reservation?.reviewedDigest === plan.reviewedDigest
      && reservation?.scope === plan.scope
      && reservation?.count === expectedCount
      && reservation?.status === 'reserved'
      && reservation?.processed === 0
      && reservation?.failed === 0
      && Number.isFinite(expiresAt)
      && expiresAt === Number(plan.expiresAt)
      && Number.isFinite(reservedAt)
      && reservedAt <= expiresAt
      && Number.isInteger(pacing?.minDelayMs)
      && Number.isInteger(pacing?.maxDelayMs)
      && pacing.minDelayMs >= 1_000
      && pacing.maxDelayMs >= pacing.minDelayMs
      && pacing.maxDelayMs <= 2_000,
    );
  }

  function renderDirect(runtime) {
    applyInstagramDesign(runtime);
    const state = runnerState(runtime);
    const disclosure = runtime.query('[data-insta-toolbox-role="unsend-disclosure"]');
    const badge = runtime.query('[data-insta-toolbox-role="unsend-badge"]');
    const detail = runtime.query('[data-insta-toolbox-role="unsend-detail"]');
    const button = runtime.query('[data-insta-toolbox-action="mass-unsend"]');
    const progress = disclosure?.querySelector('.insta-toolbox-direct-unsend-progress');
    const pendingReservation = pendingReservations.has(runtime.model);
    const runnerActive = ['preparing', 'running', 'waiting', 'stopping'].includes(state.status);
    const active = pendingReservation || runnerActive;
    const readOnlyCheck = state.operation === 'check';
    const preview = currentPreview(runtime);
    const plan = runtime.query('[data-insta-toolbox-role="unsend-plan"]');
    const eligible = runtime.query('[data-insta-toolbox-role="unsend-eligible"]');
    const scope = runtime.query('[data-insta-toolbox-role="unsend-scope"]')?.value || 'all';
    const countField = runtime.query('[data-insta-toolbox-role="unsend-count"]')?.closest('.insta-toolbox-field');
    if (disclosure) disclosure.hidden = false;
    if (plan) plan.hidden = false;
    if (countField) countField.hidden = scope === 'all';
    const detected = Number(preview?.detectedCount ?? preview?.eligibleCount) || 0;
    if (eligible) eligible.textContent = preview
      ? detected > 0
        ? `At least ${detected} sent message${detected === 1 ? '' : 's'} detected`
        : 'No sent messages found'
      : 'Check conversation is optional and read-only';
    if (badge) {
      badge.textContent = pendingReservation
        ? 'preparing'
        : active
        ? readOnlyCheck ? 'checking' : `${state.processed} unsent`
        : state.status === 'completed'
          ? 'complete'
          : preview
            ? 'checked'
            : 'ready';
      badge.dataset.tone = state.status === 'error'
        ? 'danger'
        : active ? 'warning' : state.status === 'completed' ? 'good' : 'neutral';
    }
    if (detail) {
      detail.textContent = pendingReservation
        ? 'Preparing this conversation…'
        : active || ['completed', 'stopped', 'error'].includes(state.status)
        ? state.message
        : preview
          ? `Read-only estimate for this conversation. Instagram may load more while Unsend runs.`
          : 'Confirm the open conversation to begin.';
    }
    if (button) {
      button.textContent = pendingReservation
        ? 'Stop unsending'
        : active
        ? readOnlyCheck ? 'Stop check' : 'Stop unsending'
        : 'Unsend DMs';
      button.disabled = active
        ? !state.canStop
        : !activeConversationId();
      if (pendingReservation) button.disabled = false;
    }
    if (progress) {
      progress.hidden = !active && !['completed', 'stopped', 'error'].includes(state.status);
      const title = progress.querySelector('[data-insta-toolbox-role="thread-unsend-progress-title"]');
      const copy = progress.querySelector('[data-insta-toolbox-role="thread-unsend-progress-detail"]');
      if (title) title.textContent = pendingReservation
        ? 'Preparing conversation'
        : active
        ? readOnlyCheck ? 'Checking conversation' : 'Working in this conversation'
        : readOnlyCheck ? 'Conversation check' : 'Last run';
      if (copy) copy.textContent = readOnlyCheck
        ? 'Read-only check · nothing changed'
        : `${state.processed} unsent${state.retryAttempts ? ` · ${state.retryAttempts} retr${state.retryAttempts === 1 ? 'y' : 'ies'}` : ''}`;
    }
    runtime.setText('message-identity-detail', 'Bulk runs touch only rows Instagram marks as yours. Imported jobs also require an exact thread and message match.');
  }

  function ensureRunnerSubscription(runtime) {
    if (!runner || subscriptions.has(runtime.model)) return;
    const unsubscribe = runner.subscribe((state) => {
      runtime.model.threadUnsend = state;
      renderDirect(runtime);
      if (['preparing', 'running', 'waiting', 'stopping', 'completed', 'stopped', 'error'].includes(state.status)) {
        runtime.status(state.message, state.status === 'error' ? 'error' : state.status === 'completed' ? 'good' : 'neutral');
      }
    });
    subscriptions.set(runtime.model, unsubscribe);
  }

  function render(runtime) {
    applyInstagramDesign(runtime);
    ensureRunnerSubscription(runtime);
    const { document, downloads, model, query, setText } = runtime;
    const list = query('[data-insta-toolbox-role="message-list"]');
    if (!list) return;
    list.replaceChildren();
    const result = model.messages;
    const conversationId = activeConversationId();
    const conversationReady = Boolean(conversationId);
    const evidenceMatches = conversationReady
      && String(result?.conversationId || '') === conversationId;
    const fragments = evidenceMatches ? (result.fragments || []) : [];
    const evidence = query('[data-insta-toolbox-role="message-evidence"]');
    if (evidence) evidence.hidden = !evidenceMatches || !fragments.length;
    list.hidden = !evidenceMatches || !fragments.length;
    setText('message-count', String(fragments.length));
    setText('message-detail', evidenceMatches
      ? fragments.length
        ? `${shared.safeText(result.conversationLabel, 'Open conversation')} · ${shared.safeText(result.reason, 'read only')}`
        : 'No visible messages found'
      : '');

    const state = query('[data-insta-toolbox-role="message-state"]');
    if (state) state.dataset.tone = conversationReady ? 'good' : 'neutral';
    setText('message-state-title', conversationReady ? 'Conversation ready' : 'Open a conversation');
    setText('message-state-detail', conversationReady
      ? 'Unsend DMs asks once, then works through messages sent by this account.'
      : 'Choose a conversation before using message tools.');

    for (const fragment of fragments) {
      const row = document.createElement('li');
      row.className = 'insta-toolbox-message-row';
      row.dataset.ownership = 'unknown';
      const text = document.createElement('div');
      text.textContent = fragment.text;
      const meta = document.createElement('div');
      meta.className = 'insta-toolbox-message-meta';
      meta.textContent = `Visible fragment ${Number(fragment.index) + 1}`;
      row.append(text, meta);
      list.append(row);
    }
    const download = query('[data-insta-toolbox-role="message-download"]');
    if (evidenceMatches && fragments.length) {
      downloads.update('messages', download, {
        filename: `insta-toolbox-visible-message-evidence-${Date.now()}.json`,
        payload: {
          schemaVersion: 1,
          kind: 'insta-toolbox-visible-message-evidence',
          ...result,
          note: 'Read-only visible DOM evidence.',
        },
      });
    } else {
      downloads.clear('messages', download);
    }
    renderDirect(runtime);
  }

  async function inspect(runtime) {
    runtime.model.messages = runtime.inspector.inspectVisibleMessages();
    render(runtime);
    const count = runtime.model.messages.fragments.length;
    runtime.status(count
      ? `Read ${count} visible text fragment${count === 1 ? '' : 's'} without opening a menu.`
      : 'No visible message text found.', count ? 'good' : 'neutral');
  }

  async function scanSent(runtime) {
    if (!runner) {
      runtime.status('Reload Instagram to load the current message runner.', 'error');
      return null;
    }
    const result = await runner.inspectAll();
    runtime.model.dmThreadPreview = result.ready ? result : null;
    renderDirect(runtime);
    const detected = Number(result.detectedCount ?? result.eligibleCount) || 0;
    runtime.status(result.ready
      ? detected > 0
        ? `Detected at least ${detected} sent message${detected === 1 ? '' : 's'}. No menus opened.`
        : 'No sent messages found. No menus opened.'
      : result.reason, result.ready ? 'good' : 'error');
    return result;
  }

  async function massUnsend(runtime) {
    if (!runner) throw new Error('Reload Instagram to load the current message runner.');
    const pendingReservation = pendingReservations.get(runtime.model);
    if (pendingReservation) {
      pendingReservation.cancelled = true;
      renderDirect(runtime);
      runtime.status('Stopping before Unsend starts…', 'neutral');
      return;
    }
    const current = runner.snapshot();
    if (current.canStop || ['preparing', 'running', 'waiting', 'stopping'].includes(current.status)) {
      runner.stop();
      return;
    }
    if (pendingReviews.has(runtime.model)) return;
    pendingReviews.add(runtime.model);
    let inspection;
    try {
      inspection = runner.inspect();
    } catch (error) {
      pendingReviews.delete(runtime.model);
      throw error;
    }
    if (!inspection.ready) {
      pendingReviews.delete(runtime.model);
      throw new Error(inspection.reason);
    }
    const scope = runtime.query('[data-insta-toolbox-role="unsend-scope"]')?.value || 'all';
    const requested = Math.floor(Number(runtime.query('[data-insta-toolbox-role="unsend-count"]')?.value) || 1);
    const limit = scope === 'all' ? null : Math.max(1, requested);
    let plan;
    try {
      plan = runner.createPlan({
        threadId: inspection.threadId,
        scope,
        limit,
        detectedCount: Number(currentPreview(runtime)?.detectedCount ?? currentPreview(runtime)?.eligibleCount) || null,
        expiresAt: Date.now() + DM_PLAN_TTL_MS,
      });
    } catch (error) {
      pendingReviews.delete(runtime.model);
      throw error;
    }
    if (!plan) {
      pendingReviews.delete(runtime.model);
      throw new Error('The Unsend plan could not be created. Keep this conversation open and try again.');
    }
    const scopeLabel = scope === 'all'
      ? 'every message you sent'
      : `the ${scope} ${limit} message${limit === 1 ? '' : 's'} you sent`;
    let confirmation;
    try {
      confirmation = await runtime.confirmAction({
        title: 'Unsend DMs?',
        message: `Permanently unsend ${scopeLabel} in this conversation?`,
        detail: 'This cannot be undone. Stop stays available while it runs.',
        confirmLabel: scope === 'all' ? 'Unsend all my messages' : `Unsend ${limit} message${limit === 1 ? '' : 's'}`,
        facts: [
          { label: 'Action', value: 'Permanently unsend messages' },
          { label: 'Conversation', value: `Thread ${plan.threadId}` },
          { label: 'Scope', value: scope === 'all' ? 'All messages you sent' : `${scope} ${limit}` },
        ],
        binding: {
          action: 'unsend',
          expiresAt: plan.expiresAt,
          limit: plan.limit,
          reviewedDigest: plan.reviewedDigest,
          scope: plan.scope,
          threadId: plan.threadId,
        },
      });
    } catch (error) {
      pendingReviews.delete(runtime.model);
      throw error;
    }
    if (!confirmation) {
      pendingReviews.delete(runtime.model);
      runtime.status('Canceled. Nothing was removed.', 'neutral');
      return;
    }
    let confirmedInspection;
    try {
      confirmedInspection = runner.inspect();
    } catch (error) {
      pendingReviews.delete(runtime.model);
      throw error;
    }
    const confirmedScope = runtime.query('[data-insta-toolbox-role="unsend-scope"]')?.value || 'all';
    const confirmedRequested = Math.floor(Number(runtime.query('[data-insta-toolbox-role="unsend-count"]')?.value) || 1);
    const confirmedLimit = confirmedScope === 'all' ? null : Math.max(1, confirmedRequested);
    if (
      !confirmedInspection?.ready
      || confirmedInspection.threadId !== plan.threadId
      || confirmation.action !== 'unsend'
      || confirmation.threadId !== plan.threadId
      || confirmation.scope !== plan.scope
      || confirmation.limit !== plan.limit
      || confirmation.reviewedDigest !== plan.reviewedDigest
      || Number(confirmation.expiresAt) !== plan.expiresAt
      || plan.expiresAt <= Date.now()
      || confirmedScope !== plan.scope
      || confirmedLimit !== plan.limit
    ) {
      pendingReviews.delete(runtime.model);
      runtime.status('The conversation or Unsend scope changed after review. Nothing was removed.', 'error');
      return;
    }
    pendingReviews.delete(runtime.model);
    const reservationState = { cancelled: false };
    pendingReservations.set(runtime.model, reservationState);
    renderDirect(runtime);
    runtime.status('Preparing this conversation…', 'neutral');
    let reservation;
    try {
      reservation = await bridgeRequest(runtime, {
        kind: 'insta-toolbox-reserve-thread-unsend',
        plan,
      });
    } finally {
      pendingReservations.delete(runtime.model);
    }
    if (reservationState.cancelled) {
      if (reservationMatchesPlan(reservation, plan)) {
        await bridgeRequest(runtime, {
          kind: 'insta-toolbox-finalize-thread-unsend',
          reservationId: reservation.reservation?.id,
          reviewedDigest: plan.reviewedDigest,
          threadId: plan.threadId,
          processed: 0,
          failed: 0,
          status: 'stopped',
        });
      }
      renderDirect(runtime);
      runtime.status('Stopped before Unsend began. Nothing was removed.', 'good');
      return;
    }
    if (!reservationMatchesPlan(reservation, plan)) {
      renderDirect(runtime);
      runtime.status('Could not reserve this plan. Check the conversation again.', 'error');
      return;
    }
    runtime.model.dmThreadPreview = null;
    renderDirect(runtime);
    let outcome;
    let runError = null;
    try {
      outcome = await runner.start({
        plan,
        minDelayMs: reservation.pacing?.minDelayMs,
        maxDelayMs: reservation.pacing?.maxDelayMs,
        onVerifiedRemoval: async (progress) => {
          const checkpoint = await bridgeRequest(runtime, {
            kind: 'insta-toolbox-checkpoint-thread-unsend',
            plan,
            reservationId: reservation.reservation?.id,
            reviewedDigest: plan.reviewedDigest,
            threadId: plan.threadId,
            processed: progress.processed,
            failed: progress.failed,
          });
          if (checkpoint?.error) {
            throw new Error('A verified removal could not be saved to the local ledger. The run stopped.');
          }
        },
      });
    } catch (error) {
      runError = error;
      outcome = { processed: 0, failed: 1, status: 'error' };
    }
    const finalized = await bridgeRequest(runtime, {
      kind: 'insta-toolbox-finalize-thread-unsend',
      reservationId: reservation.reservation?.id,
      reviewedDigest: plan.reviewedDigest,
      threadId: plan.threadId,
      processed: Math.max(0, Math.floor(Number(outcome?.processed) || 0)),
      failed: Math.max(0, Math.floor(Number(outcome?.failed) || 0)),
      status: outcome?.status,
    });
    if (finalized?.error) runtime.status('Run finished, but its local ledger could not be updated.', 'error');
    if (runError) throw runError;
  }

  function cancelPending(runtime) {
    const pending = pendingReservations.get(runtime.model);
    if (!pending) return false;
    pending.cancelled = true;
    renderDirect(runtime);
    return true;
  }

  shared.install('messagesView', {
    bridgeRequest,
    cancelPending,
    inspect,
    inspectIntent,
    massUnsend,
    reservationMatchesPlan,
    observationMatches,
    render,
    renderSentScan: renderDirect,
    scanSent,
  });
})();
