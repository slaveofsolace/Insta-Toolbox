// ==UserScript==
// @name         Insta Toolbox
// @namespace    https://github.com/slaveofsolace/Insta-Toolbox
// @version      4.1.0
// @description  Mutual Checker, Presence, and DM Unsend on Instagram.
// @author       @slaveofsolace
// @homepageURL  https://github.com/slaveofsolace/Insta-Toolbox
// @supportURL   https://github.com/slaveofsolace/Insta-Toolbox/issues
// @downloadURL  https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js
// @updateURL    https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'%3E%3Crect width='1024' height='1024' fill='%23101114'/%3E%3Crect x='160' y='224' width='192' height='128' fill='%23b83d67'/%3E%3Crect x='224' y='352' width='64' height='352' fill='%23b83d67'/%3E%3Crect x='160' y='704' width='192' height='96' fill='%23b83d67'/%3E%3Crect x='416' y='224' width='448' height='128' fill='%23f4f1e8'/%3E%3Crect x='576' y='352' width='128' height='448' fill='%23f4f1e8'/%3E%3C/svg%3E
// @license      MIT
// @match        https://www.instagram.com/*
// @sandbox      DOM
// @grant        GM_getTab
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_removeValueChangeListener
// @grant        GM_saveTab
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==
// ---------------------------------------------------------------------------
// Generated file. Do not edit.
//
// Built by scripts/build-userscript.mjs from:
//   extension/action-confirmation.js     <- shared destructive-action dialog
//   extension/action-labels.js           <- labels and thread-wide DM runner
//   extension/content-instagram.js       <- shared exact-target engine
//   userscripts/src/toolbox-shell.js     <- userscript UI and batch runner
//
// Edit those sources and run: pnpm run build:userscript
// ---------------------------------------------------------------------------
/*
 * MIT License
 *
 * Copyright (c) 2026 slaveofsolace (https://github.com/slaveofsolace)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(() => {
  'use strict';
  const rootId = 'insta-toolbox-userscript-root';
  const extensionRootId = 'insta-toolbox-sidecar-root';
  const claimId = 'insta-toolbox-userscript-claim';
  if (!document.documentElement
    || document.getElementById(extensionRootId)
    || document.getElementById(rootId)
    || document.getElementById(claimId)) return;

  const bootstrapClaim = document.createElement('div');
  bootstrapClaim.id = claimId;
  bootstrapClaim.hidden = true;
  bootstrapClaim.setAttribute('aria-hidden', 'true');
  document.documentElement.append(bootstrapClaim);
(() => {
  'use strict';

  // Single source of visual truth for the extension overlay and the
  // Tampermonkey toolbox. See docs/DESIGN_SYSTEM.md.
  //
  // Both surfaces previously carried their own palette — 104 colour literals
  // between them and no shared name — so a fix in one never reached the other.
  // Everything visual now resolves to a role defined here.
  //
  // Instagram publishes its palette as CSS custom properties on the document.
  // Each role reads Instagram's value first and falls back to a fixed one, so
  // the panel follows the page's light and dark treatment without detecting it,
  // and stays readable if Instagram renames a variable. This is visual
  // compatibility only; the project is independent of Instagram and Meta.

  const SPACE = ['0', '4px', '8px', '12px', '16px', '20px', '24px'];

  function palette() {
    return {
      '--insta-toolbox-bg': 'rgb(var(--ig-primary-background, 255 255 255))',
      '--insta-toolbox-bg-raised': 'rgb(var(--ig-elevated-background, 255 255 255))',
      '--insta-toolbox-bg-sunken': 'rgb(var(--ig-secondary-background, 250 250 250))',
      '--insta-toolbox-text': 'rgb(var(--ig-primary-text, 0 0 0))',
      '--insta-toolbox-text-muted': 'rgb(var(--ig-secondary-text, 115 115 115))',
      '--insta-toolbox-line': 'rgb(var(--ig-separator, 219 219 219))',
      '--insta-toolbox-accent': '#b83d67',
      '--insta-toolbox-accent-violet': '#7657d6',
      '--insta-toolbox-accent-blue': '#1f6eb3',
      '--insta-toolbox-on-accent': '#fff',
      '--insta-toolbox-success': 'rgb(var(--ig-success, 0 148 84))',
      '--insta-toolbox-warning': '#b26a00',
      '--insta-toolbox-danger': 'rgb(var(--ig-error-or-destructive, 237 73 86))',
      // Deliberately not the danger colour: an uncertain outcome may well have
      // succeeded, and colouring it as a failure would assert what we do not know.
      '--insta-toolbox-uncertain': '#7a5cc4',
      '--insta-toolbox-focus': '#b83d67',
    };
  }

  function scale(density) {
    const tight = density === 'compact';
    return {
      '--insta-toolbox-space-1': SPACE[1],
      '--insta-toolbox-space-2': SPACE[2],
      '--insta-toolbox-space-3': SPACE[3],
      '--insta-toolbox-space-4': SPACE[4],
      '--insta-toolbox-space-5': SPACE[5],
      '--insta-toolbox-space-6': SPACE[6],
      // Compact trims vertical rhythm only. Hit targets and font sizes are
      // never reduced, so a denser panel stays as usable as a roomy one.
      '--insta-toolbox-pad-y': tight ? SPACE[2] : SPACE[3],
      '--insta-toolbox-pad-x': tight ? SPACE[3] : SPACE[4],
      '--insta-toolbox-gap': tight ? SPACE[2] : SPACE[3],
      '--insta-toolbox-radius-sm': '6px',
      '--insta-toolbox-radius-md': '8px',
      '--insta-toolbox-radius-lg': '16px',
      '--insta-toolbox-border': '1px',
      '--insta-toolbox-target': '44px',
      '--insta-toolbox-text-lg': '15px',
      '--insta-toolbox-text-md': '14px',
      '--insta-toolbox-text-sm': '13px',
      '--insta-toolbox-text-xs': '12px',
      '--insta-toolbox-leading-lg': '20px',
      '--insta-toolbox-leading-md': '20px',
      '--insta-toolbox-leading-sm': '18px',
      '--insta-toolbox-leading-xs': '16px',
      '--insta-toolbox-weight-normal': '400',
      '--insta-toolbox-weight-strong': '600',
      '--insta-toolbox-font': 'var(--ig-font-family, "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif)',
      '--insta-toolbox-shadow-panel': '0 12px 40px rgba(0, 0, 0, .18)',
      '--insta-toolbox-shadow-popover': '0 8px 24px rgba(0, 0, 0, .16)',
      '--insta-toolbox-shadow-none': 'none',
      '--insta-toolbox-motion-fast': '120ms',
      '--insta-toolbox-motion-base': '180ms',
      '--insta-toolbox-motion-slow': '240ms',
      '--insta-toolbox-ease': 'cubic-bezier(.2, .7, .3, 1)',
    };
  }

  function declarations(density) {
    return Object.entries({ ...palette(), ...scale(density) })
      .map(([name, value]) => `${name}: ${value};`)
      .join(' ');
  }

  // Shared primitives. Component styles live with their surface; anything that
  // decides colour, focus, target size, or motion lives here.
  function primitives() {
    return `
    .insta-toolbox-focusable:focus { outline: none; }
    .insta-toolbox-focusable:focus-visible {
      outline: 2px solid var(--insta-toolbox-focus);
      outline-offset: 2px;
    }
    /* A control may look small but must never be small to hit. */
    .insta-toolbox-target { min-width: var(--insta-toolbox-target); min-height: var(--insta-toolbox-target); }
    .insta-toolbox-state-locked { color: var(--insta-toolbox-text-muted); }
    .insta-toolbox-state-armed { border-color: var(--insta-toolbox-danger); color: var(--insta-toolbox-danger); }
    .insta-toolbox-state-running { border-color: var(--insta-toolbox-warning); color: var(--insta-toolbox-warning); }
    .insta-toolbox-state-paused { border-color: var(--insta-toolbox-line); color: var(--insta-toolbox-text-muted); }
    .insta-toolbox-state-stopped { border-color: var(--insta-toolbox-danger); color: var(--insta-toolbox-danger); }
    .insta-toolbox-state-uncertain { border-color: var(--insta-toolbox-uncertain); color: var(--insta-toolbox-uncertain); }
    .insta-toolbox-state-success { color: var(--insta-toolbox-success); }
    .insta-toolbox-state-selected { color: var(--insta-toolbox-accent); }
    [disabled], [aria-disabled="true"] { opacity: .45; cursor: not-allowed; }

    @media (prefers-reduced-motion: reduce) {
      /* State still changes; it simply arrives without travel. */
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    }

    @media (forced-colors: active) {
      /* Structure has to survive without colour, so every edge becomes real. */
      .insta-toolbox-surface, .insta-toolbox-raised, .insta-toolbox-sunken { background: Canvas; color: CanvasText; }
      .insta-toolbox-surface, .insta-toolbox-raised, .insta-toolbox-sunken, .insta-toolbox-card { border: 1px solid CanvasText; }
      .insta-toolbox-focusable:focus-visible { outline-color: Highlight; }
      .insta-toolbox-state-selected { color: Highlight; }
    }`;
  }

  function themeOverrides(scope) {
    const selector = (theme) => scope === ':host'
      ? `:host([data-theme-preference="${theme}"])`
      : `${scope}[data-theme-preference="${theme}"]`;
    return `${selector('light')} { --insta-toolbox-bg:#fff; --insta-toolbox-bg-raised:#fff; --insta-toolbox-bg-sunken:#fafafa; --insta-toolbox-text:#171717; --insta-toolbox-text-muted:#666; --insta-toolbox-line:#dbdbdb; color-scheme:light; }
${selector('dark')} { --insta-toolbox-bg:#101114; --insta-toolbox-bg-raised:#1e2023; --insta-toolbox-bg-sunken:#17181a; --insta-toolbox-text:#f3f3f3; --insta-toolbox-text-muted:#b3b3b3; --insta-toolbox-line:#36383c; color-scheme:dark; }`;
  }

  const api = Object.freeze({
    css(options = {}) {
      const density = options.density === 'compact' ? 'compact' : 'comfortable';
      const scope = options.scope || ':host';
      return `${scope} { ${declarations(density)} }\n${themeOverrides(scope)}\n${primitives()}`;
    },
    declarations,
    palette,
    scale,
    // Exposed so tests can assert the contract rather than re-reading strings.
    roles: Object.freeze(Object.keys(palette())),
    steps: Object.freeze(Object.keys(scale('comfortable'))),
  });

  Object.defineProperty(globalThis, 'InstaToolboxTokens', {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();

(() => {
  'use strict';

  const STORAGE_KEY = 'instaToolboxCleanupPreferencesV1';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const choice = (value, values, fallback) => values.includes(value) ? value : fallback;
  const boolean = (source, key, fallback) => own(source, key) && typeof source[key] === 'boolean' ? source[key] : fallback;

  function defaults() {
    return {
      schemaVersion: 1, speed: 'standard', messageScope: 'all', messageLimit: 1,
      removeOwnReactions: false, showSummary: true, execution: 'foreground',
      workerCount: 1, scheduling: 'serial', notifications: false,
    };
  }

  function normalize(value) {
    const source = record(value);
    const limit = Number(source.messageLimit);
    return {
      schemaVersion: 1,
      speed: 'standard',
      messageScope: choice(source.messageScope, ['all', 'newest', 'oldest'], 'all'),
      messageLimit: Number.isSafeInteger(limit) && limit >= 1 && limit <= 250 ? limit : 1,
      removeOwnReactions: boolean(source, 'removeOwnReactions', false),
      showSummary: boolean(source, 'showSummary', true),
      execution: choice(source.execution, ['foreground', 'background'], 'foreground'),
      workerCount: Number.isSafeInteger(Number(source.workerCount))
        && Number(source.workerCount) >= 1 && Number(source.workerCount) <= 5
        ? Number(source.workerCount) : 1,
      scheduling: 'serial',
      notifications: boolean(source, 'notifications', false),
    };
  }

  function normalizeAppearance(value, fallback = {}) {
    const source = record(value);
    const opacity = Number(source.opacity);
    return {
      theme: choice(source.theme, ['auto', 'light', 'dark'], fallback.theme || 'auto'),
      density: choice(source.density, ['comfortable', 'compact'], fallback.density || 'comfortable'),
      accent: choice(source.accent, ['rose', 'violet', 'blue'], fallback.accent || 'rose'),
      blur: choice(source.blur, ['none', 'soft', 'strong'], fallback.blur || 'soft'),
      launcherSize: choice(source.launcherSize, ['standard', 'large'], fallback.launcherSize || 'standard'),
      opacity: source.opacity != null && source.opacity !== '' && Number.isFinite(opacity)
        ? Math.round(Math.min(1, Math.max(.55, opacity)) * 100) / 100
        : fallback.opacity ?? .88,
    };
  }

  function capabilities(surface) {
    const inPage = ['extension', 'userscript'].includes(surface);
    const userscript = surface === 'userscript';
    return Object.freeze({
      singleConversation: inPage,
      fast: false,
      reactions: userscript,
      background: userscript,
      managedWorkers: userscript,
      notifications: false,
      reasons: Object.freeze({
        fast: 'Unsend uses one pacing mode.',
        reactions: userscript ? null : 'Own-reaction removal is available in the Instagram userscript.',
        background: userscript ? null : (inPage
          ? 'Background execution is available in the Instagram userscript.'
          : 'This app does not control an authenticated Instagram tab.'),
        managedWorkers: userscript ? null : 'Managed tabs are available in the Instagram userscript.',
        notifications: 'Completion notifications are not connected on this surface.',
      }),
    });
  }

  // Saved defaults are preferences, never permission to dispatch an action.
  function effective(value, surface) {
    const saved = normalize(value);
    const support = capabilities(surface);
    return {
      ...saved,
      speed: 'standard',
      removeOwnReactions: support.reactions && saved.removeOwnReactions,
      execution: support.background ? saved.execution : 'foreground',
      workerCount: support.managedWorkers ? saved.workerCount : 1,
      notifications: support.notifications && saved.notifications,
    };
  }

  globalThis.InstaToolboxCleanupSettings = Object.freeze({
    STORAGE_KEY, defaults, normalize, normalizeAppearance, capabilities, effective,
  });
})();

(() => {
  'use strict';

  const namespace = 'InstaToolboxActionConfirmation';
  if (globalThis[namespace]) return;

  function immutableCopy(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
    if (value && typeof value === 'object') {
      return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
      ));
    }
    return value;
  }

  function cleanText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return (text || fallback).slice(0, 1_000);
  }

  function createController({ root, attribute, status, unavailableTone = 'error' }) {
    if (!root?.querySelector || !attribute) throw new TypeError('A confirmation root and role attribute are required.');

    const query = (role) => root.querySelector(`[${attribute}="${role}"]`);
    const dialog = query('action-confirmation');
    const cancelButton = query('confirm-cancel');
    const confirmButton = query('confirm-accept');
    let pending = null;

    function renderList(role, values) {
      const list = query(role);
      if (!list) return;
      const items = (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value))
        .filter(Boolean)
        .slice(0, 250);
      list.replaceChildren(...items.map((value) => {
        const item = root.ownerDocument.createElement('li');
        item.textContent = value;
        return item;
      }));
      list.hidden = items.length === 0;
    }

    function renderFacts(values) {
      const list = query('confirm-facts');
      if (!list) return;
      const facts = (Array.isArray(values) ? values : [])
        .map((entry) => ({
          label: cleanText(entry?.label),
          value: cleanText(entry?.value),
        }))
        .filter((entry) => entry.label && entry.value)
        .slice(0, 12);
      const nodes = [];
      for (const fact of facts) {
        const term = root.ownerDocument.createElement('dt');
        const description = root.ownerDocument.createElement('dd');
        term.textContent = fact.label;
        description.textContent = fact.value;
        nodes.push(term, description);
      }
      list.replaceChildren(...nodes);
      list.hidden = facts.length === 0;
    }

    function settle(confirmed) {
      const current = pending;
      if (!current) return false;
      pending = null;
      if (dialog?.open) dialog.close();
      if (current.restoreFocus?.isConnected) current.restoreFocus.focus();
      const expired = Number(current.binding?.expiresAt) > 0
        && Number(current.binding.expiresAt) <= Date.now();
      if (confirmed === true && expired) {
        status?.('This review expired. Review the action again. Nothing was changed.', unavailableTone);
      }
      current.resolve(confirmed === true && !expired ? current.binding : null);
      return true;
    }

    function confirm(request = {}) {
      if (pending) return Promise.resolve(null);
      if (!dialog?.showModal || !cancelButton || !confirmButton) {
        status?.('The confirmation panel is unavailable. Nothing was changed.', unavailableTone);
        return Promise.resolve(null);
      }

      const title = query('confirm-title');
      const message = query('confirm-message');
      const detail = query('confirm-detail');
      if (title) title.textContent = cleanText(request.title, 'Confirm action');
      if (message) message.textContent = cleanText(request.message, 'Review this action.');
      if (detail) detail.textContent = cleanText(request.detail, 'This cannot be undone.');
      confirmButton.textContent = cleanText(request.confirmLabel, 'Confirm');
      renderFacts(request.facts);
      renderList('confirm-items', request.items);

      const binding = immutableCopy(request.binding || {});
      return new Promise((resolve) => {
        pending = {
          binding,
          resolve,
          restoreFocus: root.activeElement || root.ownerDocument.activeElement,
        };
        try {
          dialog.showModal();
          cancelButton.focus();
        } catch {
          pending = null;
          resolve(null);
          status?.('The confirmation panel could not open. Nothing was changed.', unavailableTone);
        }
      });
    }

    function onCancel(event) {
      event.preventDefault();
      settle(false);
    }

    function onAccept(event) {
      if (event?.isTrusted !== true) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
      }
      settle(true);
    }

    function onClose() {
      // A previous close event can arrive after the dialog has been reopened.
      if (pending && !dialog.open) settle(false);
    }

    dialog?.addEventListener('cancel', onCancel);
    dialog?.addEventListener('close', onClose);
    confirmButton?.addEventListener('click', onAccept);

    return Object.freeze({
      cancel: () => settle(false),
      confirm,
      destroy() {
        settle(false);
        dialog?.removeEventListener('cancel', onCancel);
        dialog?.removeEventListener('close', onClose);
        confirmButton?.removeEventListener('click', onAccept);
      },
      isPending: () => Boolean(pending),
    });
  }

  Object.defineProperty(globalThis, namespace, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ createController }),
    writable: false,
  });
})();

(() => {
  'use strict';

  if (globalThis.InstaToolboxOwnReactions) return;

  const emojiOnly = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D)+$/u;
  const text = (node) => String(node?.textContent || '').trim().replace(/\s+/g, ' ');
  const visible = (node) => Boolean(node && node.isConnected !== false
    && !node.closest?.('[hidden], [aria-hidden="true"]')
    && (!node.getClientRects || node.getClientRects().length));
  const uncertain = (message) => Object.assign(new Error(message), { code: 'REACTION_OUTCOME_UNCERTAIN' });
  const badgeEmoji = (node) => {
    const value = text(node).replace(/\s*[0-9]{1,6}$/, '').trim();
    return emojiOnly.test(value) ? value : null;
  };
  const badgeCount = (node) => Number(text(node).match(/([0-9]{1,6})$/)?.[1] || 1);
  const plans = new WeakSet();
  const consumed = new WeakSet();
  const unresolvedAttempts = new Set();
  function fingerprint(value) {
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (const character of value) {
      const code = character.codePointAt(0);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${value.length}:${first >>> 0}:${second >>> 0}`;
  }
  function createPlan({ threadId, accountUsername, expiresAt, limit = null } = {}) {
    if (!/^[0-9]{1,128}$/.test(threadId || '') || !/^[a-z0-9._]{1,30}$/.test(accountUsername || '')
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 20 * 60_000
      || (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5_000))) return null;
    // A plan is an isolated-runtime object, not restorable/importable authority.
    const plan = Object.freeze({ version: 1, threadId, accountUsername, expiresAt, limit });
    plans.add(plan); return plan;
  }
  function validatePlan(plan, threadId, accountUsername) {
    return plans.has(plan) && !consumed.has(plan) && plan.threadId === threadId
      && plan.accountUsername === accountUsername && plan.expiresAt > Date.now();
  }
  function consumePlan(plan, threadId, accountUsername) {
    if (!validatePlan(plan, threadId, accountUsername)) throw new Error('reaction-review-required');
    consumed.add(plan);
  }

  function badges(row) {
    return [...row?.querySelectorAll?.('[role="button"]') || []].filter((node) => (
      visible(node) && node.getAttribute('tabindex') === '0'
      && !node.getAttribute('aria-label') && !node.getAttribute('aria-haspopup')
      && !node.closest?.('[aria-label="Message actions"]')
      && node.querySelector?.('[role="none"]') && badgeEmoji(node)
    ));
  }

  function messageSignature(row) {
    const reactions = badges(row);
    const relevant = (node) => !node.closest?.('[aria-label="Message actions"]')
      && !reactions.some((badge) => badge === node || badge.contains(node));
    const ids = ['data-message-id', 'data-item-id'].map((name) => row.getAttribute?.(name) || '');
    const content = [...row.querySelectorAll('[dir="auto"], img, video, audio, a[href]')]
      .filter(relevant).filter((node) => !node.querySelector?.('[dir="auto"]'))
      .map((node) => [node.tagName, node.getAttribute?.('src') || '',
        node.getAttribute?.('href') || '', text(node)]);
    return JSON.stringify([ids, content]);
  }

  function messageIdentity(row) {
    for (const attribute of ['data-message-id', 'data-item-id']) {
      const value = row.getAttribute?.(attribute);
      if (value) return `${attribute}:${value}`;
    }
    return null;
  }

  function create({ document = globalThis.document, inspectContext, assertAuthorized,
    now = Date.now, timeoutMs = 3_000, stableMs = 200 } = {}) {
    if (!document || typeof inspectContext !== 'function' || typeof assertAuthorized !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000
      || !Number.isFinite(stableMs) || stableMs < 0 || stableMs > timeoutMs) {
      throw new Error('reaction-adapter-invalid');
    }
    const openDialogs = () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .filter((dialog) => visible(dialog) && [...dialog.querySelectorAll('h1, h2, h3, [role="heading"]')]
        .some((heading) => text(heading) === 'Reactions'));
    const emoji = (row) => [...row.querySelectorAll('span')].map(text).filter((value) => emojiOnly.test(value));
    const busy = (node) => node?.getAttribute?.('aria-busy') === 'true'
      || [...node?.querySelectorAll?.('[aria-busy="true"], [role="progressbar"], [aria-label="Loading"]') || []]
        .some(visible);
    function reactionRows(dialog, expectedEmoji = null) {
      return [...dialog.querySelectorAll('[role="button"]')].filter((row) => visible(row)
        && row.getAttribute('tabindex') === '0'
        && (expectedEmoji ? emoji(row).includes(expectedEmoji) : emoji(row).length));
    }
    function ownRows(dialog, expectedEmoji) {
      const isColumn = (node) => {
        const style = document.defaultView?.getComputedStyle?.(node);
        return node?.tagName === 'DIV' && ['flex', 'inline-flex'].includes(style?.display)
          && style.flexDirection === 'column';
      };
      return reactionRows(dialog, expectedEmoji).filter((row) => (
        [...row.querySelectorAll('span')].some((hint) => {
          if (text(hint) !== 'Select to remove' || hint.children?.length) return false;
          const secondary = hint.parentElement, column = secondary?.parentElement;
          const [name, detail] = [...column?.children || []];
          // Native ownership is the dedicated subtitle under a separate name,
          // not a participant's display name containing the same words.
          return isColumn(secondary) && secondary.children.length === 1
            && secondary.children[0] === hint && isColumn(column)
            && column.children.length === 2 && detail === secondary
            && name?.tagName === 'SPAN' && Boolean(text(name));
        })
      ));
    }
    function otherRows(dialog, expectedEmoji) {
      const mine = new Set(ownRows(dialog, expectedEmoji));
      return reactionRows(dialog).filter((row) => !mine.has(row)).map(text).sort();
    }
    function close(dialog, threadId, accountId, signal, dispatched = false) {
      guard(threadId, accountId, signal, dispatched);
      const controls = [...dialog.querySelectorAll('button, [role="button"]')]
        .filter((node) => visible(node) && (node.getAttribute('aria-label') || text(node)) === 'Close');
      if (controls.length !== 1) throw new Error('reaction-close-unavailable');
      controls[0].click();
    }
    function guard(threadId, accountId, signal, dispatched = false) {
      const context = inspectContext();
      if (context?.threadId !== threadId || context?.accountId !== accountId
        || context?.accountVerified !== true || context?.usable !== true
        || context?.restriction) throw new Error('reaction-context-changed');
      if (!dispatched) {
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        const authorized = assertAuthorized({ threadId, accountId, kind: 'reaction' });
        if (authorized !== true) {
          // Async grants cannot authorize a click that is about to happen.
          // Drain rejected promises without treating them as approval.
          if (authorized && typeof authorized.then === 'function') Promise.resolve(authorized).catch(() => {});
          throw new Error('reaction-authorization-required');
        }
      }
    }
    function wait(check, signal) {
      return new Promise((resolve, reject) => {
        const deadline = now() + timeoutMs;
        let timer, observer, settled = false;
        const finish = (error, value) => {
          if (settled) return; settled = true;
          clearTimeout(timer); observer?.disconnect();
          signal?.removeEventListener('abort', onAbort);
          error ? reject(error) : resolve(value);
        };
        const onAbort = () => finish(new DOMException('Stopped', 'AbortError'));
        const inspect = () => {
          if (settled) return;
          try {
            if (signal?.aborted) return onAbort();
            if (now() >= deadline) return finish(new Error('reaction-readiness-timeout'));
            const value = check();
            if (value) return finish(null, value);
            clearTimeout(timer); timer = setTimeout(inspect, Math.min(50, deadline - now()));
          } catch (error) { finish(error); }
        };
        try {
          inspect();
          if (settled) return;
          const Observer = document.defaultView?.MutationObserver;
          if (Observer) {
            observer = new Observer(inspect);
            observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
          }
          signal?.addEventListener('abort', onAbort, { once: true }); inspect();
        } catch (error) {
          finish(error);
        }
      });
    }
    return Object.freeze({
      badges,
      async remove({ row, badge, threadId, accountId, signal }) {
        guard(threadId, accountId, signal);
        if (!row?.isConnected || row.querySelectorAll('[aria-label="Message actions"]').length !== 1
          || !badges(row).includes(badge)) throw new Error('reaction-target-unavailable');
        const selectedEmoji = badgeEmoji(badge), signature = messageSignature(row);
        const attemptKey = JSON.stringify([accountId, threadId,
          messageIdentity(row) || fingerprint(signature), selectedEmoji]);
        if (unresolvedAttempts.has(attemptKey)) throw new Error('reaction-already-attempted');
        if (openDialogs().length) throw new Error('reaction-dialog-already-open');
        const unchanged = () => row.isConnected && messageSignature(row) === signature;
        let dialog, dispatched = false;
        try {
          guard(threadId, accountId, signal);
          badge.click();
          dialog = await wait(() => {
            guard(threadId, accountId, signal);
            if (!unchanged()) throw new Error('reaction-message-changed');
            const dialogs = openDialogs();
            if (dialogs.length > 1) throw new Error('reaction-dialog-ambiguous');
            return dialogs[0] || null;
          }, signal);
          let readySince = null, readySignature = null;
          await wait(() => {
            guard(threadId, accountId, signal);
            if (!unchanged() || !visible(dialog) || openDialogs().length !== 1) {
              throw new Error('reaction-message-changed');
            }
            const rows = reactionRows(dialog);
            if (busy(dialog) || !rows.length
              || reactionRows(dialog, selectedEmoji).length < badgeCount(badge)) {
              readySince = null; return false;
            }
            const current = JSON.stringify(rows.map(text).sort());
            if (current !== readySignature || readySince === null) {
              readySignature = current; readySince = now();
            }
            return now() - readySince >= stableMs;
          }, signal);
          const own = ownRows(dialog, selectedEmoji);
          if (own.length !== 1) {
            try {
              close(dialog, threadId, accountId, signal);
              await wait(() => {
                guard(threadId, accountId, signal);
                return !visible(dialog);
              }, signal);
            } catch (error) {
              if (signal?.aborted) throw error;
              throw Object.assign(new Error('reaction-dialog-close-unavailable'), { needsAttention: true });
            }
            return { verified: false, skipped: true, reason: own.length ? 'ownership-ambiguous' : 'not-my-reaction' };
          }
          const others = JSON.stringify(otherRows(dialog, selectedEmoji));
          guard(threadId, accountId, signal);
          if (!unchanged() || !visible(own[0])) throw new Error('reaction-message-changed');
          // Shared by every adapter in this isolated runtime. An uncertain
          // result cannot become a fresh attempt after native row remounting.
          if (unresolvedAttempts.has(attemptKey)) throw new Error('reaction-already-attempted');
          unresolvedAttempts.add(attemptKey);
          dispatched = true;
          own[0].click();
          let stableSince = null;
          let reopened = false;
          await wait(() => {
            // A dispatched removal must settle even after Stop. Stop cannot
            // turn an uncertain click into zero removals or a safe retry.
            guard(threadId, accountId, null, true);
            if (!unchanged()) throw uncertain('The message changed while checking its reaction.');
            const dialogs = openDialogs();
            if (dialogs.length > 1) throw uncertain('Reaction details became ambiguous.');
            const current = dialogs[0];
            const remainingBadges = badges(row);
            const matchingBadges = remainingBadges.filter((item) => badgeEmoji(item) === selectedEmoji);
            let removed = false;
            if (current) {
              if (busy(current)) { stableSince = null; return false; }
              removed = ownRows(current, selectedEmoji).length === 0
                && JSON.stringify(otherRows(current, selectedEmoji)) === others
                && (others !== '[]' || !matchingBadges.length);
            } else if (!remainingBadges.length && others === '[]') removed = true;
            else if (remainingBadges.length && !reopened) {
              // Grouped reactions keep the badge. Reopen details, not the
              // reaction toggle, to prove the other reactors are unchanged.
              reopened = true;
              remainingBadges[0].click();
              return false;
            }
            if (!removed) { stableSince = null; return false; }
            stableSince ??= now();
            return now() - stableSince >= stableMs;
          });
          const remainingDialog = openDialogs()[0];
          unresolvedAttempts.delete(attemptKey);
          if (remainingDialog) {
            try {
              close(remainingDialog, threadId, accountId, null, true);
              await wait(() => !visible(remainingDialog));
            }
            catch {
              // The removal is already proven. A stranded details dialog
              // needs attention, but must not erase that verified result.
              return { verified: true, skipped: false, removed: 1,
                needsAttention: true, reason: 'reaction-dialog-close-unavailable' };
            }
          }
          return { verified: true, skipped: false, removed: 1 };
        } catch (error) {
          if (dispatched) throw uncertain('Reaction removal could not be verified. Check this message before retrying.');
          if (dialog && visible(dialog) && error?.needsAttention !== true) {
            try { close(dialog, threadId, accountId, signal); } catch { /* Leave the native dialog for review. */ }
          }
          throw error;
        }
      },
    });
  }

  Object.defineProperty(globalThis, 'InstaToolboxOwnReactions', {
    configurable: false, writable: false,
    value: Object.freeze({ create, badges, createPlan, validatePlan, consumePlan }),
  });
})();

(() => {
  'use strict';

  const namespace = '__instaToolboxActionLabels';
  if (globalThis[namespace]) return;

  const relationshipEntries = Object.freeze([
    Object.freeze(['follow', 'not-following']),
    Object.freeze(['follow back', 'not-following']),
    Object.freeze(['following', 'following']),
    Object.freeze(['requested', 'requested']),
  ]);
  const dmUnsendLabels = Object.freeze([
    'annulla invio',
    'deshacer',
    'retirar',
    'retirer',
    'unsend',
    'zurücknehmen',
  ]);
  const dmActionSelectors = Object.freeze([
    "[aria-label^='See more options for message']",
    "[aria-label*='more options']",
    "[aria-label*='More']",
    "[aria-label*='Altre opzioni']",
    "[aria-label*='opzioni']",
    "[aria-label*='opciones']",
    "[aria-label*='options']",
    "[role='button'][aria-haspopup='menu']",
    "[role='button']",
  ]);
  const relationshipByLabel = new Map(relationshipEntries);
  const dmUnsendLabelSet = new Set(dmUnsendLabels);

  function normalizeActionLabel(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLowerCase();
  }

  function isDmMessageOptionsLabel(value) {
    const label = normalizeActionLabel(value);
    return label.startsWith('see more options for message')
      || label.startsWith('more options')
      || label.startsWith('altre opzioni')
      || label.startsWith('opzioni')
      || label.startsWith('opciones')
      || label.startsWith('options')
      || label === 'more';
  }

  const api = Object.freeze({
    dmActionSelectors,
    dmUnsendLabels,
    relationshipLabels: Object.freeze(relationshipEntries.map(([label]) => label)),
    isDmUnsendLabel(value) {
      return dmUnsendLabelSet.has(normalizeActionLabel(value));
    },
    isDmMessageOptionsLabel,
    normalizeActionLabel,
    relationshipForLabel(value) {
      return relationshipByLabel.get(normalizeActionLabel(value)) || null;
    },
  });

  Object.defineProperty(globalThis, namespace, {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();

(() => {
  'use strict';

  if (globalThis.InstaToolboxDmThreadUnsender) return;
  const actionLabels = globalThis.__instaToolboxActionLabels;
  if (!actionLabels) return;

  const ACTIVE_ATTRIBUTE = 'data-insta-toolbox-unsend-active';
  const DONE_ATTRIBUTE = 'data-insta-toolbox-unsent';
  const DEFAULT_MIN_DELAY_MS = 1_000;
  const DEFAULT_MAX_DELAY_MS = 2_000;
  const DEFAULT_MAX_FAILURES = 5;
  const MIN_USABLE_VISIBLE_PX = 24;
  const MAX_HOVER_DEPTH = 8;
  const MAX_HISTORY_CHECK_MS = 90_000;
  const MAX_SCAN_PASSES = 3;
  const MAX_PLAN_MESSAGES = 5_000;
  const MAX_EMPTY_GROWTH_ROUNDS = 600;
  const MAX_SCROLL_STEPS_PER_SEARCH = 2_000;
  const OLDEST_BOUNDARY_POLL_MS = 120;
  const OLDEST_BOUNDARY_STABLE_MS = 2_000;
  const STABLE_EMPTY_PASSES = 3;
  const PLAN_VERSION = 3;
  const PLAN_SCOPES = new Set(['all', 'newest', 'oldest']);
  const listeners = new Set();
  const consumedPlanDigests = new Map();

  let activeController = null;
  let activeMessageWalker = null;
  const readOnlyTraversals = new WeakMap();
  let activeExecution = null;
  let currentState = Object.freeze({
    status: 'idle',
    operation: null,
    processed: 0,
    failed: 0,
    retryAttempts: 0,
    consecutiveFailures: 0,
    current: null,
    message: 'Ready',
    startedAt: null,
    finishedAt: null,
    canStop: false,
    needsAttention: false,
    interruptionReason: null,
    uncertain: 0,
  });

  function snapshot() {
    return { ...currentState, phaseTimings: { ...(activeExecution?.phaseTimings || currentState.phaseTimings || {}) } };
  }

  function publish(patch) {
    currentState = Object.freeze({
      ...currentState,
      ...patch,
      phaseTimings: Object.freeze({ ...(activeExecution?.phaseTimings || currentState.phaseTimings || {}) }),
    });
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {
        // A view listener must not be able to interrupt the thread workflow.
      }
    }
    return snapshot();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function phaseClock() {
    return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
  }

  function recordPhase(phase, startedAt, excludedMs = 0) {
    if (!activeExecution) return;
    const durationMs = Math.max(0, phaseClock() - startedAt - excludedMs);
    activeExecution.phaseTimings[phase] = (activeExecution.phaseTimings[phase] || 0) + durationMs;
    try { activeExecution.onPhaseTiming?.(Object.freeze({ phase, durationMs })); } catch {}
  }

  async function measurePhase(phase, operation) {
    const startedAt = phaseClock();
    const resolutionBefore = activeExecution?.phaseTimings.messageResolution || 0;
    try { return await operation(); } finally {
      const excludedMs = phase === 'historyLoading'
        ? (activeExecution?.phaseTimings.messageResolution || 0) - resolutionBefore : 0;
      recordPhase(phase, startedAt, excludedMs);
    }
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      let timer;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(new DOMException('The operation was stopped.', 'AbortError'));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer = setTimeout(() => finish(), Math.max(0, ms));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  function randomDelay(minimum, maximum) {
    const min = Math.max(1_000, Number(minimum) || DEFAULT_MIN_DELAY_MS);
    const max = Math.max(min, Number(maximum) || DEFAULT_MAX_DELAY_MS);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function digestText(value) {
    let hash = 0x811c9dc5;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function planDigest({ version, threadId, scope, limit, detectedCount, expiresAt, speed }) {
    return digestText(JSON.stringify({
      version: Number(version),
      threadId: String(threadId || ''),
      scope: String(scope || ''),
      limit: limit === null ? null : Number(limit),
      detectedCount: detectedCount === null ? null : Number(detectedCount),
      expiresAt: Number(expiresAt),
      ...(Number(version) >= 3 ? { speed: String(speed || 'standard') } : {}),
    }));
  }

  function createPlan(value = {}) {
    const threadId = String(value.threadId || '').trim();
    const requestedScope = value.scope === null || value.scope === undefined || value.scope === ''
      ? 'all'
      : String(value.scope);
    if (!PLAN_SCOPES.has(requestedScope)) return null;
    const scope = requestedScope;
    const speed = value.speed === undefined ? 'standard' : String(value.speed);
    if (speed !== 'standard') return null;
    const requestedLimit = Math.floor(Number(value.limit));
    const limit = scope === 'all'
      ? null
      : Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(MAX_PLAN_MESSAGES, requestedLimit)
        : null;
    const hasDetectedCount = value.detectedCount !== null
      && value.detectedCount !== undefined
      && value.detectedCount !== '';
    const requestedDetectedCount = hasDetectedCount ? Number(value.detectedCount) : Number.NaN;
    const detectedCount = Number.isFinite(requestedDetectedCount) && requestedDetectedCount >= 0
      ? Math.min(MAX_PLAN_MESSAGES, Math.floor(requestedDetectedCount))
      : null;
    const expiresAt = Math.floor(Number(value.expiresAt) || 0);
    if (!threadId || (scope !== 'all' && !(limit > 0)) || expiresAt <= Date.now()) return null;
    const plan = {
      version: PLAN_VERSION,
      threadId,
      scope,
      limit,
      detectedCount,
      expiresAt,
      speed,
    };
    return Object.freeze({ ...plan, reviewedDigest: planDigest(plan) });
  }

  function validatePlan(value) {
    const version = Number(value?.version);
    if (![2, PLAN_VERSION].includes(version)) return null;
    if (version === 2 && value.speed !== undefined && value.speed !== 'standard') return null;
    const normalized = createPlan(value);
    if (!normalized) return null;
    const compatible = version === 2 ? { ...normalized, version: 2 } : normalized;
    const reviewedDigest = planDigest(compatible);
    return reviewedDigest === String(value?.reviewedDigest || '')
      ? Object.freeze({ ...compatible, reviewedDigest }) : null;
  }

  function visibleText(element) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return '';
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') return '';
    const rectangle = element.getBoundingClientRect?.();
    if (rectangle && rectangle.width === 0 && rectangle.height === 0) return '';
    return String(element.textContent || element.getAttribute?.('aria-label') || '').trim();
  }

  function overflowClips(value) {
    return /^(auto|scroll|hidden|clip)$/i.test(String(value || '').trim());
  }

  function hasUsableIntersection(start, end, clipStart, clipEnd) {
    const size = Math.max(0, Number(end) - Number(start));
    const visible = Math.max(
      0,
      Math.min(Number(end), Number(clipEnd)) - Math.max(Number(start), Number(clipStart)),
    );
    return visible >= Math.min(MIN_USABLE_VISIBLE_PX, size);
  }

  function clippedByAncestor(element, rectangle) {
    const documentElement = element.ownerDocument?.documentElement;
    const view = element.ownerDocument?.defaultView;

    for (let ancestor = element.parentElement;
      ancestor && ancestor !== documentElement;
      ancestor = ancestor.parentElement) {
      const style = view?.getComputedStyle?.(ancestor);
      const shorthand = String(style?.overflow || '').trim().split(/\s+/).filter(Boolean);
      const overflowX = style?.overflowX || shorthand[0] || '';
      const overflowY = style?.overflowY || shorthand[1] || shorthand[0] || '';
      const clipsX = overflowClips(overflowX);
      const clipsY = overflowClips(overflowY);
      if (!clipsX && !clipsY) continue;

      const bounds = ancestor.getBoundingClientRect?.();
      if (!bounds) continue;
      if (clipsX
        && !hasUsableIntersection(rectangle.left, rectangle.right, bounds.left, bounds.right)) return true;
      if (clipsY
        && !hasUsableIntersection(rectangle.top, rectangle.bottom, bounds.top, bounds.bottom)) return true;
    }

    return false;
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    if (typeof element.checkVisibility === 'function') {
      try {
        if (!element.checkVisibility({
          visibilityProperty: true,
          contentVisibilityAuto: true,
          opacityProperty: true,
        })) return false;
      } catch {
        // Older Chromium versions may not accept the options object.
      }
    }
    const rectangle = element.getBoundingClientRect?.();
    const viewportHeight = Number(element.ownerDocument?.defaultView?.innerHeight || globalThis.innerHeight || 0);
    const viewportWidth = Number(element.ownerDocument?.defaultView?.innerWidth || globalThis.innerWidth || 0);
    if (!rectangle || rectangle.height <= 0 || rectangle.width <= 0) return false;
    if (viewportHeight > 0
      && !hasUsableIntersection(rectangle.top, rectangle.bottom, 0, viewportHeight)) return false;
    if (viewportWidth > 0
      && !hasUsableIntersection(rectangle.left, rectangle.right, 0, viewportWidth)) return false;
    return !clippedByAncestor(element, rectangle);
  }

  function currentThreadId() {
    const match = String(location.pathname || '').match(/^\/direct\/t\/([^/?#]+)\/?$/i);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return '';
      }
    }
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(isVisible);
    if (roots.length !== 1) return '';
    const links = [...document.querySelectorAll("a[href*='/direct/t/']")].filter(isVisible);
    if (links.length !== 1) return '';
    const linkMatch = String(links[0].getAttribute?.('href') || '').match(/\/direct\/t\/([^/?#]+)/i);
    if (!linkMatch) return '';
    try {
      return decodeURIComponent(linkMatch[1]);
    } catch {
      return '';
    }
  }

  function sessionStop(expectedThreadId = '') {
    const observation = globalThis.InstaToolboxInstagramInspector?.inspectSession?.() || {};
    if (observation.sessionExpired) return 'Instagram signed you out';
    if (observation.challenge) return 'Instagram opened a security check';
    if (observation.actionBlocked) return 'Instagram blocked the action';
    if (observation.rateLimited) return 'Instagram asked you to slow down';
    const threadId = currentThreadId();
    if (!threadId) return 'The conversation is no longer open';
    if (expectedThreadId && threadId !== expectedThreadId) return 'The reviewed conversation changed';
    return null;
  }

  function lifecycleReason(signal) {
    return signal?.reason?.code === 'DM_LIFECYCLE_INTERRUPTED' ? signal.reason.reason : null;
  }

  function interruptionState(signal, processed, failed, uncertain = false) {
    const reason = lifecycleReason(signal);
    return {
      status: reason ? 'needs-attention' : 'stopped',
      needsAttention: Boolean(reason),
      interruptionReason: reason,
      uncertain: uncertain ? 1 : 0,
      message: reason
        ? `${reason === 'page-frozen' ? 'Tab suspended' : 'Page interrupted'}. ${uncertain ? 'The last Unsend outcome is uncertain. ' : ''}Review the conversation before starting again. ${processed} message${processed === 1 ? '' : 's'} unsent.`
        : `Stopped. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
      processed,
      failed,
      current: null,
      canStop: false,
      finishedAt: new Date().toISOString(),
    };
  }

  function watchThread(controller, expectedThreadId) {
    let timer;
    let observer;
    const check = () => {
      if (!controller.signal.aborted && currentThreadId() !== expectedThreadId) {
        controller.abort('Conversation changed. Unsend stopped.');
      }
    };
    const poll = () => {
      check();
      if (!controller.signal.aborted) timer = setTimeout(poll, 200);
    };
    const interrupt = (reason) => {
      if (controller.signal.aborted) return;
      if (activeController === controller) publish({
        status: 'stopping', canStop: false, needsAttention: true,
        interruptionReason: reason,
        message: 'Page interrupted. Settling the current action…',
      });
      controller.abort(Object.freeze({ code: 'DM_LIFECYCLE_INTERRUPTED', reason }));
    };
    const onFreeze = () => interrupt('page-frozen');
    const onPageHide = (event) => interrupt(event?.persisted ? 'page-cached' : 'page-left');
    const cleanup = () => {
      clearTimeout(timer);
      observer?.disconnect();
      globalThis.removeEventListener?.('popstate', check);
      globalThis.navigation?.removeEventListener?.('currententrychange', check);
      document.removeEventListener?.('freeze', onFreeze);
      globalThis.removeEventListener?.('pagehide', onPageHide);
      controller.signal.removeEventListener('abort', cleanup);
    };
    if (globalThis.MutationObserver && document.documentElement) {
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    globalThis.addEventListener?.('popstate', check);
    globalThis.navigation?.addEventListener?.('currententrychange', check);
    document.addEventListener?.('freeze', onFreeze);
    globalThis.addEventListener?.('pagehide', onPageHide);
    controller.signal.addEventListener('abort', cleanup, { once: true });
    if (controller.signal.aborted) { cleanup(); return cleanup; }
    poll();
    return cleanup;
  }

  function findScrollableChild(parent, view = globalThis) {
    if (!parent) return null;
    let best = null;
    const queue = [{ element: parent, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (depth > 10) continue;
      const style = view.getComputedStyle?.(element);
      const slack = Number(element.scrollHeight) - Number(element.clientHeight);
      if ((style?.overflowY === 'auto' || style?.overflowY === 'scroll') && slack > 8) {
        if (!best || slack > best.slack) best = { element, slack };
      }
      for (const child of element.children || []) queue.push({ element: child, depth: depth + 1 });
    }
    return best?.element || null;
  }

  function threadContext() {
    const threadId = currentThreadId();
    if (!threadId) {
      return { ok: false, reason: 'Open an Instagram conversation first.' };
    }
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(isVisible);
    const root = roots.length === 1 ? roots[0] : null;
    if (!root) {
      return { ok: false, reason: 'The message list is still loading. Keep the conversation open and try again.' };
    }
    const scroller = findScrollableChild(root, root.ownerDocument.defaultView);
    if (!scroller) {
      // Short conversations can fit without producing a scrollable descendant.
      return { ok: true, root, scroller: root, threadId };
    }
    return { ok: true, root, scroller, threadId };
  }

  function deepestMessageContainer(scroller) {
    let best = scroller;
    let bestCount = scroller?.children?.length || 0;
    let messageContainer = null;
    let messageCount = 0;
    const isMessageRow = (element) => ['row', 'listitem'].includes(element?.getAttribute?.('role'))
      || Boolean(element?.getAttribute?.('data-message-id') || element?.getAttribute?.('data-item-id'));
    const queue = [{ element: scroller, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (depth > 4) continue;
      const count = element?.children?.length || 0;
      const directMessages = [...element?.children || []].filter(isMessageRow).length;
      if (directMessages > messageCount) {
        messageContainer = element;
        messageCount = directMessages;
      }
      if (count > bestCount) {
        best = element;
        bestCount = count;
      }
      for (const child of element?.children || []) {
        if (!isMessageRow(child)) queue.push({ element: child, depth: depth + 1 });
      }
    }
    // Real rows outrank header/card child counts, including after a removal
    // leaves fewer rows than the surrounding layout has children.
    return messageContainer || best;
  }

  function hasMessageContent(row) {
    return Boolean(
      row?.querySelector?.('[role="none"], [role="presentation"], [dir="auto"], img, video, audio'),
    );
  }

  function sentByCurrentUser(row, view = globalThis) {
    const explicit = String(row?.getAttribute?.('data-sent-by-me') || '').toLowerCase();
    if (explicit === 'false') return false;
    if ([...row?.querySelectorAll?.('[data-sent-by-me]') || []].some((element) => (
      String(element.getAttribute?.('data-sent-by-me')).toLowerCase() === 'false'
    ))) return false;
    // Alignment belongs to the horizontal message wrapper, never a nested
    // reaction/menu or a column's vertical placement. Empty hidden spacers do
    // not split that wrapper chain; real content branches still do.
    // Native message groups keep their body and action controls together even
    // when a timestamp or reply heading is a sibling outside that group.
    // Accept only one outer message group; never search arbitrary descendants
    // for a right-aligned control or combine evidence from multiple messages.
    const groups = [...row?.querySelectorAll?.('[role="group"]') || []]
      .filter((group) => group.getAttribute?.('aria-label') !== 'Message actions'
        && group.querySelectorAll?.('[aria-label="Message actions"]').length === 1);
    const outerGroups = groups.filter((group) => !groups.some((other) => (
      other !== group && other.contains?.(group)
    )));
    if (outerGroups.length > 1) return false;
    if (outerGroups.length === 1) {
      for (let ancestor = outerGroups[0].parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = view.getComputedStyle?.(ancestor);
        if (['flex', 'inline-flex'].includes(style?.display)
          && style.flexDirection === 'row' && style.justifyContent === 'flex-start') return false;
        if (ancestor === row) break;
      }
      const group = outerGroups[0];
      const actions = group.querySelectorAll('[aria-label="Message actions"]')[0];
      let nativeAligned = false;
      // Replies and story shares add siblings above the message body. Follow
      // the one native action group's ancestry instead of treating those
      // siblings as the end of the message's ownership evidence.
      for (let lane = actions.parentElement; lane; lane = lane.parentElement) {
        const style = view.getComputedStyle?.(lane);
        const payload = [...lane.querySelectorAll?.('[dir="auto"], img, video, audio') || []]
          .some((element) => !actions.contains?.(element));
        if (payload && ['flex', 'inline-flex'].includes(style?.display)
          && style.flexDirection === 'row' && style.direction !== 'rtl') {
          if (style.justifyContent === 'flex-start') return false;
          if (style.justifyContent === 'flex-end') nativeAligned = true;
        }
        if (lane === group) break;
      }
      if (nativeAligned) return true;
    }
    let element = outerGroups.length === 1 ? outerGroups[0] : row;
    let aligned = false;
    for (let depth = 0; element && depth <= MAX_HOVER_DEPTH; depth += 1) {
      if (depth > 0 && element.matches?.('[dir="auto"], img, video, audio, button, [role="button"]')) break;
      const style = view.getComputedStyle?.(element);
      const horizontal = !style?.flexDirection || style.flexDirection === 'row';
      const flexLayout = !style?.display || ['flex', 'inline-flex'].includes(style.display);
      if (horizontal && flexLayout && style?.direction !== 'rtl') {
        if (style?.justifyContent === 'flex-start') return false;
        if (style?.justifyContent === 'flex-end') aligned = true;
      }
      const children = [...element.children || []].filter((child) => !(
        child.getAttribute?.('aria-hidden') === 'true'
        && !hasMessageContent(child) && !visibleText(child)
      ));
      if (children.length !== 1) break;
      element = children[0];
    }
    return explicit === 'true' || aligned;
  }

  function stableMessageKey(row) {
    // Only identifiers whose attribute names explicitly describe a message are
    // safe across Instagram's recycled virtual-list nodes. Generic `id` and
    // `data-id` values often identify the physical slot, not the logical DM.
    for (const attribute of ['data-message-id', 'data-item-id']) {
      const value = String(row?.getAttribute?.(attribute) || '').trim();
      if (value) return `${attribute}:${value}`;
    }
    for (const element of row?.querySelectorAll?.('[data-message-id], [data-item-id]') || []) {
      for (const attribute of ['data-message-id', 'data-item-id']) {
        const value = String(element?.getAttribute?.(attribute) || '').trim();
        if (value) return `${attribute}:${value}`;
      }
    }
    return null;
  }

  function messagePositionFingerprint(row, traversal = null) {
    const scroller = traversal?.scroller || row?.parentElement;
    const rowRect = row?.getBoundingClientRect?.();
    const scrollerRect = scroller?.getBoundingClientRect?.();
    const siblings = [...(row?.parentElement?.children || [])];
    const ordinal = siblings.indexOf(row);
    const scrollTop = Number(scroller?.scrollTop);
    const relativeTop = Number(rowRect?.top) - Number(scrollerRect?.top);
    return [
      Number.isFinite(scrollTop) ? Math.round(scrollTop) : '',
      Number.isFinite(relativeTop) ? Math.round(relativeTop) : '',
      ordinal >= 0 ? ordinal : '',
    ].join(':');
  }

  function genericMessageHint(row) {
    for (const attribute of ['data-id', 'id']) {
      const value = String(row?.getAttribute?.(attribute) || '').trim();
      if (value) return `${attribute}:${value}`;
    }
    return '';
  }

  function messageFingerprint(row, traversal = null) {
    const timestamp = String(
      row?.querySelector?.('time[datetime]')?.getAttribute?.('datetime')
      || row?.querySelector?.('[data-timestamp]')?.getAttribute?.('data-timestamp')
      || '',
    );
    return digestText(JSON.stringify({
      key: stableMessageKey(row),
      genericHint: genericMessageHint(row),
      position: messagePositionFingerprint(row, traversal),
      timestamp,
      text: preview(row),
    }));
  }

  function processedMarkerMatches(row, traversal = null) {
    const key = stableMessageKey(row);
    if (key && traversal?.processedKeys?.has(key)) return true;
    if (!row?.hasAttribute?.(DONE_ATTRIBUTE)) return false;
    const marker = String(row.getAttribute?.(DONE_ATTRIBUTE) || '');
    if (marker && marker === messageFingerprint(row, traversal)) return true;
    // Instagram can recycle a virtualized row node for another message. A
    // marker tied to the old content must not hide the newly mounted message.
    row.removeAttribute?.(DONE_ATTRIBUTE);
    return false;
  }

  function candidateRows(scroller, traversal = null) {
    const startedAt = phaseClock();
    const container = deepestMessageContainer(scroller);
    let rows = [...(container?.children || [])];
    if (!rows.length) {
      rows = [...(scroller?.querySelectorAll?.('[role="row"], [role="listitem"]') || [])];
    }
    const reader = traversal && readOnlyTraversals.get(traversal);
    const candidates = rows
      .filter((row) => reader ? !reader.visited(row, scroller) : !processedMarkerMatches(row, traversal))
      .filter((row) => !row.hasAttribute?.(ACTIVE_ATTRIBUTE))
      .filter(hasMessageContent)
      .filter((row) => reader
        ? Boolean(stableMessageKey(row)
          || ['row', 'listitem'].includes(row.getAttribute?.('role'))
          || ['true', 'false'].includes(row.getAttribute?.('data-sent-by-me'))
          || row.querySelectorAll?.('[aria-label="Message actions"]').length === 1)
        : sentByCurrentUser(row, row.ownerDocument.defaultView));
    recordPhase('messageResolution', startedAt);
    return candidates;
  }

  function orderedCandidates(scroller, order = 'oldest', traversal = null) {
    const rows = candidateRows(scroller, traversal);
    const positioned = rows.map((row, index) => {
      const rect = row?.getBoundingClientRect?.();
      const top = Number(rect?.top);
      const bottom = Number(rect?.bottom);
      return {
        index,
        position: Number.isFinite(top) && Number.isFinite(bottom)
          ? (top + bottom) / 2
          : Number.NaN,
        row,
      };
    });
    const distinctPositions = new Set(
      positioned.filter(({ position }) => Number.isFinite(position)).map(({ position }) => position),
    );
    if (distinctPositions.size > 1) {
      const direction = order === 'newest' ? -1 : 1;
      return positioned
        .sort((left, right) => {
          if (!Number.isFinite(left.position)) return 1;
          if (!Number.isFinite(right.position)) return -1;
          return ((left.position - right.position) * direction) || (left.index - right.index);
        })
        .map(({ row }) => row);
    }
    // Geometry can be unavailable in detached/unit-test DOM. Fall back to the
    // visual ordering implied by the container's flex direction.
    const newestFirst = reversedLayout(scroller) ? rows : [...rows].reverse();
    return order === 'newest' ? newestFirst : newestFirst.reverse();
  }

  function firstVisibleCandidate(scroller, order = 'oldest', traversal = null) {
    const rows = orderedCandidates(scroller, order, traversal);
    return rows.find(isVisible) || null;
  }

  async function waitForElement(target, getter, signal, timeoutMs = 3_000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      let timer;
      let observer;
      let settled = false;
      const cleanup = () => {
        observer?.disconnect();
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
      };
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(null, new DOMException('The operation was stopped.', 'AbortError'));
      const check = () => {
        if (settled) return;
        if (signal?.aborted) { onAbort(); return; }
        if (Date.now() >= deadline) { finish(null); return; }
        try {
          const value = getter();
          if (signal?.aborted) onAbort();
          else if (Date.now() >= deadline) finish(null);
          else if (value) finish(value);
        } catch (error) { finish(null, error); }
      };
      const expire = () => {
        if (settled) return;
        const remaining = deadline - Date.now();
        if (remaining > 0) timer = setTimeout(expire, remaining);
        else finish(null);
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      check();
      if (settled) return;
      try {
        observer = new MutationObserver(check);
        observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
        if (settled) return;
        timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
        check();
      } catch (error) { finish(null, error); }
    });
  }

  function dispatch(target, event) {
    EventTarget.prototype.dispatchEvent.call(target, event);
  }

  function hoverOptions(target) {
    const rectangle = target.getBoundingClientRect?.() || { x: 0, y: 0, width: 0, height: 0 };
    return {
      bubbles: true,
      cancelable: true,
      clientX: rectangle.x + (rectangle.width / 2),
      clientY: rectangle.y + (rectangle.height / 2),
      pointerId: 1,
      pointerType: 'mouse',
    };
  }

  function hoverIn(target) {
    const options = hoverOptions(target);
    if (typeof PointerEvent === 'function') {
      dispatch(target, new PointerEvent('pointerenter', { ...options, bubbles: false }));
      dispatch(target, new PointerEvent('pointerover', options));
      dispatch(target, new PointerEvent('pointermove', options));
    }
    dispatch(target, new MouseEvent('mouseenter', { ...options, bubbles: false }));
    dispatch(target, new MouseEvent('mouseover', options));
    dispatch(target, new MouseEvent('mousemove', options));
  }

  function hoverOut(target) {
    const options = hoverOptions(target);
    if (typeof PointerEvent === 'function') {
      dispatch(target, new PointerEvent('pointerout', options));
      dispatch(target, new PointerEvent('pointerleave', { ...options, bubbles: false }));
    }
    dispatch(target, new MouseEvent('mouseout', options));
    dispatch(target, new MouseEvent('mouseleave', { ...options, bubbles: false }));
  }

  function hoverTargets(row) {
    const targets = [];
    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      targets.push(element);
      if (depth < MAX_HOVER_DEPTH) {
        for (const child of element.children || []) queue.push({ element: child, depth: depth + 1 });
      }
    }
    return targets;
  }

  function clickable(element, scope = document) {
    const control = element?.closest?.('button, [role="button"], [role="menuitem"]');
    return control && scope.contains(control) ? control : null;
  }

  function isDmMessageOptionsControl(control) {
    const ownLabel = actionLabels.normalizeActionLabel(control?.getAttribute?.('aria-label'));
    const text = actionLabels.normalizeActionLabel(visibleText(control));
    const iconLabels = [...control?.querySelectorAll?.('[aria-label]') || []]
      .map((element) => actionLabels.normalizeActionLabel(element.getAttribute?.('aria-label')))
      .filter(Boolean);
    // An explicit accessible name is authoritative. A generic "More" caption
    // or decorative ellipsis cannot override Reply, Share, or another action.
    if (ownLabel && !actionLabels.isDmMessageOptionsLabel(ownLabel)) return false;
    if (text && !actionLabels.isDmMessageOptionsLabel(text) && !/^[.\u2026\u22ef\u22ee]+$/u.test(text)) return false;
    if (iconLabels.some((label) => !actionLabels.isDmMessageOptionsLabel(label))) return false;
    return Boolean(ownLabel || actionLabels.isDmMessageOptionsLabel(text) || iconLabels.length);
  }

  function actionButton(row) {
    const matches = [];
    for (const selector of actionLabels.dmActionSelectors) {
      for (const element of row.querySelectorAll?.(selector) || []) {
        const control = clickable(element, row) || (element.matches?.('button, [role="button"]') ? element : null);
        if (control) matches.push(control);
      }
    }
    const controls = [...new Set(matches)]
      .filter(isDmMessageOptionsControl)
      .filter(isVisible);
    return controls.length === 1 ? controls[0] : null;
  }

  function activateControl(control) {
    HTMLElement.prototype.click.call(control);
  }

  function visibleSurfaces(selector) {
    return [...document.querySelectorAll(selector)].filter((element) => visibleText(element));
  }

  // Instagram renders the message menu in a portal near the end of <body>, and
  // that container does not reliably carry role="menu". Scoping the search to
  // newly added menu surfaces therefore finds nothing and every message times
  // out, so the search runs over the whole document.
  //
  // Only leaf elements are considered — ones whose own first child is a text
  // node. An ancestor's textContent also reads "Unsend", and matching those
  // produced several candidates for one item.
  function unsendCandidates(scope = document) {
    const found = [];
    for (const element of scope?.querySelectorAll?.('span, div, button, [role="button"], [role="menuitem"]') || []) {
      if (element.firstChild?.nodeType !== 3) continue;
      if (!actionLabels.isDmUnsendLabel(visibleText(element))) continue;
      if (!isVisible(element)) continue;
      found.push(clickable(element, document) || element);
    }
    return [...new Set(found)];
  }

  async function dismissStaleSurfaces(signal) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!visibleSurfaces('[role="dialog"], [role="menu"], [role="listbox"]').length) return;
      dispatch(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(160, signal);
    }
  }

  async function revealActionButton(row, signal) {
    await dismissStaleSurfaces(signal);
    const targets = hoverTargets(row);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const target of targets) hoverIn(target);
      await delay(110, signal);
      const control = actionButton(row);
      if (control) return control;
      for (const target of targets) hoverOut(target);
      await delay(60, signal);
    }
    for (const target of targets) hoverIn(target);
    return waitForElement(row, () => actionButton(row), signal, 3_000);
  }

  function authorizationFailure(expectedThreadId, authorizationExpiresAt) {
    if (!(Number(authorizationExpiresAt) > Date.now())) return 'Live authorization expired before the next Instagram control.';
    return sessionStop(expectedThreadId);
  }

  function requireAuthorization(expectedThreadId, authorizationExpiresAt, actionGrant = false) {
    if (activeController?.signal.aborted) {
      throw new DOMException('The operation was stopped.', 'AbortError');
    }
    const reason = authorizationFailure(expectedThreadId, authorizationExpiresAt);
    if (reason) throw new Error(reason);
    const adapter = activeExecution?.workerAdapter;
    const authorized = !adapter || (actionGrant
      ? adapter.assertAction({ threadId: expectedThreadId, candidate: workerCandidate(activeExecution.workerRow) })
      : adapter.assertContext({ threadId: expectedThreadId })) === true;
    if (!authorized) {
      const error = new Error('The reviewed worker no longer owns this action.');
      error.code = 'DM_WORKER_STOP';
      throw error;
    }
  }

  function workerCandidate(row) {
    const timestamps = new Set();
    const nodes = [row, ...row?.querySelectorAll?.('[data-timestamp-ms], [data-timestamp], time[datetime]') || []];
    for (const element of nodes) {
      for (const attribute of ['data-timestamp-ms', 'data-timestamp', 'datetime']) {
        const raw = element?.getAttribute?.(attribute);
        if (!raw) continue;
        const numeric = Number(raw);
        const timestamp = Number.isFinite(numeric)
          ? (attribute === 'data-timestamp' && numeric < 100_000_000_000 ? numeric * 1_000 : numeric)
          : Date.parse(raw);
        if (Number.isFinite(timestamp) && timestamp > 0) timestamps.add(timestamp);
      }
    }
    return Object.freeze({
      key: stableMessageKey(row),
      timestamp: timestamps.size === 1 ? [...timestamps][0] : null,
      ownershipVerified: Boolean(row?.isConnected && sentByCurrentUser(row)),
    });
  }

  async function openUnsendMenu(control, signal, expectedThreadId, authorizationExpiresAt) {
    const existing = new Set(unsendCandidates(document));
    const pending = waitForElement(document.body, () => {
      const candidates = unsendCandidates(document).filter((candidate) => !existing.has(candidate));
      if (candidates.length > 1) return { ambiguous: true };
      return candidates.length === 1 ? { control: candidates[0] } : null;
    }, signal, 3_000);
    pending.catch(() => {});
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    activateControl(control);
    const result = await measurePhase('menuReadiness', () => pending);
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    if (result?.ambiguous) throw new Error('Instagram showed more than one new Unsend option.');
    return result;
  }

  function dialogControlHasUnsendLabel(control) {
    if (actionLabels.isDmUnsendLabel(visibleText(control))) return true;
    return [...control.querySelectorAll?.('span, div') || []].some((element) => (
      element.firstChild?.nodeType === 3
      && actionLabels.isDmUnsendLabel(visibleText(element))
    ));
  }

  function dialogUnsendCandidates(existing = new Set()) {
    return [...document.querySelectorAll(
      '[role="dialog"] button, [role="dialog"] [role="button"]',
    )]
      .filter(isVisible)
      .filter((candidate) => !existing.has(candidate))
      .filter(dialogControlHasUnsendLabel);
  }

  async function confirmUnsend(menuControl, row, signal, expectedThreadId, authorizationExpiresAt) {
    // A normal confirmation dialog may contain both Cancel and Unsend. Accept
    // exactly one newly surfaced, localized Unsend control while ignoring
    // unrelated dialog buttons and every control that pre-dated this step.
    const existing = new Set(
      [...document.querySelectorAll(
        '[role="dialog"] button, [role="dialog"] [role="button"]',
      )].filter(isVisible),
    );
    const pending = waitForElement(
      document.body,
      () => {
        const candidates = dialogUnsendCandidates(existing);
        if (candidates.length > 1) return { ambiguous: true };
        return candidates.length === 1 ? { control: candidates[0] } : null;
      },
      signal,
      3_000,
    );
    pending.catch(() => {});
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    activateControl(menuControl);
    const result = await measurePhase('confirmationReadiness', () => pending);
    requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
    if (result?.ambiguous) throw new Error('Instagram showed more than one new Unsend confirmation.');
    const dialogButton = result?.control;
    if (!dialogButton) return false;

    const before = removalEvidence(row);
    const settlement = new AbortController();
    const deadline = Date.now() + 5_000;
    // Observe both native transitions before clicking, as in the original
    // runner. The separate settlement signal lets Stop prevent the next
    // action without abandoning the outcome of this dispatched action.
    const closed = waitForElement(
      document.body,
      () => (!dialogButton.isConnected || !isVisible(dialogButton) ? true : null),
      settlement.signal,
      5_000,
    );
    const removed = waitForElement(
      document.body,
      () => (currentThreadId() === expectedThreadId && removalProven(row, before) ? true : null),
      settlement.signal,
      5_000,
    ).then((ready) => ready === true && waitForRemoval(row, before, {
      dialogButton,
      contextValid: () => currentThreadId() === expectedThreadId,
      timeoutMs: Math.max(0, deadline - Date.now()),
      signal: settlement.signal,
    }));
    closed.catch(() => {});
    removed.catch(() => {});
    let dispatched = false;
    try {
      requireAuthorization(expectedThreadId, authorizationExpiresAt, true);
      dispatched = true;
      activateControl(dialogButton);
      const verified = await measurePhase('verification', async () => (
        (await closed) === true && (await removed) === true
      ));
      if (!verified) throw new Error('Removal could not be verified.');
      return true;
    } catch (cause) {
      if (!dispatched) throw cause;
      const error = new Error('The last Unsend outcome is uncertain. Check the conversation before starting again.');
      error.code = 'DM_OUTCOME_UNCERTAIN';
      throw error;
    } finally {
      settlement.abort();
    }
  }

  async function unsendRow(row, signal, expectedThreadId, authorizationExpiresAt) {
    row.setAttribute(ACTIVE_ATTRIBUTE, '');
    let success = false;
    try {
      const control = await measurePhase('menuReadiness', () => revealActionButton(row, signal));
      if (!control) throw new Error('The message menu did not appear.');
      const menu = await openUnsendMenu(
        control,
        signal,
        expectedThreadId,
        authorizationExpiresAt,
      );
      if (!menu?.control) throw new Error('Instagram did not show an Unsend option.');
      success = await confirmUnsend(
        menu.control,
        row,
        signal,
        expectedThreadId,
        authorizationExpiresAt,
      );
      if (!success) throw new Error('The message was not confirmed as removed.');
      return true;
    } finally {
      row.removeAttribute(ACTIVE_ATTRIBUTE);
      if (!success && !signal.aborted) await dismissStaleSurfaces(signal).catch(() => {});
    }
  }

  function reversedLayout(scroller) {
    return scroller?.ownerDocument?.defaultView?.getComputedStyle?.(scroller)?.flexDirection === 'column-reverse'
      || Number(scroller?.scrollTop) < 0;
  }

  function oldestOffset(scroller, reversed) {
    return reversed ? -(scroller.scrollHeight - scroller.clientHeight) : 0;
  }

  function newestOffset(scroller, reversed) {
    return reversed ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function visibleLoader(root) {
    return [...root.querySelectorAll?.('[role="progressbar"], svg[aria-label*="Loading" i]') || []]
      .find(isVisible) || null;
  }

  async function waitForLoader(root, signal) {
    if (!visibleLoader(root)) return;
    await Promise.race([
      waitForElement(root, () => visibleLoader(root) === null, signal, 5_000),
      delay(5_000, signal),
    ]).catch(() => {});
  }

  function advanceHistoryProgress(progress, height, rowCount) {
    const nextHeight = Math.max(0, Number(height) || 0);
    const nextRows = Math.max(0, Math.floor(Number(rowCount) || 0));
    return {
      grew: nextHeight > progress.maxHeight || nextRows > progress.maxRows,
      maxHeight: Math.max(progress.maxHeight, nextHeight),
      maxRows: Math.max(progress.maxRows, nextRows),
    };
  }

  async function loadAllHistory(context, signal) {
    const { root, scroller } = context;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 50) {
      return { complete: true, detectedCount: candidateRows(scroller || root).length, pagesChecked: 0 };
    }
    const reversed = reversedLayout(scroller);
    const startedAt = Date.now();
    let quietRounds = 0;
    let topNudgeUsed = false;
    let pagesChecked = 0;
    let progress = advanceHistoryProgress(
      { maxHeight: 0, maxRows: 0 },
      scroller.scrollHeight,
      candidateRows(scroller).length,
    );
    // Instagram pauses between pages on a long thread, so a few quiet rounds
    // does not mean the history ended. Giving up after three left most of a
    // long conversation unloaded, which is the same impatience the follower
    // scan had.
    for (let page = 0;
      page < 600 && quietRounds < 10 && Date.now() - startedAt < MAX_HISTORY_CHECK_MS;
      page += 1) {
      pagesChecked = page + 1;
      const stop = sessionStop(context.threadId);
      if (stop) throw new Error(stop);
      const target = oldestOffset(scroller, reversed);
      if (Math.abs(scroller.scrollTop - target) > 5) {
        scroller.scrollTop = target;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
      } else if (!topNudgeUsed && quietRounds >= 2) {
        // Some Instagram builds only restart lazy history loading after real
        // movement at the oldest edge. Wake that loader once per loaded page,
        // not on every quiet poll: repeated nudges made the conversation look
        // as though the run was permanently fighting manual scrolling.
        scroller.scrollTop = target + (reversed ? 1 : -1) * Math.max(80, Math.floor(scroller.clientHeight / 2));
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        await delay(80, signal);
        scroller.scrollTop = target;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        topNudgeUsed = true;
      } else {
        // A synthetic edge notification is enough while waiting for a loader
        // that is already in flight and does not visibly move the thread.
        dispatch(scroller, new Event('scroll', { bubbles: true }));
      }
      await delay(500, signal);
      await waitForLoader(root, signal);
      progress = advanceHistoryProgress(
        progress,
        scroller.scrollHeight,
        candidateRows(scroller).length,
      );
      const { grew } = progress;
      quietRounds = grew ? 0 : quietRounds + 1;
      if (grew) topNudgeUsed = false;
      publish({
        status: 'preparing',
        message: grew ? 'Loading older messages…' : 'Checking for older messages…',
        canStop: true,
      });
    }
    // Stay at the oldest end. Jumping back to the newest message made the run
    // start from the bottom and work upward, which is slower and re-renders
    // the thread constantly. Loading to the top and then working down from
    // there is both faster and easier to watch.
    scroller.scrollTop = oldestOffset(scroller, reversed);
    dispatch(scroller, new Event('scroll', { bubbles: true }));
    await delay(100, signal);
    progress = advanceHistoryProgress(
      progress,
      scroller.scrollHeight,
      candidateRows(scroller).length,
    );
    return {
      complete: quietRounds >= 10,
      // Instagram virtualizes long conversations. This is only the largest
      // simultaneously mounted sent-message window, never a proven total.
      detectedCount: progress.maxRows,
      pagesChecked,
    };
  }

  function rowNeedsReposition(row, scroller) {
    if (!isVisible(row)) return true;
    const rowRect = row.getBoundingClientRect?.();
    const scrollerRect = scroller?.getBoundingClientRect?.();
    if (!rowRect || !scrollerRect) return false;
    const inset = Math.min(16, Math.max(4, Math.floor(scrollerRect.height * 0.04)));
    return rowRect.top < scrollerRect.top + inset
      || rowRect.bottom > scrollerRect.bottom - inset;
  }

  async function exposeRow(row, scroller, signal, traversal = null) {
    if (!rowNeedsReposition(row, scroller)) return isVisible(row);
    traversal && readOnlyTraversals.get(traversal)?.check(true);
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    dispatch(scroller, new Event('scroll', { bubbles: true }));
    await delay(60, signal);
    traversal && readOnlyTraversals.get(traversal)?.check();
    return isVisible(row);
  }

  function createTraversal(order = 'newest') {
    return {
      order: order === 'oldest' ? 'oldest' : 'newest',
      scroller: null,
      lastScrollTop: null,
      lastScrollHeight: 0,
      lastSearchGrew: false,
      lastSearchIncomplete: false,
      lastSearchSteps: 0,
      oldestBoundaryProven: order !== 'oldest',
      processedKeys: new Set(),
    };
  }

  function traversalContext(context, traversal) {
    readOnlyTraversals.get(traversal)?.check();
    let current = context;
    if (context?.threadId) {
      current = threadContext();
      if (!current.ok || current.threadId !== context.threadId) {
        throw new Error(current.reason || 'The reviewed conversation changed.');
      }
    }
    if (traversal.scroller !== current?.scroller) {
      if (traversal.order === 'oldest' && traversal.scroller) {
        traversal.oldestBoundaryProven = false;
      }
      traversal.scroller = current.scroller;
      traversal.lastScrollTop = null;
      traversal.lastScrollHeight = Number(current.scroller?.scrollHeight) || 0;
    }
    return current;
  }

  function traversalBounds(scroller, order) {
    const reversed = reversedLayout(scroller);
    const oldest = oldestOffset(scroller, reversed);
    const newest = newestOffset(scroller, reversed);
    const start = order === 'oldest' ? oldest : newest;
    const end = order === 'oldest' ? newest : oldest;
    return { start, end, direction: end >= start ? 1 : -1 };
  }

  function oldestBoundarySnapshot(context) {
    const scroller = context?.scroller;
    const rows = [...(deepestMessageContainer(scroller)?.children || [])];
    const rowEvidence = rows.map((row, index) => ({
      genericHint: genericMessageHint(row),
      index,
      key: stableMessageKey(row),
      text: visibleText(row).slice(0, 120),
      timestamp: String(
        row?.querySelector?.('time[datetime]')?.getAttribute?.('datetime')
        || row?.querySelector?.('[data-timestamp]')?.getAttribute?.('data-timestamp')
        || '',
      ),
    }));
    return {
      height: Number(scroller?.scrollHeight) || 0,
      loaderVisible: Boolean(visibleLoader(context?.root)),
      oldest: traversalBounds(scroller, 'oldest').start,
      rowCount: rows.length,
      rowSignature: digestText(JSON.stringify(rowEvidence)),
      scroller,
    };
  }

  async function proveStableOldestBoundary(
    context,
    traversal,
    signal,
    authorizationExpiresAt,
  ) {
    const startedAt = Date.now();
    let stableKey = '';
    let stableSince = 0;

    while (Date.now() - startedAt < MAX_HISTORY_CHECK_MS) {
      const reader = readOnlyTraversals.get(traversal);
      if (reader) reader.check(true);
      else requireAuthorization(context.threadId, authorizationExpiresAt);
      const current = traversalContext(context, traversal);
      const before = oldestBoundarySnapshot(current);
      current.scroller.scrollTop = before.oldest;
      dispatch(current.scroller, new Event('scroll', { bubbles: true }));
      await delay(OLDEST_BOUNDARY_POLL_MS, signal);

      if (reader) reader.check();
      else requireAuthorization(context.threadId, authorizationExpiresAt);
      const refreshed = traversalContext(context, traversal);
      const after = oldestBoundarySnapshot(refreshed);
      const atOldest = Math.abs(Number(after.scroller?.scrollTop) - after.oldest) <= 1;
      const replaced = before.scroller !== after.scroller;
      const changed = replaced
        || before.height !== after.height
        || before.rowCount !== after.rowCount
        || before.rowSignature !== after.rowSignature;
      const nextKey = [
        after.height,
        after.oldest,
        after.rowCount,
        after.rowSignature,
      ].join(':');

      if (!atOldest || after.loaderVisible || changed) {
        stableKey = '';
        stableSince = 0;
        continue;
      }
      if (stableKey !== nextKey) {
        stableKey = nextKey;
        stableSince = Date.now();
        continue;
      }
      if (Date.now() - stableSince >= OLDEST_BOUNDARY_STABLE_MS) {
        traversal.scroller = after.scroller;
        traversal.lastScrollTop = after.oldest;
        traversal.lastScrollHeight = after.height;
        traversal.lastSearchGrew = false;
        traversal.lastSearchIncomplete = false;
        traversal.lastSearchSteps = 0;
        traversal.oldestBoundaryProven = true;
        return refreshed;
      }
    }

    throw new Error('The oldest conversation boundary could not be proven before the safety timeout.');
  }

  function markProcessedRow(row, traversal, keyBeforeRemoval) {
    if (keyBeforeRemoval) traversal.processedKeys.add(keyBeforeRemoval);
    // Tie the marker to the postcondition DOM, not merely the physical node.
    // If Instagram recycles the node for a different message, the fingerprint
    // changes and candidateRows removes the stale marker.
    row.setAttribute?.(DONE_ATTRIBUTE, messageFingerprint(row, traversal));
  }

  function resetTraversalAfterRemoval(traversal, scroller, before = {}) {
    const scrollerChanged = Boolean(before.scroller && before.scroller !== scroller);
    const height = Number(scroller?.scrollHeight) || 0;
    const previousHeight = Number(before.scrollHeight);
    const shrank = Number.isFinite(previousHeight) && height + 1 < previousHeight;
    traversal.scroller = scroller;
    if (traversal.order === 'oldest' && (scrollerChanged || shrank)) {
      traversal.oldestBoundaryProven = false;
    }
    // Instagram recycles and reorders the mounted message window after a
    // confirmed Unsend even when scrollHeight happens to stay unchanged. A
    // retained offset can therefore point at a stale virtual slot and make a
    // multi-message run stop after its first success. Re-enter from the
    // requested edge after every verified removal; processed logical IDs and
    // postcondition markers still prevent selecting the removed message.
    traversal.lastScrollTop = null;
    traversal.lastScrollHeight = height;
    traversal.lastSearchGrew = false;
    traversal.lastSearchIncomplete = false;
    traversal.lastSearchSteps = 0;
  }

  async function reestablishTraversalEdge(context, traversal, signal) {
    for (let attempt = 0; attempt < MAX_SCAN_PASSES; attempt += 1) {
      if (signal.aborted) return null;
      const current = traversalContext(context, traversal);
      const scroller = current.scroller;
      const previousHeight = Number(traversal.lastScrollHeight) || 0;
      const { start } = traversalBounds(scroller, traversal.order);
      readOnlyTraversals.get(traversal)?.check(true);
      scroller.scrollTop = start;
      dispatch(scroller, new Event('scroll', { bubbles: true }));
      await delay(5, signal);

      const refreshed = traversalContext(context, traversal);
      if (refreshed.scroller !== scroller) continue;
      const refreshedStart = traversalBounds(scroller, traversal.order).start;
      const actualPosition = Number(scroller.scrollTop);
      const currentHeight = Number(scroller.scrollHeight) || 0;
      if (!Number.isFinite(actualPosition) || Math.abs(actualPosition - refreshedStart) > 1) {
        traversal.lastScrollTop = null;
        traversal.lastScrollHeight = currentHeight;
        continue;
      }
      if (currentHeight > previousHeight + 1) traversal.lastSearchGrew = true;
      traversal.lastScrollTop = actualPosition;
      traversal.lastScrollHeight = currentHeight;
      return refreshed;
    }
    traversal.lastSearchIncomplete = true;
    return null;
  }

  async function nextSentRow(
    context,
    signal,
    order = 'newest',
    traversal = createTraversal(order),
    authorizationExpiresAt = null,
  ) {
    traversal.order = order === 'oldest' ? 'oldest' : 'newest';
    traversal.lastSearchGrew = false;
    traversal.lastSearchIncomplete = false;
    traversal.lastSearchSteps = 0;

    let current = traversalContext(context, traversal);
    let scroller = current.scroller;
    const startingHeight = Number(scroller?.scrollHeight) || 0;
    if (traversal.lastScrollHeight && startingHeight + 1 < traversal.lastScrollHeight) {
      // A successful Unsend can shrink the scroll range. Resume from the
      // requested edge instead of retaining an offset outside the new range.
      traversal.lastScrollTop = null;
      if (traversal.order === 'oldest') traversal.oldestBoundaryProven = false;
    }
    traversal.lastScrollHeight = startingHeight;

    if (traversal.order === 'oldest' && !traversal.oldestBoundaryProven) {
      // Instagram can replace or shrink its virtual scroller after a removal.
      // Do not expose another oldest candidate until that new edge has remained
      // stable under the same bounded proof used before the first action.
      let provenContext = null;
      for (let attempt = 0; attempt < MAX_SCAN_PASSES; attempt += 1) {
        provenContext = await proveStableOldestBoundary(
          context,
          traversal,
          signal,
          authorizationExpiresAt,
        );
        const verifiedContext = traversalContext(provenContext, traversal);
        if (traversal.oldestBoundaryProven) {
          current = verifiedContext;
          scroller = verifiedContext.scroller;
          break;
        }
      }
      if (!traversal.oldestBoundaryProven || !provenContext) {
        throw new Error('The oldest conversation boundary changed before the next message could be selected.');
      }
    } else if (!Number.isFinite(traversal.lastScrollTop)) {
      current = await reestablishTraversalEdge(context, traversal, signal);
      if (!current) return null;
      scroller = current.scroller;
    }

    // Whole-conversation cleanup keeps the original visible-first streaming
    // path. Finite scopes must not substitute an older visible message for
    // the reviewed newest target merely because that target is clipped.
    if (traversal.preferVisible) {
      const visible = firstVisibleCandidate(scroller, traversal.order, traversal);
      if (visible && await exposeRow(visible, scroller, signal, traversal)) return visible;
    }
    const [mounted] = orderedCandidates(scroller, traversal.order, traversal);
    if (mounted && await exposeRow(mounted, scroller, signal, traversal)) return mounted;
    if (mounted && readOnlyTraversals.has(traversal)
      && (!mounted.isConnected || traversalContext(context, traversal).scroller !== scroller)) {
      traversal.lastSearchIncomplete = true;
      return null;
    }
    if (mounted && !traversal.preferVisible) throw new Error('The next message could not be brought into view. Nothing else was selected.');

    for (let pass = 0; pass < MAX_SCAN_PASSES; pass += 1) {
      if (signal.aborted) return null;
      const stop = context.threadId ? sessionStop(context.threadId) : null;
      if (stop) throw new Error(stop);
      current = traversalContext(context, traversal);
      scroller = current.scroller;
      const heightBeforePass = Number(scroller?.scrollHeight) || 0;
      const { start, end, direction } = traversalBounds(scroller, traversal.order);
      const range = Math.abs(end - start);
      // Never jump farther than one third of the mounted viewport. Instagram's
      // virtual list can recycle every row between scroll events; overlapping
      // windows prevent sparse sent messages from falling between coarse steps.
      const viewportStep = Math.floor((Number(scroller?.clientHeight) || 90) / 3);
      const step = range < 500 ? 30 : Math.max(30, Math.min(150, viewportStep));
      let position = pass === 0 && Number.isFinite(traversal.lastScrollTop)
        ? Math.max(Math.min(traversal.lastScrollTop, Math.max(start, end)), Math.min(start, end))
        : start;

      while (traversal.lastSearchSteps < MAX_SCROLL_STEPS_PER_SEARCH) {
        if (signal.aborted) return null;
        readOnlyTraversals.get(traversal)?.check(true);
        const stepStop = context.threadId ? sessionStop(context.threadId) : null;
        if (stepStop) throw new Error(stepStop);
        traversal.lastScrollTop = position;
        scroller.scrollTop = position;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        traversal.lastSearchSteps += 1;
        await delay(5, signal);

        if (readOnlyTraversals.has(traversal)) {
          const refreshed = traversalContext(context, traversal);
          if (refreshed.scroller !== scroller) {
            traversal.lastSearchIncomplete = true;
            return null;
          }
        }

        const row = traversal.preferVisible
          ? firstVisibleCandidate(scroller, traversal.order, traversal)
          : orderedCandidates(scroller, traversal.order, traversal)[0];
        if (row && await exposeRow(row, scroller, signal, traversal)) {
          traversal.lastScrollHeight = Number(scroller?.scrollHeight) || heightBeforePass;
          return row;
        }
        if (row && readOnlyTraversals.has(traversal)
          && (!row.isConnected || traversalContext(context, traversal).scroller !== scroller)) {
          traversal.lastSearchIncomplete = true;
          return null;
        }
        if (row && !traversal.preferVisible) throw new Error('The next message could not be brought into view. Nothing else was selected.');
        if (position === end) break;
        position = direction > 0
          ? Math.min(end, position + step)
          : Math.max(end, position - step);
      }

      const heightAfterPass = Number(scroller?.scrollHeight) || 0;
      if (heightAfterPass > heightBeforePass + 1) traversal.lastSearchGrew = true;
      if (heightAfterPass + 1 < heightBeforePass) {
        traversal.lastScrollTop = null;
        if (traversal.order === 'oldest') traversal.oldestBoundaryProven = false;
      }
      traversal.lastScrollHeight = heightAfterPass;
      if (traversal.lastSearchSteps >= MAX_SCROLL_STEPS_PER_SEARCH && position !== end) {
        // Resume here on the next bounded search instead of repeatedly scanning
        // only the first 300k pixels of an unusually tall conversation.
        traversal.lastSearchIncomplete = true;
        return null;
      }
      // A new pass begins at the requested edge. This is intentional: the DOM
      // can shrink, grow, or swap nodes after any edge-triggered page load.
      traversal.lastScrollTop = null;
      await delay(30, signal);
    }
    return null;
  }

  function preview(row) {
    const text = [...row.querySelectorAll?.('[dir="auto"]') || []]
      .filter((element) => !element.querySelector?.('[dir="auto"]'))
      .map(visibleText)
      .find(Boolean);
    return (text || 'Sent message').slice(0, 90);
  }

  function retainedMessageSignature(row) {
    const content = [...row?.querySelectorAll?.(
      '[dir="auto"], img, video, audio, a[href], time[datetime], [data-timestamp]',
    ) || []].map((element) => [
      element.tagName || '',
      element.matches?.('[dir="auto"]') ? visibleText(element) : '',
      ...['href', 'src', 'datetime', 'data-timestamp'].map((name) => element.getAttribute?.(name) || ''),
    ]);
    return JSON.stringify([stableMessageKey(row), preview(row), content]);
  }

  function nativeMessageGroups(root) {
    const groups = [...root?.querySelectorAll?.('[role="group"]') || []]
      .filter((group) => group.getAttribute?.('aria-label') !== 'Message actions'
        && group.querySelectorAll?.('[aria-label="Message actions"]').length === 1);
    return groups.filter((group) => !groups.some((other) => (
      other !== group && other.contains?.(group)
    )));
  }

  function nativeRemovalNeighborhood(row, root) {
    const groups = nativeMessageGroups(root);
    const targets = groups.filter((group) => group === row || row?.contains?.(group));
    if (targets.length !== 1) return null;
    return {
      target: targets[0],
      row,
      entries: groups.map((element) => ({ element, parent: element.parentElement, signature: retainedMessageSignature(element) })),
    };
  }

  function removalScrollStayed(before) {
    return before.scrollers.every(({ element, top, height, client }) => {
      if (!element.isConnected) return false;
      const afterTop = Number(element.scrollTop) || 0;
      if (Math.abs(afterTop - top) <= 2) return true;
      // At the bottom of a normal list, native scroll anchoring follows a
      // shrinking range. This is not navigation to a different virtual window.
      const afterEnd = Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight));
      const beforeEnd = Math.max(0, height - client);
      return beforeEnd > 0 && Math.abs(top - beforeEnd) <= 2
        && Math.abs(afterTop - afterEnd) <= 2 && afterEnd < beforeEnd;
    });
  }

  function nativeRemovalProven(before) {
    const native = before.native;
    if (!native || native.row.isConnected || native.target.isConnected
      || !before.parent?.isConnected || !removalScrollStayed(before)) return false;
    const targetIndex = native.entries.findIndex(({ element }) => element === native.target);
    const left = native.entries.slice(Math.max(0, targetIndex - 2), targetIndex);
    const right = native.entries.slice(targetIndex + 1, targetIndex + 3);
    const retained = [...left, ...right];
    if (retained.length < 2) return shortNativeRemovalProven(before);
    const after = nativeMessageGroups(before.root);
    let previous = -1;
    for (const { element, signature } of retained) {
      const index = after.indexOf(element);
      if (index <= previous || !element.isConnected
        || retainedMessageSignature(element) !== signature) return false;
      // Backfill may append older history outside this anchored neighborhood,
      // but an inserted/recycled message inside it is not removal evidence.
      if (previous >= 0 && index !== previous + 1) return false;
      previous = index;
    }
    const signature = native.entries[targetIndex].signature;
    // A remount of the same payload inside the anchors is not a removal.
    const first = after.indexOf(retained[0].element);
    const last = after.indexOf(retained[retained.length - 1].element);
    const bounded = after.slice(first, last + 1);
    const countBefore = retained.filter((entry) => entry.signature === signature).length;
    return bounded.filter((element) => retainedMessageSignature(element) === signature).length === countBefore
      && !after.some((element) => !native.entries.some((entry) => entry.element === element)
        && retainedMessageSignature(element) === signature);
  }

  function shortNativeRemovalProven(before) {
    const native = before.native, layout = before.shortLayout;
    if (!native || native.entries.length > 2 || !layout || before.scrollers.length
      || before.root?.getAttribute?.('data-pagelet') !== 'IGDMessagesList'
      || !isVisible(before.root) || before.root.closest?.('[hidden], [aria-hidden="true"]')
      || before.root.querySelector?.('[aria-busy="true"]')
      || layout.frames.at(-1)?.element !== before.root) return false;
    const panes = [...before.root.ownerDocument?.querySelectorAll?.('[data-pagelet="IGDMessagesList"]') || []].filter(isVisible);
    if (panes.length && (panes.length !== 1 || panes[0] !== before.root)) return false;
    // This path is only for a fully mounted short list, not the last visible
    // window of a scrollable history. At least one measured viewport must stay
    // fixed while its inner content may shrink after the removal.
    if (!layout.frames.some(({ element, client }) => client > 0
      && Math.abs(Number(element.clientHeight) - client) <= 1)) return false;
    if (layout.frames.some(({ element, parent, top, height, client }) => (
      !element.isConnected || (element.parentElement || null) !== parent
      || !Number.isFinite(height) || !Number.isFinite(client) || height < 0 || client < 0 || height > client + 1
      || !Number.isFinite(Number(element.scrollHeight)) || !Number.isFinite(Number(element.clientHeight))
      || Number(element.scrollHeight) > Number(element.clientHeight) + 1
      || Number(element.scrollHeight) > height + 1 || Number(element.clientHeight) > client + 1
      || Math.abs((Number(element.scrollTop) || 0) - top) > 1
      || element.getAttribute?.('aria-busy') === 'true'
    ))) return false;
    const retained = native.entries.filter(({ element }) => element !== native.target);
    const after = nativeMessageGroups(before.root);
    if (after.length !== retained.length || retained.some(({ element, parent, signature }, index) => (
      after[index] !== element || !element.isConnected || element.parentElement !== parent
      || retainedMessageSignature(element) !== signature
    ))) return false;
    const remaining = [...before.parent.children || []];
    const siblings = layout.siblings.filter(({ element }) => element.isConnected && element.parentElement === before.parent);
    // A removed timestamp is harmless. A new/recycled slot, changed metadata
    // or missing neighboring message is not evidence of a successful Unsend.
    return remaining.length === siblings.length
      && siblings.every(({ element, signature, text }, index) => remaining[index] === element
        && retainedMessageSignature(element) === signature && String(element.textContent || '') === text)
      && layout.siblings.every((entry) => !entry.hasMessage || siblings.includes(entry));
  }

  function removalEvidence(row) {
    const parent = row?.parentElement || null;
    const root = row?.closest?.("[data-pagelet='IGDMessagesList']") || parent;
    const scrollers = [], frames = [];
    for (let element = parent; element; element = element.parentElement) {
      frames.push({ element, parent: element.parentElement || null, top: Number(element.scrollTop) || 0,
        height: Number(element.scrollHeight), client: Number(element.clientHeight) });
      if (Number(element.scrollHeight) > Number(element.clientHeight)) {
        scrollers.push({ element, top: Number(element.scrollTop) || 0,
          height: Number(element.scrollHeight), client: Number(element.clientHeight) });
      }
      if (element === root) break;
    }
    const siblings = [...parent?.children || []].filter((element) => element !== row);
    const native = nativeRemovalNeighborhood(row, root);
    return {
      key: stableMessageKey(row),
      text: preview(row),
      connected: Boolean(row?.isConnected),
      parent,
      root,
      scrollers,
      siblings,
      siblingSignatures: siblings.map(retainedMessageSignature),
      native,
      shortLayout: native && native.entries.length <= 2 && !visibleLoader(root)
        && !root?.querySelector?.('[aria-busy="true"]')
        && root?.getAttribute?.('aria-busy') !== 'true' ? {
          frames,
          siblings: siblings.map((element) => ({ element, signature: retainedMessageSignature(element),
            text: String(element.textContent || ''),
            hasMessage: element.matches?.('[aria-label="Message actions"]')
              || Boolean(element.querySelector?.('[aria-label="Message actions"]')) })),
        } : null,
    };
  }

  function removalProven(row, before) {
    if (!before?.connected) return false;
    const root = before.root;
    if (root && (!root.isConnected || visibleLoader(root) || root.getAttribute?.('aria-busy') === 'true')) return false;
    // Instagram may remove the message and its timestamp together, backfill
    // older rows, and unmount far-off content. Use the exact detached message
    // row and its retained native neighbors, not every layout child.
    const isPlaceholder = (candidate) => {
      const text = normalizePlaceholder(preview(candidate));
      if (normalizePlaceholder(before.text) === text) return false;
      return ['you unsent a message', 'you unsent this message', 'message unsent'].includes(text)
        && !candidate.querySelector?.('img, video, audio, [aria-haspopup="menu"]')
        && !actionButton(candidate);
    };
    if (row?.isConnected) {
      if (stableMessageKey(row) !== before.key) return false;
      return isPlaceholder(row);
    }
    if (!before.key && before.native) return nativeRemovalProven(before);
    if (before.key) {
      const matches = [...root?.querySelectorAll?.('[data-message-id], [data-item-id]') || []]
        .filter((candidate) => stableMessageKey(candidate) === before.key);
      if (matches.length) return matches.length === 1 && isPlaceholder(matches[0]);
    }
    if (!before.parent?.isConnected) return false;
    if (before.scrollers.some(({ element, top }) => (
      !element.isConnected || Math.abs((Number(element.scrollTop) || 0) - top) > 2
    ))) return false;
    if (before.key) return true;
    // Without a logical ID, prove the exact row disappeared while every
    // neighboring message stayed unchanged and in order. Duplicate text and
    // media-only previews do not make a surviving neighbor the removed row.
    const remaining = [...before.parent.children || []];
    return remaining.length === before.siblings.length
      && before.siblings.every((element, index) => element === remaining[index]
        && element.isConnected && element.parentElement === before.parent
        && retainedMessageSignature(element) === before.siblingSignatures?.[index]);
  }

  function normalizePlaceholder(text) {
    return actionLabels.normalizeActionLabel(text).replace(/[.!]$/u, '');
  }

  async function waitForRemoval(row, before, {
    dialogButton = null,
    contextValid = () => true,
    timeoutMs = 5_000,
    stableMs = 350,
    signal = null,
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    let stableSince = null;
    while (Date.now() < deadline) {
      if (!contextValid()) return false;
      const dialogClosed = !dialogButton || !dialogButton.isConnected || !isVisible(dialogButton);
      if (dialogClosed && removalProven(row, before)) {
        if (stableSince === null) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return true;
      } else stableSince = null;
      await delay(Math.min(75, Math.max(0, deadline - Date.now())), signal);
    }
    return false;
  }

  function createMessageWalker({
    threadId,
    expiresAt,
    signal = null,
    order = 'newest',
    maxSteps = 18_000,
    timeoutMs = 20 * 60_000,
    holdUntilClosed = false,
  } = {}) {
    const error = (code, message) => Object.assign(new Error(message), { code });
    if (activeController || activeMessageWalker) {
      throw error('DM_WALKER_BUSY', 'Another conversation operation is already active.');
    }
    const startedAt = Date.now();
    if (typeof threadId !== 'string' || !threadId || !['newest', 'oldest'].includes(order)
      || !Number.isFinite(expiresAt) || expiresAt <= startedAt
      || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 250_000
      || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 20 * 60_000
      || typeof holdUntilClosed !== 'boolean'
      || (signal && (typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) {
      throw error('DM_WALKER_INVALID', 'A bounded, exact-conversation message pass is required.');
    }
    if (signal?.aborted) throw error('DM_WALKER_ABORTED', 'The message pass was stopped.');
    const initial = threadContext();
    if (!initial.ok || initial.threadId !== threadId) {
      throw error('DM_WALKER_CONTEXT', initial.reason || 'The conversation changed.');
    }
    const deadline = Math.min(expiresAt, startedAt + timeoutMs);
    const controller = new AbortController();
    const traversal = createTraversal(order);
    const seenKeys = new Set();
    const seenPositions = new Map();
    const seenNodes = new WeakMap();
    let steps = 0, visited = 0, emptyPasses = 0, changingPasses = 0;
    let status = 'ready', reason = null, closed = false, pending = false;
    let deadlineTimer = null, unwatch = () => {};
    const state = () => ({ status, reason, visited, steps,
      coverage: status === 'completed' ? 'exhausted' : visited ? 'partial' : 'unknown' });
    const done = () => ({ done: true, value: undefined, ...state() });
    const finish = (nextStatus, nextReason) => {
      if (closed) return false;
      closed = true; status = nextStatus; reason = nextReason;
      clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', abortExternal);
      controller.signal.removeEventListener('abort', abortInternal);
      unwatch();
      if (!controller.signal.aborted) controller.abort(nextReason);
      if (activeMessageWalker === api && (!holdUntilClosed || nextStatus === 'completed')) activeMessageWalker = null;
      return true;
    };
    const abortExternal = () => controller.abort('DM_WALKER_ABORTED');
    const deadlineReason = () => expiresAt <= Date.now()
      ? 'DM_WALKER_EXPIRED'
      : 'DM_WALKER_TIMEOUT';
    const abortInternal = () => {
      const explicitReason = controller.signal.reason;
      const timedReason = explicitReason === 'DM_WALKER_EXPIRED' || explicitReason === 'DM_WALKER_TIMEOUT'
        ? explicitReason
        : null;
      finish('stopped', timedReason || (Date.now() >= deadline
        ? deadlineReason()
        : currentThreadId() !== threadId ? 'DM_WALKER_CONTEXT'
          : lifecycleReason(controller.signal) || 'DM_WALKER_ABORTED'));
    };
    const abortAtDeadline = () => {
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        deadlineTimer = setTimeout(abortAtDeadline, remaining);
        return;
      }
      controller.abort(deadlineReason());
    };
    const check = (step = false) => {
      if (Date.now() >= deadline) {
        throw error(expiresAt <= Date.now() ? 'DM_WALKER_EXPIRED' : 'DM_WALKER_TIMEOUT', 'The message pass expired.');
      }
      const restriction = sessionStop(threadId);
      if (restriction) throw error('DM_WALKER_CONTEXT', restriction);
      if (closed || controller.signal.aborted || signal?.aborted) {
        throw error(reason || 'DM_WALKER_ABORTED', 'The message pass was stopped.');
      }
      if (step && ++steps > maxSteps) throw error('DM_WALKER_LIMIT', 'The bounded message pass reached its traversal limit.');
    };
    const position = (row, scroller) => {
      const top = Number(row.getBoundingClientRect?.()?.top);
      const origin = Number(scroller.getBoundingClientRect?.()?.top);
      const scroll = Number(scroller.scrollTop);
      return Number.isFinite(top) && Number.isFinite(origin) && Number.isFinite(scroll)
        ? Math.round(top - origin + scroll) : null;
    };
    const wasVisited = (row, scroller) => {
      const key = stableMessageKey(row);
      if (key) return seenKeys.has(key);
      const signature = retainedMessageSignature(row);
      const offset = position(row, scroller);
      return offset === null ? seenNodes.get(row) === signature
        : [...seenPositions.get(signature) || []].some((known) => Math.abs(known - offset) <= 2);
    };
    const remember = (row, scroller) => {
      const key = stableMessageKey(row);
      if (key) seenKeys.add(key);
      else {
        const signature = retainedMessageSignature(row), offset = position(row, scroller);
        seenNodes.set(row, signature);
        if (offset !== null) {
          if (!seenPositions.has(signature)) seenPositions.set(signature, new Set());
          seenPositions.get(signature).add(offset);
        }
      }
      visited += 1;
      return key;
    };
    readOnlyTraversals.set(traversal, { check, visited: wasVisited });
    const api = Object.freeze({
      snapshot: state,
      signal: controller.signal,
      assertCurrent: () => { check(); return true; },
      stop: () => {
        if (closed) return false;
        controller.abort('DM_WALKER_ABORTED');
        return true;
      },
      close: () => {
        const held = activeMessageWalker === api;
        const changed = finish('stopped', 'closed');
        if (held) activeMessageWalker = null;
        return held || changed;
      },
      async next() {
        if (pending) throw error('DM_WALKER_BUSY', 'The preceding message read has not settled.');
        if (closed) return done();
        pending = true; status = 'walking';
        try {
          for (;;) {
            check(true);
            const context = threadContext();
            if (!context.ok || context.threadId !== threadId) {
              throw error('DM_WALKER_CONTEXT', context.reason || 'The conversation changed.');
            }
            const row = await nextSentRow(context, controller.signal, order, traversal, deadline);
            check();
            const current = traversalContext(context, traversal);
            if (row && row.isConnected && current.scroller.contains?.(row)) {
              emptyPasses = 0; changingPasses = 0;
              if (wasVisited(row, current.scroller)) continue;
              const key = remember(row, current.scroller);
              status = 'ready';
              return { done: false, value: Object.freeze({ row, key, threadId }) };
            }
            if (row || traversal.lastSearchGrew || traversal.lastSearchIncomplete || visibleLoader(current.root)) {
              emptyPasses = 0;
              if (++changingPasses > MAX_EMPTY_GROWTH_ROUNDS) {
                throw error('DM_WALKER_UNSTABLE', 'The conversation did not reach a stable end.');
              }
            } else if (++emptyPasses >= STABLE_EMPTY_PASSES) {
              finish('completed', 'stable-exhaustion');
              return done();
            }
            await delay(160, controller.signal);
          }
        } catch (failure) {
          finish('error', failure.code || 'DM_WALKER_INTERRUPTED');
          throw failure;
        } finally {
          pending = false;
        }
      },
    });
    activeMessageWalker = api;
    controller.signal.addEventListener('abort', abortInternal, { once: true });
    signal?.addEventListener('abort', abortExternal, { once: true });
    try {
      unwatch = watchThread(controller, threadId);
      deadlineTimer = setTimeout(abortAtDeadline, Math.max(0, deadline - Date.now()));
      check();
    } catch (failure) {
      finish('error', failure.code || 'DM_WALKER_INTERRUPTED');
      api.close();
      throw failure;
    }
    return api;
  }

  async function inspectAll() {
    if (activeController || activeMessageWalker) {
      return { ready: false, reason: 'Another message check or run is already active.' };
    }
    const context = threadContext();
    if (!context.ok) return { ready: false, reason: context.reason };
    const controller = new AbortController();
    activeController = controller;
    const unwatch = watchThread(controller, context.threadId);
    publish({
      status: 'preparing',
      operation: 'check',
      needsAttention: false,
      interruptionReason: null,
      uncertain: 0,
      processed: 0,
      failed: 0,
      message: 'Checking the full conversation without opening a message menu…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });
    try {
      const history = await loadAllHistory(context, controller.signal);
      const detectedCount = Math.min(MAX_PLAN_MESSAGES, history.detectedCount);
      const result = Object.freeze({
        ready: true,
        threadId: context.threadId,
        detectedCount,
        countExact: false,
        complete: history.complete,
        pagesChecked: history.pagesChecked,
        reason: history.complete
          ? `At least ${detectedCount} sent message${detectedCount === 1 ? '' : 's'} detected. Instagram may keep other messages outside the mounted window.`
          : 'The bounded read-only check ended before the oldest history boundary was proven.',
        checkedAt: new Date().toISOString(),
      });
      publish({
        status: 'reviewed',
        message: result.reason,
        current: null,
        canStop: false,
        finishedAt: result.checkedAt,
      });
      return result;
    } catch (error) {
      const interrupted = lifecycleReason(controller.signal);
      const reason = interrupted
        ? 'Page interrupted. Run Check conversation again when the tab is ready.'
        : error?.name === 'AbortError' || controller.signal.aborted
        ? 'Conversation check stopped.'
        : error.message || 'The conversation could not be checked.';
      publish({
        status: interrupted ? 'needs-attention' : error?.name === 'AbortError' || controller.signal.aborted ? 'stopped' : 'error',
        needsAttention: Boolean(interrupted),
        interruptionReason: interrupted,
        message: reason,
        current: null,
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return { ready: false, reason };
    } finally {
      unwatch();
      if (activeController === controller) activeController = null;
    }
  }

  async function start(options = {}) {
    if (activeMessageWalker) throw Object.assign(new Error('A read-only message pass is already active.'), { code: 'DM_WALKER_BUSY' });
    if (activeController) return snapshot();
    const workerAdapter = options.workerAdapter;
    if (workerAdapter !== undefined && (!workerAdapter
      || typeof workerAdapter.execute !== 'function' || typeof workerAdapter.assertAction !== 'function'
      || typeof workerAdapter.assertContext !== 'function'
      || !workerAdapter.signal || typeof workerAdapter.signal.aborted !== 'boolean'
      || typeof workerAdapter.signal.addEventListener !== 'function'
      || typeof workerAdapter.signal.removeEventListener !== 'function')) {
      publish({ status: 'error', message: 'The reviewed worker adapter is unavailable.', canStop: false });
      return snapshot();
    }
    const plan = validatePlan(options.plan);
    if (!plan) {
      publish({
        status: 'error',
        message: 'A fresh, thread-specific reviewed plan is required before Unsend can start.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }
    if (options.speed !== undefined && options.speed !== plan.speed) {
      publish({ status: 'error', message: 'Refresh the review before changing speed.', canStop: false });
      return snapshot();
    }
    const context = threadContext();
    if (!context.ok) {
      publish({ status: 'error', message: context.reason, canStop: false, finishedAt: new Date().toISOString() });
      return snapshot();
    }
    const expectedThreadId = plan.threadId;
    if (!expectedThreadId || context.threadId !== expectedThreadId) {
      publish({
        status: 'error',
        message: 'Thread-specific live authorization is required before Unsend can start.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }

    const now = Date.now();
    for (const [digest, expiresAt] of consumedPlanDigests) {
      if (expiresAt <= now) consumedPlanDigests.delete(digest);
    }
    if (consumedPlanDigests.has(plan.reviewedDigest)) {
      publish({
        status: 'error',
        message: 'This reviewed Unsend plan was already used.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }
    consumedPlanDigests.set(plan.reviewedDigest, plan.expiresAt);
    while (consumedPlanDigests.size > 128) {
      consumedPlanDigests.delete(consumedPlanDigests.keys().next().value);
    }

    const controller = new AbortController();
    activeController = controller;
    activeExecution = {
      workerAdapter,
      workerRow: null,
      onPhaseTiming: typeof options.onPhaseTiming === 'function' ? options.onPhaseTiming : null,
      phaseTimings: {
        historyLoading: 0, messageResolution: 0, menuReadiness: 0,
        confirmationReadiness: 0, verification: 0, pacing: 0, checkpoint: 0,
      },
    };
    const signal = controller.signal;
    const abortWorker = () => controller.abort(workerAdapter.signal.reason || 'Worker stopped');
    workerAdapter?.signal.addEventListener('abort', abortWorker, { once: true });
    if (workerAdapter?.signal.aborted) abortWorker();
    const unwatch = watchThread(controller, expectedThreadId);
    const maxFailures = Math.max(1, Math.min(10, Number(options.maxConsecutiveFailures) || DEFAULT_MAX_FAILURES));
    const authorizationExpiresAt = plan.expiresAt;
    // "all" is intentionally not bound to a virtual-DOM count. This ceiling
    // is only a catastrophic-loop guard, not a daily or user-facing quota.
    const maxMessages = plan.limit === null ? MAX_PLAN_MESSAGES : plan.limit;
    const order = plan.scope === 'oldest' ? 'oldest' : 'newest';
    const traversal = createTraversal(order);
    traversal.preferVisible = plan.scope === 'all';
    let processed = 0;
    let failed = 0;
    let retryAttempts = 0;
    let consecutiveFailures = 0;
    let lastUnsendAt = 0;
    let stableEmptyPasses = 0;
    let emptyGrowthRounds = 0;
    let exhausted = false;

    publish({
      status: 'preparing',
      operation: 'unsend',
      needsAttention: false,
      interruptionReason: null,
      uncertain: 0,
      processed: 0,
      failed: 0,
      retryAttempts: 0,
      consecutiveFailures: 0,
      current: null,
      message: 'Finding sent messages…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });

    try {
      let initialContext = traversalContext(context, traversal);
      if (plan.scope === 'oldest') {
        publish({
          status: 'preparing',
          current: null,
          message: 'Finding the oldest message boundary…',
        });
        initialContext = await proveStableOldestBoundary(
          context,
          traversal,
          signal,
          authorizationExpiresAt,
        );
      } else {
        const initialBounds = traversalBounds(initialContext.scroller, order);
        initialContext.scroller.scrollTop = initialBounds.start;
        dispatch(initialContext.scroller, new Event('scroll', { bubbles: true }));
        await delay(80, signal);
      }

      while (!signal.aborted && processed < maxMessages && consecutiveFailures < maxFailures) {
        if (authorizationExpiresAt <= Date.now()) {
          throw new Error('Live authorization expired before the next message.');
        }
        const stop = sessionStop(expectedThreadId);
        if (stop) throw new Error(stop);
        // Instagram can replace the virtualized message scroller while history
        // is loading or after an Unsend. Reacquire it before every message so a
        // detached container cannot turn a real plan into a false zero-item run.
        const currentContext = threadContext();
        if (!currentContext.ok || currentContext.threadId !== expectedThreadId) {
          throw new Error(currentContext.reason || 'The reviewed conversation changed.');
        }
        const row = await measurePhase('historyLoading', () => nextSentRow(
          currentContext,
          signal,
          order,
          traversal,
          authorizationExpiresAt,
        ));
        if (!row) {
          if (traversal.lastSearchGrew || traversal.lastSearchIncomplete) {
            emptyGrowthRounds += 1;
            if (emptyGrowthRounds > MAX_EMPTY_GROWTH_ROUNDS) {
              throw new Error('The conversation kept changing before a stable end could be reached.');
            }
            stableEmptyPasses = 0;
            publish({
              status: 'preparing',
              current: null,
              message: 'Checking newly loaded messages…',
            });
            await delay(120, signal);
            continue;
          }
          stableEmptyPasses += 1;
          if (stableEmptyPasses < STABLE_EMPTY_PASSES) {
            publish({
              status: 'preparing',
              current: null,
              message: 'Checking for more sent messages…',
            });
            await delay(160, signal);
            continue;
          }
          exhausted = true;
          break;
        }
        stableEmptyPasses = 0;
        emptyGrowthRounds = 0;
        const label = preview(row);
        const keyBeforeRemoval = stableMessageKey(row);
        const traversalBeforeRemoval = {
          scroller: currentContext.scroller,
          scrollHeight: Number(currentContext.scroller?.scrollHeight) || 0,
        };
        const elapsed = Date.now() - lastUnsendAt;
        const wait = lastUnsendAt
          ? Math.max(0, randomDelay(options.minDelayMs, options.maxDelayMs) - elapsed)
          : 0;
        if (wait) {
          publish({
            status: 'waiting',
            current: label,
            message: `Waiting ${(wait / 1_000).toFixed(1)}s before the next message…`,
          });
          await measurePhase('pacing', () => delay(wait, signal));
        }
        if (authorizationExpiresAt <= Date.now()) {
          throw new Error('Live authorization expired before the next message.');
        }

        publish({ status: 'running', current: label, message: `Unsending message ${processed + 1}…` });
        let removalVerified = false;
        let workerStopReason = null;
        try {
          // unsendRow already proves the removal: the confirmation dialog
          // closed and the row either went away or lost its content and menu.
          // Re-checking isConnected here rejected every success, because
          // Instagram leaves an "unsent" placeholder row in the thread.
          if (workerAdapter) {
            activeExecution.workerRow = row;
            const result = await workerAdapter.execute({
              candidate: workerCandidate(row),
              threadId: expectedThreadId,
              signal,
              execute: async () => {
                await unsendRow(row, signal, expectedThreadId, authorizationExpiresAt);
                return { verified: true };
              },
            });
            if (result?.verified !== true) {
              const error = new Error('The worker removal outcome is uncertain. Review this conversation.');
              error.code = 'DM_OUTCOME_UNCERTAIN';
              throw error;
            }
            workerStopReason = result.stopReason || null;
          } else {
            await unsendRow(row, signal, expectedThreadId, authorizationExpiresAt);
          }
          removalVerified = true;
        } catch (error) {
          if (workerAdapter || error?.code === 'DM_WORKER_STOP') throw error;
          if (error?.code === 'DM_OUTCOME_UNCERTAIN') throw error;
          if (signal.aborted) throw error;
          retryAttempts += 1;
          consecutiveFailures += 1;
          if (consecutiveFailures >= maxFailures) failed += 1;
          const backoff = Math.min(15_000, 1_000 * (2 ** (consecutiveFailures - 1)));
          publish({
            status: 'waiting',
            failed,
            retryAttempts,
            consecutiveFailures,
            current: label,
            message: consecutiveFailures >= maxFailures
              ? `Could not remove this message after ${consecutiveFailures} attempts.`
              : `Could not remove this message. Retrying in ${Math.round(backoff / 1_000)}s (${consecutiveFailures}/${maxFailures})…`,
          });
          if (consecutiveFailures >= maxFailures) break;
          await delay(backoff, signal);
          continue;
        }
        if (removalVerified) {
          processed += 1;
          consecutiveFailures = 0;
          lastUnsendAt = Date.now();
          markProcessedRow(row, traversal, keyBeforeRemoval);
          const afterRemovalContext = threadContext();
          if (!afterRemovalContext.ok || afterRemovalContext.threadId !== expectedThreadId) {
            throw new Error(afterRemovalContext.reason || 'The reviewed conversation changed.');
          }
          resetTraversalAfterRemoval(traversal, afterRemovalContext.scroller, traversalBeforeRemoval);
          if (typeof options.onVerifiedRemoval === 'function') {
            await measurePhase('checkpoint', () => options.onVerifiedRemoval(Object.freeze({
              processed,
              failed,
              retryAttempts,
              threadId: expectedThreadId,
              reviewedDigest: plan.reviewedDigest,
            })));
          }
          publish({
            status: signal.aborted ? 'stopping' : 'running',
            processed,
            failed,
            retryAttempts,
            consecutiveFailures,
            current: null,
            message: `${processed} message${processed === 1 ? '' : 's'} unsent`,
          });
          if (workerStopReason) controller.abort(workerStopReason);
        }
      }

      if (signal.aborted) {
        publish(interruptionState(signal, processed, failed));
      } else if (consecutiveFailures >= maxFailures) {
        publish({
          status: 'error',
          message: `Stopped after ${consecutiveFailures} consecutive failures. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else if (plan.limit === null && processed >= MAX_PLAN_MESSAGES && !exhausted) {
        publish({
          status: 'error',
          message: `Safety stop after ${processed} verified removals. Start a fresh run to continue.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else {
        const shortfall = plan.limit !== null && processed < plan.limit && exhausted;
        publish({
          status: 'completed',
          message: shortfall
            ? `Done. ${processed} message${processed === 1 ? '' : 's'} unsent; no more sent messages were found.`
            : `Done. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (lifecycleReason(signal)) {
        publish(interruptionState(signal, processed, failed, error?.code === 'DM_OUTCOME_UNCERTAIN'));
      } else if (error?.code !== 'DM_OUTCOME_UNCERTAIN' && (error?.name === 'AbortError' || signal.aborted)) {
        publish(interruptionState(signal, processed, failed));
      } else {
        publish({
          status: 'error',
          uncertain: error?.code === 'DM_OUTCOME_UNCERTAIN' ? 1 : 0,
          message: `${error.message || 'The conversation changed unexpectedly.'} ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      }
    } finally {
      workerAdapter?.signal.removeEventListener('abort', abortWorker);
      unwatch();
      if (activeController === controller) activeController = null;
      activeExecution = null;
      for (const row of document.querySelectorAll(`[${ACTIVE_ATTRIBUTE}]`)) row.removeAttribute(ACTIVE_ATTRIBUTE);
    }
    return snapshot();
  }

  function stop() {
    if (activeMessageWalker) return activeMessageWalker.stop();
    if (!activeController || activeController.signal.aborted) return false;
    publish({ status: 'stopping', message: 'Stopping after the current step…', canStop: false });
    activeController.abort('Stopped by user');
    return true;
  }

  function inspect() {
    const context = threadContext();
    if (!context.ok) return { ready: false, reason: context.reason, visibleSent: 0 };
    return {
      ready: true,
      reason: 'Conversation ready',
      threadId: context.threadId,
      visibleSent: candidateRows(context.scroller).filter(isVisible).length,
      scrollable: context.scroller.scrollHeight > context.scroller.clientHeight + 50,
    };
  }

  const messageProof = Object.freeze({ sentByCurrentUser, removalEvidence, removalProven, waitForRemoval });
  const publicApi = { createPlan, createMessageWalker, inspect, inspectAll, snapshot, start, stop, subscribe, messageProof };
  if (globalThis.__instaToolboxTestHooks === true) {
    publicApi.__test = Object.freeze({
      candidateRows,
      createTraversal,
      deepestMessageContainer,
      advanceHistoryProgress,
      actionButton,
      isDmMessageOptionsControl,
      currentThreadId,
      hasMessageContent,
      isVisible,
      markProcessedRow,
      messageFingerprint,
      nextSentRow,
      oldestBoundarySnapshot,
      orderedCandidates,
      proveStableOldestBoundary,
      removalEvidence,
      removalProven,
      waitForRemoval,
      waitForElement,
      delay,
      reversedLayout,
      rowNeedsReposition,
      resetTraversalAfterRemoval,
      reestablishTraversalEdge,
      sentByCurrentUser,
      stableMessageKey,
      traversalBounds,
      validatePlan,
      watchThread,
      requireAuthorization,
      workerCandidate,
    });
  }
  Object.defineProperty(globalThis, 'InstaToolboxDmThreadUnsender', {
    configurable: false,
    enumerable: false,
    value: Object.freeze(publicApi),
    writable: false,
  });
})();

(() => {
  if (globalThis.__instaToolboxInspectorInstalled) return;
  const actionLabels = globalThis.__instaToolboxActionLabels;
  if (
    !actionLabels
    || typeof actionLabels.isDmUnsendLabel !== 'function'
    || typeof actionLabels.isDmMessageOptionsLabel !== 'function'
    || typeof actionLabels.normalizeActionLabel !== 'function'
    || typeof actionLabels.relationshipForLabel !== 'function'
  ) return;
  globalThis.__instaToolboxInspectorInstalled = true;

  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'challenge', 'directory', 'graphql', 'legal', 'p', 'privacy', 'reel',
    'reels', 'settings', 'static', 'stories', 'terms', 'tv', 'web',
  ]);
  const PROFILE_RESOLUTION_TTL_MS = 20_000;
  const DM_RESOLUTION_TTL_MS = 20_000;
  const profileResolutions = new Map();
  const dmResolutions = new Map();
  const DM_MESSAGE_ID_ATTRIBUTES = Object.freeze([
    'data-message-id',
    'data-item-id',
  ]);
  const DM_TIMESTAMP_ATTRIBUTES = Object.freeze([
    'data-timestamp-ms',
    'data-timestamp',
  ]);
  const DM_ACTION_LABEL_SELECTORS = Object.freeze([
    "[aria-label^='See more options for message']",
    "[aria-label*='more options']",
    "[aria-label*='More']",
    "[aria-label*='Altre opzioni']",
    "[aria-label*='opzioni']",
    "[aria-label*='opciones']",
    "[aria-label*='options']",
    "[role='button']",
  ]);
  const INSTAGRAM_WEB_ORIGIN = 'https://www.instagram.com';
  const INSTAGRAM_WEB_APP_ID = '936619743392459';
  const INSTAGRAM_WEB_ASBD_ID = '129477';
  const RELATIONSHIP_PAGE_SIZE = 50;
  const RELATIONSHIP_MAX_PAGES = 1_000;
  const RELATIONSHIP_MAX_ACCOUNTS = 25_000;
  const RELATIONSHIP_MAX_DURATION_MS = 20 * 60 * 1_000;
  const RELATIONSHIP_REQUEST_TIMEOUT_MS = 20_000;
  const RELATIONSHIP_REQUEST_ATTEMPTS = 3;
  const RELATIONSHIP_RETRY_BASE_MS = 1_000;
  let pendingRelationshipCooldown = null;

  function normalizeUsername(value) {
    const username = String(value || '')
      .replace(/^https?:\/\/www\.instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/^\/+/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();
    return /^[a-z0-9._]{1,30}$/i.test(username) && !RESERVED.has(username)
      ? username
      : '';
  }

  function relationshipCount(...values) {
    for (const value of values) {
      if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') continue;
      const number = Number(value);
      if (Number.isSafeInteger(number) && number >= 0) return number;
    }
    return null;
  }

  function detectAuthenticatedUsername() {
    const candidates = new Set();
    const anchors = [
      ...document.querySelectorAll('a[href]'),
    ];
    for (const anchor of anchors) {
      const labels = [
        anchor.getAttribute?.('aria-label'),
        ...[...anchor.querySelectorAll?.('[aria-label], img[alt]') || []]
          .flatMap((element) => [element.getAttribute?.('aria-label'), element.getAttribute?.('alt')]),
      ]
        .map((value) => String(value || '').normalize('NFKC').toLowerCase())
        .filter(Boolean);
      if (!labels.some((label) => label === 'profile' || label.includes('profile picture'))) continue;
      const username = normalizeUsername(anchor.getAttribute?.('href'));
      if (username) candidates.add(username);
    }
    return candidates.size === 1 ? [...candidates][0] : '';
  }

  function relationshipError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function relationshipRateLimit(response, now) {
    const raw = String(response?.headers?.get?.('Retry-After') || '').trim();
    let delayMs = null;
    if (/^\d+$/.test(raw)) {
      const seconds = Number(raw);
      if (Number.isSafeInteger(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1000) delayMs = seconds * 1000;
      else delayMs = Infinity;
    } else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /i.test(raw)) {
      const date = Date.parse(raw);
      if (Number.isFinite(date)) delayMs = Math.max(0, date - now());
    }
    return Object.assign(relationshipError('rate-limited', 'Instagram asked this session to wait before loading more accounts.'), {
      retryDelayMs: delayMs,
      cooldownSource: delayMs === null ? 'fallback' : 'server',
    });
  }

  async function waitForRelationshipCooldown(cooldown, { now, signal, sleepImpl, onProgress, username, listType, pages, found, expectedCount }) {
    if (!cooldown || !pendingRelationshipCooldown || pendingRelationshipCooldown.retryAt <= now()) return;
    const { retryAt, cooldownSource, attempt } = pendingRelationshipCooldown;
    if (!Number.isFinite(retryAt) || retryAt >= cooldown.deadline) {
      const message = Number.isFinite(retryAt) && retryAt <= 8.64e15
        ? `Instagram is rate limiting this check. Next retry no earlier than ${new Date(retryAt).toISOString()}. This run has stopped; saved comparison unchanged.`
        : 'Instagram requested a longer cooldown than this run supports. This run has stopped; saved comparison unchanged.';
      throw Object.assign(relationshipError('rate-limited', message), { cooldownPending: true });
    }
    while (now() < retryAt) {
      cooldown.assertActive();
      const remainingMs = retryAt - now();
      onProgress?.(Object.freeze({
        phase: 'cooldown', username, listType, pages, found, expectedCount,
        attempt, retryAt, remainingMs, cooldownSource,
      }));
      await sleepImpl(Math.min(1000, remainingMs), signal);
    }
    cooldown.assertActive();
  }

  function assertRelationshipRunActive(signal, startedAt, now, maxDurationMs) {
    if (signal?.aborted) throw relationshipError('stopped', 'Follower check stopped.');
    if (now() - startedAt > maxDurationMs) {
      throw relationshipError('time-limit', 'The follower check reached its 20-minute read limit.');
    }
    const session = inspectSession();
    if (session.sessionExpired) throw relationshipError('session-expired', 'Instagram requires a fresh login.');
    if (session.challenge) throw relationshipError('challenge', 'Instagram opened a security challenge.');
    if (session.actionBlocked) throw relationshipError('action-blocked', 'Instagram restricted activity.');
    if (session.rateLimited) throw relationshipError('rate-limited', 'Instagram asked this session to wait.');
  }

  function relationshipDelay(ms, signal, setTimer = setTimeout, clearTimer = clearTimeout) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(relationshipError('stopped', 'Follower check stopped.'));
        return;
      }
      let timer = null;
      const stop = () => {
        if (timer !== null) clearTimer(timer);
        signal?.removeEventListener?.('abort', stop);
        reject(relationshipError('stopped', 'Follower check stopped.'));
      };
      timer = setTimer(() => {
        signal?.removeEventListener?.('abort', stop);
        resolve();
      }, ms);
      signal?.addEventListener?.('abort', stop, { once: true });
    });
  }

  function relationshipRunDeadline(sourceSignal, maxDurationMs, setTimer, clearTimer) {
    const controller = new AbortController();
    let timedOut = false;
    const stop = () => controller.abort();
    if (sourceSignal?.aborted) stop();
    else sourceSignal?.addEventListener?.('abort', stop, { once: true });
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, maxDurationMs);
    return Object.freeze({
      cleanup() {
        clearTimer(timer);
        sourceSignal?.removeEventListener?.('abort', stop);
      },
      signal: controller.signal,
      timedOut: () => timedOut,
    });
  }

  function relationshipResponseStop(data) {
    const message = String(data?.message || data?.error_type || '').toLowerCase();
    if (message.includes('challenge') || message.includes('checkpoint')) return 'challenge';
    if (message.includes('login') || message.includes('not logged')) return 'session-expired';
    if (message.includes('wait a few minutes') || message.includes('rate limit')) return 'rate-limited';
    if (message.includes('feedback_required') || message.includes('restrict certain activity')) return 'action-blocked';
    return '';
  }

  function relationshipStepWithTimeout(task, {
    clearTimer,
    setTimer,
    signal,
    timeoutMs,
  }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(relationshipError('stopped', 'Follower check stopped.'));
        return;
      }
      const controller = new AbortController();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        signal?.removeEventListener?.('abort', stop);
        callback(value);
      };
      const stop = () => {
        controller.abort();
        finish(reject, relationshipError('stopped', 'Follower check stopped.'));
      };
      const timer = setTimer(() => {
        controller.abort();
        finish(reject, relationshipError(
          'request-timeout',
          'Instagram did not finish this follower page within 20 seconds.',
        ));
      }, timeoutMs);
      signal?.addEventListener?.('abort', stop, { once: true });
      Promise.resolve()
        .then(() => task(controller.signal))
        .then((value) => finish(resolve, value))
        .catch((error) => {
          if (signal?.aborted) {
            finish(reject, relationshipError('stopped', 'Follower check stopped.'));
            return;
          }
          finish(reject, error);
        });
    });
  }

  async function fetchInstagramRelationshipJson(url, {
    clearTimer,
    cooldown = null,
    expectedCount = null,
    fetchImpl,
    found = 0,
    listType = null,
    now = Date.now,
    onProgress,
    pages = 0,
    random,
    requestAttempts,
    requestTimeoutMs,
    retryBaseMs,
    setTimer,
    signal,
    sleepImpl,
    username,
  }) {
    for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
      try {
        cooldown?.assertActive();
        await waitForRelationshipCooldown(cooldown, { now, signal, sleepImpl, onProgress, username, listType, pages, found, expectedCount });
        return await relationshipStepWithTimeout(async (attemptSignal) => {
          const response = await fetchImpl(url.href, {
            cache: 'no-store',
            credentials: 'include',
            headers: {
              'X-ASBD-ID': INSTAGRAM_WEB_ASBD_ID,
              'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
              'X-Requested-With': 'XMLHttpRequest',
            },
            method: 'GET',
            referrer: `${INSTAGRAM_WEB_ORIGIN}/${username}/`,
            referrerPolicy: 'strict-origin-when-cross-origin',
            signal: attemptSignal,
          });
          cooldown?.assertActive();
          // Error pages can be HTML. Classify status and redirects before decoding.
          if (response.status === 429) {
            throw relationshipRateLimit(response, now);
          }
          const responsePath = response.url ? new URL(response.url, url).pathname : '';
          if (/^\/(challenge|checkpoint)(\/|$)/.test(responsePath)) {
            throw relationshipError('challenge', 'Instagram opened a security challenge.');
          }
          if (response.status === 401 || /^\/accounts\/login(\/|$)/.test(responsePath)) {
            throw relationshipError('session-expired', 'Instagram requires a fresh login.');
          }
          let data = null;
          try {
            data = await response.json();
          } catch (error) {
            if (attemptSignal.aborted) throw error;
            if (error?.code === 'request-timeout' || error?.code === 'stopped') throw error;
            if (!response.ok) {
              throw relationshipError('request-failed', `Instagram could not load this account request (HTTP ${response.status || 'error'}).`);
            }
            throw relationshipError('invalid-response', 'Instagram returned an invalid account response. Reload your profile before trying again.');
          }
          const responseStop = relationshipResponseStop(data);
          if (response.status === 429 || responseStop === 'rate-limited') {
            throw relationshipRateLimit(response, now);
          }
          if (response.status === 401 || responseStop === 'session-expired') {
            throw relationshipError('session-expired', 'Instagram requires a fresh login.');
          }
          if (responseStop === 'challenge') {
            throw relationshipError('challenge', 'Instagram opened a security challenge.');
          }
          if (responseStop === 'action-blocked') {
            throw relationshipError('action-blocked', 'Instagram restricted activity.');
          }
          if (!response.ok || data?.status === 'fail') {
            throw relationshipError('request-failed', `Instagram could not load this follower page (HTTP ${response.status || 'error'}).`);
          }
          return data;
        }, { clearTimer, setTimer, signal, timeoutMs: requestTimeoutMs });
      } catch (error) {
        if (error?.code === 'rate-limited' && cooldown && !error.cooldownPending) {
          cooldown.assertActive();
          cooldown.attempts += 1;
          const delayMs = Math.max(1000, error.retryDelayMs
            ?? Math.min(60 * 60_000, 5 * 60_000 * (2 ** Math.min(cooldown.attempts - 1, 4))));
          const retryAt = now() + delayMs;
          pendingRelationshipCooldown = { retryAt, cooldownSource: error.cooldownSource || 'fallback', attempt: cooldown.attempts };
          if (cooldown.attempts > 8) {
            error.message = 'Instagram is still rate limiting this check. Automatic retries stopped; saved comparison unchanged.';
            throw error;
          }
          await waitForRelationshipCooldown(cooldown, { now, signal, sleepImpl, onProgress, username, listType, pages, found, expectedCount });
          attempt -= 1;
          continue;
        }
        let retryable = error?.code === 'request-timeout' || error?.code === 'network-error';
        if (signal?.aborted || error?.code === 'stopped') {
          throw relationshipError('stopped', 'Follower check stopped.');
        }
        if (!error?.code && error?.name === 'AbortError') {
          retryable = true;
        } else if (!error?.code) {
          retryable = true;
          error = relationshipError('network-error', 'Instagram follower data could not be reached from this tab.');
        }
        if (!retryable || attempt >= requestAttempts) {
          if (retryable) {
            throw relationshipError(
              'request-timeout',
              `Instagram did not finish this ${listType || 'account'} request after ${requestAttempts} attempts. The previous comparison is unchanged.`,
            );
          }
          throw error;
        }
        const retryDelayMs = Math.min(
          5_000,
          (retryBaseMs * attempt) + Math.floor(Math.max(0, Math.min(0.999999, random())) * 250),
        );
        onProgress?.(Object.freeze({
          attempt: attempt + 1,
          failedAttempt: attempt,
          found,
          expectedCount,
          listType,
          maxAttempts: requestAttempts,
          pages,
          phase: 'retrying',
          retryDelayMs,
          username,
        }));
        await sleepImpl(retryDelayMs, signal);
      }
    }
    throw relationshipError('request-timeout', 'Instagram follower data did not finish.');
  }

  function normalizeObservedInstagramId(value) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return '';
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const id = String(value).trim();
    return /^[1-9]\d{0,29}$/.test(id) ? id : '';
  }

  async function resolveRelationshipUserId(username, options) {
    const url = new URL('/api/v1/web/search/topsearch/', INSTAGRAM_WEB_ORIGIN);
    url.searchParams.set('context', 'blended');
    url.searchParams.set('query', username);
    url.searchParams.set('include_reel', 'false');
    const data = await fetchInstagramRelationshipJson(url, options);
    const exact = (Array.isArray(data?.users) ? data.users : [])
      .map((entry) => entry?.user)
      .find((user) => normalizeUsername(user?.username) === username);
    const userId = String(exact?.pk || '').trim();
    if (!/^\d+$/.test(userId)) {
      throw relationshipError('username-not-found', `Instagram could not resolve @${username}.`);
    }
    return {
      userId,
      ...(normalizeObservedInstagramId(exact?.pk)
        ? { subjectInstagramId: normalizeObservedInstagramId(exact.pk) } : {}),
    };
  }

  async function resolveRelationshipProfileCounts(username, userId, options) {
    const url = new URL('/api/v1/users/web_profile_info/', INSTAGRAM_WEB_ORIGIN);
    url.searchParams.set('username', username);
    const data = await fetchInstagramRelationshipJson(url, options);
    const profile = data?.data?.user;
    const resolvedUsername = normalizeUsername(profile?.username);
    const resolvedUserId = String(profile?.id || profile?.pk || '').trim();
    if (resolvedUsername !== username || resolvedUserId !== userId) {
      throw relationshipError(
        'profile-mismatch',
        `Instagram did not return the exact profile counters for @${username}. The previous comparison is unchanged.`,
      );
    }
    const followers = relationshipCount(
      profile?.edge_followed_by?.count,
      profile?.follower_count,
      profile?.followers_count,
    );
    const following = relationshipCount(
      profile?.edge_follow?.count,
      profile?.following_count,
      profile?.follows_count,
    );
    if (!Number.isSafeInteger(followers) || !Number.isSafeInteger(following)) {
      throw relationshipError(
        'profile-count-unavailable',
        `Instagram did not provide verified follower and following totals for @${username}. The previous comparison is unchanged.`,
      );
    }
    return Object.freeze({ followers, following });
  }

  function openProfileRelationshipCounts(username) {
    if (normalizeUsername(location.pathname) !== username) return null;
    const followers = exactProfileListCount('followers', { requireScoped: true });
    const following = exactProfileListCount('following', { requireScoped: true });
    if (!Number.isSafeInteger(followers) || !Number.isSafeInteger(following)) return null;
    return Object.freeze({ followers, following });
  }

  function exactProfileCountDisagreement(username, profileCounts) {
    if (normalizeUsername(location.pathname) !== username) {
      return Object.freeze({ followers: false, following: false });
    }
    const followers = exactProfileListCount('followers');
    const following = exactProfileListCount('following');
    return Object.freeze({
      followers: Number.isSafeInteger(followers) && followers !== profileCounts.followers,
      following: Number.isSafeInteger(following) && following !== profileCounts.following,
    });
  }

  function finalizeRelationshipList(list, {
    countChanged,
    countDisagreed,
    expectedCount,
  }) {
    if (countChanged) {
      return Object.freeze({
        ...list,
        complete: false,
        expectedCount,
        reason: 'count-changed',
      });
    }
    if (countDisagreed) {
      return Object.freeze({
        ...list,
        complete: false,
        expectedCount,
        reason: 'profile-count-disagreement',
      });
    }
    return list;
  }

  async function fetchRelationshipList(listType, userId, username, {
    clearTimer,
    cooldown,
    fetchImpl,
    maxAccounts,
    maxDurationMs,
    maxPages,
    now,
    onProgress,
    random,
    requestAttempts,
    requestTimeoutMs,
    retryBaseMs,
    setTimer,
    signal,
    sleepImpl,
    startedAt,
    expectedCount = null,
  }) {
    const accounts = new Map();
    const accountKeyByUsername = new Map();
    const seenTokens = new Set();
    let nextMaxId = '';
    let pages = 0;
    let stagnantPages = 0;
    let instagramLimited = false;
    while (pages < maxPages && accounts.size < maxAccounts) {
      assertRelationshipRunActive(signal, startedAt, now, maxDurationMs);
      const url = new URL(`/api/v1/friendships/${userId}/${listType}/`, INSTAGRAM_WEB_ORIGIN);
      url.searchParams.set('count', String(RELATIONSHIP_PAGE_SIZE));
      url.searchParams.set('search_surface', 'follow_list_page');
      url.searchParams.set('query', '');
      url.searchParams.set('enable_groups', 'true');
      if (listType === 'following') url.searchParams.set('includes_hashtags', 'false');
      if (nextMaxId) url.searchParams.set('max_id', nextMaxId);
      const data = await fetchInstagramRelationshipJson(url, {
        clearTimer,
        cooldown,
        expectedCount,
        fetchImpl,
        found: accounts.size,
        listType,
        now,
        onProgress,
        pages,
        random,
        requestAttempts,
        requestTimeoutMs,
        retryBaseMs,
        setTimer,
        signal,
        sleepImpl,
        username,
      });
      if (!Array.isArray(data?.users)) {
        throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} page.`);
      }
      for (const flag of ['has_more', 'should_limit_list_of_followers']) {
        if (Object.prototype.hasOwnProperty.call(data, flag) && typeof data[flag] !== 'boolean') {
          throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} pagination flag.`);
        }
      }
      instagramLimited ||= data.should_limit_list_of_followers === true;
      pages += 1;
      const beforePageCount = accounts.size;
      for (const user of data.users) {
        const accountUsername = normalizeUsername(user?.username);
        if (!accountUsername) continue;
        const rawAccountId = user?.pk ?? user?.id ?? '';
        const accountId = String(rawAccountId || '').trim();
        if (accountId && !/^\d+$/.test(accountId)) {
          throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} account ID.`);
        }
        const accountKey = accountId ? `id:${accountId}` : `username:${accountUsername}`;
        const usernameOwner = accountKeyByUsername.get(accountUsername);
        if (usernameOwner && usernameOwner !== accountKey) {
          if (usernameOwner === `username:${accountUsername}` && accountId) {
            accounts.delete(usernameOwner);
          } else {
            throw relationshipError(
              'invalid-response',
              `Instagram returned conflicting ${listType} account identities.`,
            );
          }
        }
        const previous = accounts.get(accountKey);
        if (previous?.username && previous.username !== accountUsername) {
          accountKeyByUsername.delete(previous.username);
        }
        accounts.set(accountKey, {
          username: accountUsername,
          ...(normalizeObservedInstagramId(rawAccountId)
            ? { instagramId: normalizeObservedInstagramId(rawAccountId) } : {}),
          profileUrl: `${INSTAGRAM_WEB_ORIGIN}/${accountUsername}/`,
          displayName: String(user?.full_name || '').trim().slice(0, 160),
          source: 'authenticated-instagram-web',
        });
        accountKeyByUsername.set(accountUsername, accountKey);
        if (accounts.size >= maxAccounts) break;
      }
      stagnantPages = accounts.size > beforePageCount ? 0 : stagnantPages + 1;
      onProgress?.(Object.freeze({
        expectedCount,
        found: accounts.size,
        listType,
        pages,
        phase: 'loading',
        username,
      }));
      const sortedAccounts = () => [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username));
      const candidateToken = stagnantPages >= 3 ? null : data.next_max_id;
      if (candidateToken === undefined || candidateToken === null || candidateToken === '') {
        const countReconciled = Number.isSafeInteger(expectedCount)
          && accounts.size === expectedCount && !instagramLimited
          && data.has_more !== true && stagnantPages < 3;
        return {
          accounts: sortedAccounts(),
          complete: countReconciled,
          expectedCount,
          pages,
          reason: countReconciled
            ? 'pagination-complete'
            : instagramLimited
              ? 'instagram-limited-list'
              : data.has_more === true
                ? 'cursor-missing'
                : Number.isSafeInteger(expectedCount) ? 'count-mismatch' : 'count-unverified',
        };
      }
      nextMaxId = String(candidateToken);
      if (!nextMaxId || nextMaxId.length > 500) {
        throw relationshipError('invalid-pagination', `Instagram returned an unsafe ${listType} pagination token.`);
      }
      if (seenTokens.has(nextMaxId)) {
        return {
          accounts: sortedAccounts(),
          complete: false,
          expectedCount,
          pages,
          reason: 'count-mismatch',
        };
      }
      seenTokens.add(nextMaxId);
      const delayMs = Math.floor(800 + (Math.max(0, Math.min(0.999999, random())) * 700));
      await sleepImpl(delayMs, signal);
    }
    return {
      accounts: [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username)),
      complete: false,
      expectedCount,
      pages,
      reason: accounts.size >= maxAccounts ? 'account-limit' : 'page-limit',
    };
  }

  async function fetchFollowerComparison({
    clearTimer = clearTimeout,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    maxAccounts = RELATIONSHIP_MAX_ACCOUNTS,
    maxDurationMs = RELATIONSHIP_MAX_DURATION_MS,
    maxPages = RELATIONSHIP_MAX_PAGES,
    now = Date.now,
    onProgress = null,
    random = Math.random,
    requestAttempts = RELATIONSHIP_REQUEST_ATTEMPTS,
    requestTimeoutMs = RELATIONSHIP_REQUEST_TIMEOUT_MS,
    retryBaseMs = RELATIONSHIP_RETRY_BASE_MS,
    retryRateLimits = false,
    signal = null,
    sleepImpl = relationshipDelay,
    setTimer = setTimeout,
    username: requestedUsername,
  } = {}) {
    const username = normalizeUsername(requestedUsername);
    if (!username) throw relationshipError('invalid-username', 'Enter a valid Instagram username.');
    const pageOrigin = String(location?.origin || '');
    if (pageOrigin !== INSTAGRAM_WEB_ORIGIN) {
      throw relationshipError('wrong-origin', 'Open instagram.com before running the follower check.');
    }
    if (typeof fetchImpl !== 'function') {
      throw relationshipError('fetch-unavailable', 'This browser context cannot load Instagram follower data.');
    }
    const boundedPages = Math.max(1, Math.min(RELATIONSHIP_MAX_PAGES, Math.trunc(Number(maxPages) || 0)));
    const boundedAccounts = Math.max(1, Math.min(RELATIONSHIP_MAX_ACCOUNTS, Math.trunc(Number(maxAccounts) || 0)));
    const boundedDuration = Math.max(1_000, Math.min(RELATIONSHIP_MAX_DURATION_MS, Math.trunc(Number(maxDurationMs) || 0)));
    const boundedAttempts = Math.max(1, Math.min(RELATIONSHIP_REQUEST_ATTEMPTS, Math.trunc(Number(requestAttempts) || 0)));
    const boundedRequestTimeout = Math.max(1, Math.min(RELATIONSHIP_REQUEST_TIMEOUT_MS, Math.trunc(Number(requestTimeoutMs) || 0)));
    const boundedRetryBase = Math.max(0, Math.min(5_000, Math.trunc(Number(retryBaseMs) || 0)));
    const deadline = relationshipRunDeadline(signal, boundedDuration, setTimer, clearTimer);
    const runSignal = deadline.signal;
    try {
      const startedAt = now();
      assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
      const initialPath = location.pathname;
      const cooldown = retryRateLimits === true ? {
        attempts: 0,
        deadline: startedAt + boundedDuration,
        assertActive() {
          assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
          if (location.origin !== pageOrigin || location.pathname !== initialPath) {
            throw relationshipError('profile-mismatch', 'The open profile changed. Follower check stopped.');
          }
        },
      } : null;
      onProgress?.(Object.freeze({ found: 0, listType: null, pages: 0, phase: 'resolving', username }));
      const common = {
        cooldown,
        fetchImpl,
        maxAccounts: boundedAccounts,
        maxDurationMs: boundedDuration,
        maxPages: boundedPages,
        now,
        onProgress,
        random,
        requestAttempts: boundedAttempts,
        requestTimeoutMs: boundedRequestTimeout,
        retryBaseMs: boundedRetryBase,
        clearTimer,
        setTimer,
        signal: runSignal,
        sleepImpl,
        startedAt,
      };
      const openProfileCounts = openProfileRelationshipCounts(username);
      const resolution = await resolveRelationshipUserId(username, {
        ...common,
        found: 0,
        listType: null,
        pages: 0,
        username,
      });
      const { userId } = resolution;
      onProgress?.(Object.freeze({ found: 0, listType: null, pages: 0, phase: 'verifying-profile', username }));
      const profileCountsAtStart = openProfileCounts || await resolveRelationshipProfileCounts(username, userId, {
        ...common,
        found: 0,
        listType: null,
        pages: 0,
        username,
      });
      onProgress?.(Object.freeze({
        expectedCounts: profileCountsAtStart,
        found: 0,
        listType: null,
        pages: 0,
        phase: 'counts-ready',
        username,
      }));
      const countDisagreementAtStart = exactProfileCountDisagreement(username, profileCountsAtStart);
      const followersTraversal = await fetchRelationshipList('followers', userId, username, {
        ...common,
        expectedCount: profileCountsAtStart.followers,
      });
      const followingTraversal = await fetchRelationshipList('following', userId, username, {
        ...common,
        expectedCount: profileCountsAtStart.following,
      });
      assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
      onProgress?.(Object.freeze({
        found: followersTraversal.accounts.length + followingTraversal.accounts.length,
        listType: null,
        pages: followersTraversal.pages + followingTraversal.pages,
        phase: 'revalidating-profile',
        username,
      }));
      const profileCountsAtEnd = openProfileCounts
        ? openProfileRelationshipCounts(username)
        : await resolveRelationshipProfileCounts(username, userId, {
          ...common,
          found: followersTraversal.accounts.length + followingTraversal.accounts.length,
          listType: null,
          pages: followersTraversal.pages + followingTraversal.pages,
          username,
        });
      if (!profileCountsAtEnd) {
        throw relationshipError('profile-count-unavailable', 'Keep the checked profile open until the comparison finishes. The previous comparison is unchanged.');
      }
      const countDisagreementAtEnd = exactProfileCountDisagreement(username, profileCountsAtEnd);
      const followers = finalizeRelationshipList(followersTraversal, {
        countChanged: profileCountsAtStart.followers !== profileCountsAtEnd.followers,
        countDisagreed: countDisagreementAtStart.followers || countDisagreementAtEnd.followers,
        expectedCount: profileCountsAtEnd.followers,
      });
      const following = finalizeRelationshipList(followingTraversal, {
        countChanged: profileCountsAtStart.following !== profileCountsAtEnd.following,
        countDisagreed: countDisagreementAtStart.following || countDisagreementAtEnd.following,
        expectedCount: profileCountsAtEnd.following,
      });
      const expectedCounts = Object.freeze({
        followers: profileCountsAtEnd.followers,
        following: profileCountsAtEnd.following,
      });
      const capturedAt = new Date(now()).toISOString();
      const result = Object.freeze({
        capturedAt,
        complete: Object.freeze({ followers: followers.complete, following: following.complete }),
        expectedCounts: Object.freeze({ followers: followers.expectedCount, following: following.expectedCount }),
        followers: Object.freeze(followers.accounts),
        following: Object.freeze(following.accounts),
        pages: Object.freeze({ followers: followers.pages, following: following.pages }),
        reasons: Object.freeze({ followers: followers.reason, following: following.reason }),
        source: 'authenticated-instagram-web',
        userId,
        ...(resolution.subjectInstagramId ? { subjectInstagramId: resolution.subjectInstagramId } : {}),
        username,
      });
      onProgress?.(Object.freeze({
        found: result.followers.length + result.following.length,
        listType: null,
        pages: result.pages.followers + result.pages.following,
        phase: 'complete',
        username,
      }));
      return result;
    } catch (error) {
      if (deadline.timedOut() && error?.code === 'stopped') {
        throw relationshipError('time-limit', 'The follower check reached its 20-minute read limit.');
      }
      throw error;
    } finally {
      deadline.cleanup();
    }
  }

  function normalizeFollowerDiagnostics(value) {
    const reasons = new Set(['pagination-complete', 'instagram-limited-list', 'cursor-missing',
      'count-mismatch', 'count-unverified', 'count-changed', 'profile-count-disagreement', 'account-limit', 'page-limit']);
    const count = (number) => Number.isSafeInteger(number) && number >= 0 ? number : null;
    return {
      expectedCounts: Object.fromEntries(['followers', 'following'].map((type) => [type, count(value?.expectedCounts?.[type])])),
      pages: Object.fromEntries(['followers', 'following'].map((type) => [type, count(value?.pages?.[type])])),
      reasons: Object.fromEntries(['followers', 'following'].map((type) => [type, reasons.has(value?.reasons?.[type]) ? value.reasons[type] : ''])),
    };
  }

  function followerComparisonDetails(workspace) {
    const diagnostics = normalizeFollowerDiagnostics(workspace);
    return ['followers', 'following'].flatMap((type) => {
      const reason = diagnostics.reasons[type];
      if (!reason) return [];
      const found = Array.isArray(workspace?.[type]) ? workspace[type].length : 0;
      const expected = diagnostics.expectedCounts[type];
      const label = type === 'followers' ? 'Followers' : 'Following';
      const count = expected === null ? `${found.toLocaleString('en-US')} read` : `${found.toLocaleString('en-US')} of ${expected.toLocaleString('en-US')} read`;
      const explanations = {
        'pagination-complete': 'Pagination finished and totals matched.',
        'instagram-limited-list': 'Instagram marked this list as limited.',
        'cursor-missing': 'Instagram reported more results but supplied no next page.',
        'count-mismatch': 'The returned accounts did not match the profile total; the cause is unknown.',
        'count-unverified': 'No exact profile total was available.',
        'count-changed': 'The profile total changed during this check.',
        'profile-count-disagreement': 'Instagram profile counters disagreed.',
        'account-limit': 'The bounded account read limit was reached.',
        'page-limit': 'The bounded page read limit was reached.',
      };
      return [`${label}: ${count}. ${explanations[reason]}`];
    });
  }

  function followerComparisonSummary(workspace) {
    const completeList = (type) => workspace?.verified?.[type] === true && workspace?.complete?.[type] === true;
    const complete = completeList('followers') && completeList('following');
    const available = complete || ['followers', 'following'].some((type) => (
      workspace?.verified?.[type] === true || (Array.isArray(workspace?.[type]) && workspace[type].length > 0)
    ));
    const verifiedPartial = !complete && ['followers', 'following'].some((type) => (
      workspace?.verified?.[type] === true && workspace?.complete?.[type] !== true
    ));
    const knownReason = ['followers', 'following'].some((type) => [
      'instagram-limited-list', 'cursor-missing', 'count-changed', 'profile-count-disagreement', 'account-limit', 'page-limit',
    ].includes(workspace?.reasons?.[type]));
    return {
      available,
      complete,
      details: followerComparisonDetails(workspace),
      labels: {
        mutuals: 'Mutuals',
        notFollowingMeBack: complete ? "Don't follow you back" : 'Not found in followers',
        iDoNotFollowBack: complete ? "You don't follow back" : 'Not found in following',
      },
      warning: complete ? '' : knownReason
        ? 'Partial comparison — captured accounts only. Someone missing from a list may still be a mutual. Check profiles before acting.'
        : 'Partial comparison — captured accounts only. Someone missing from a list may still be a mutual. The missing accounts and the reason are unknown; check profiles before acting.',
      ageFilterGuidance: verifiedPartial
        ? 'Possible viewer-age filtering: Instagram may hide age-restricted accounts if the signed-in account has no birthday. Check Accounts Center, reload, and retry. Other causes are possible.'
        : '',
      accountsCenterUrl: verifiedPartial
        ? 'https://accountscenter.instagram.com/personal_info'
        : '',
    };
  }

  function followerComparisonRecord(workspace, comparison, generatedAt = new Date().toISOString()) {
    const summary = followerComparisonSummary(workspace);
    return {
      schemaVersion: 1,
      kind: 'insta-toolbox-comparison',
      generatedAt,
      subjectUsername: normalizeUsername(workspace?.subjectUsername),
      source: workspace?.source && typeof workspace.source === 'object' ? workspace.source : {},
      complete: workspace?.complete && typeof workspace.complete === 'object' ? workspace.complete : {},
      verified: workspace?.verified && typeof workspace.verified === 'object' ? workspace.verified : {},
      partial: !summary.complete,
      labels: summary.labels,
      warning: summary.warning,
      ageFilterGuidance: summary.ageFilterGuidance,
      accountsCenterUrl: summary.accountsCenterUrl,
      ...normalizeFollowerDiagnostics(workspace),
      mutuals: Array.isArray(comparison?.mutuals) ? comparison.mutuals : [],
      notFollowingMeBack: Array.isArray(comparison?.notFollowingMeBack)
        ? comparison.notFollowingMeBack
        : [],
      iDoNotFollowBack: Array.isArray(comparison?.iDoNotFollowBack)
        ? comparison.iDoNotFollowBack
        : [],
    };
  }

  function followerComparisonReport(workspace, comparison, generatedAt = new Date().toISOString()) {
    const record = followerComparisonRecord(workspace, comparison, generatedAt);
    const followersCount = Array.isArray(workspace?.followers) ? workspace.followers.length : 0;
    const followingCount = Array.isArray(workspace?.following) ? workspace.following.length : 0;
    const fullyVerified = record.verified.followers === true && record.verified.following === true;
    const fullyComplete = fullyVerified
      && record.complete.followers === true
      && record.complete.following === true;
    const source = record.source.followers === 'authenticated-web'
      && record.source.following === 'authenticated-web'
      ? 'Authenticated Instagram web pagination'
      : record.source.followers === 'list-dialog' && record.source.following === 'list-dialog'
        ? 'Instagram list-dialog capture'
        : 'Mixed local captures';
    const lines = [
      'INSTA TOOLBOX MUTUAL CHECK',
      '================================',
      `Account: ${record.subjectUsername ? `@${record.subjectUsername}` : 'Not recorded'}`,
      `Generated: ${record.generatedAt}`,
      `Source: ${source}`,
      `Completeness: ${fullyComplete ? 'Complete — both lists reached their verified end.' : 'Partial — one or both saved lists may omit accounts.'}`,
      ...(record.warning ? [record.warning] : []),
      ...(record.ageFilterGuidance ? [record.ageFilterGuidance] : []),
      ...(record.accountsCenterUrl ? [`Accounts Center: ${record.accountsCenterUrl}`] : []),
      ...followerComparisonDetails(workspace),
      '',
      'SUMMARY',
      '-------',
      `Followers: ${followersCount.toLocaleString('en-US')}`,
      `Following: ${followingCount.toLocaleString('en-US')}`,
      `Mutual followers: ${record.mutuals.length.toLocaleString('en-US')}`,
      `${fullyComplete ? 'Not following you back' : record.labels.notFollowingMeBack}: ${record.notFollowingMeBack.length.toLocaleString('en-US')}`,
      `${fullyComplete ? 'You do not follow back' : record.labels.iDoNotFollowBack}: ${record.iDoNotFollowBack.length.toLocaleString('en-US')}`,
    ];
    const addSection = (title, accounts) => {
      lines.push('', title, '-'.repeat(title.length));
      if (!accounts.length) {
        lines.push('None');
        return;
      }
      accounts.forEach((account, index) => {
        const username = normalizeUsername(account?.username);
        const displayName = String(account?.displayName || '').trim();
        lines.push(`${index + 1}. @${username}${displayName ? ` — ${displayName}` : ''}`);
      });
    };
    addSection(fullyComplete ? 'NOT FOLLOWING YOU BACK' : record.labels.notFollowingMeBack.toUpperCase(), record.notFollowingMeBack);
    addSection(fullyComplete ? 'YOU DO NOT FOLLOW BACK' : record.labels.iDoNotFollowBack.toUpperCase(), record.iDoNotFollowBack);
    addSection('MUTUAL FOLLOWERS', record.mutuals);
    lines.push('', 'Generated locally by Insta Toolbox. No account action was performed.', '');
    return lines.join('\r\n');
  }

  function visibleText(element) {
    if (!element || element.getAttribute('aria-hidden') === 'true') return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return String(element.textContent || element.getAttribute('aria-label') || '').trim();
  }

  function resolutionToken() {
    try {
      const secureCrypto = globalThis.crypto;
      if (typeof secureCrypto?.randomUUID === 'function') {
        const token = secureCrypto.randomUUID();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
          return token;
        }
      }
      if (typeof secureCrypto?.getRandomValues !== 'function') return null;
      const bytes = new Uint8Array(16);
      secureCrypto.getRandomValues(bytes);
      if (bytes.every((byte) => byte === 0)) return null;
      return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }

  function dmContentDigest(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function directThreadId(value) {
    const text = String(value || '').replaceAll('\\', '/');
    const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
    if (directMatch) return directMatch[1];
    const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
    const exportMatch = finalSegment.match(/_([0-9]+)$/);
    return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
  }

  function currentDirectThreadId() {
    const pathname = String(location.pathname || '').replaceAll('\\', '/');
    if (/^\/direct\/t\/[^/?#]+\/?$/i.test(pathname)) return directThreadId(pathname);
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rectangle = element.getBoundingClientRect?.();
      return !rectangle || (rectangle.width > 0 && rectangle.height > 0);
    };
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(visible);
    if (roots.length !== 1) return null;
    const links = [...document.querySelectorAll("a[href*='/direct/t/']")].filter(visible);
    if (links.length !== 1) return null;
    return directThreadId(links[0].getAttribute?.('href'));
  }

  function normalizedDmTimestamp(value) {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 100_000_000_000_000) return Math.floor(numeric / 1000);
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function dmMessageId(element) {
    for (const attribute of DM_MESSAGE_ID_ATTRIBUTES) {
      const value = String(element?.getAttribute?.(attribute) || '').trim();
      if (value) return { attribute, value };
    }
    return null;
  }

  function dmMessageTimestamp(identityNode, row) {
    for (const element of [identityNode, row]) {
      for (const attribute of DM_TIMESTAMP_ATTRIBUTES) {
        const timestamp = normalizedDmTimestamp(element?.getAttribute?.(attribute));
        if (timestamp != null) return { basis: attribute, timestamp };
      }
    }
    const time = row?.querySelector?.('time[datetime]');
    const timestamp = normalizedDmTimestamp(time?.getAttribute?.('datetime'));
    return timestamp == null ? null : { basis: 'time[datetime]', timestamp };
  }

  function dmOwnership(row, identityNode) {
    const explicit = String(row?.getAttribute?.('data-sent-by-me') || '').toLowerCase();
    if (explicit === 'false') return { sentByMe: false, basis: 'data-sent-by-me' };
    const proof = globalThis.InstaToolboxDmThreadUnsender?.messageProof;
    if (row?.contains?.(identityNode) && proof?.sentByCurrentUser(row, globalThis)) {
      return { sentByMe: true, basis: explicit === 'true' ? 'data-sent-by-me' : 'identity-ancestor-flex-end-layout' };
    }
    return { sentByMe: null, basis: null };
  }

  function dmContentCandidates(row) {
    const explicitlyMarked = [...(row?.querySelectorAll?.('[data-insta-toolbox-message-content]') || [])];
    const nodes = explicitlyMarked.length
      ? explicitlyMarked
      : [...(row?.querySelectorAll?.('[dir="auto"]') || [])]
        .filter((element) => !element.querySelector?.('[dir="auto"]'))
        .filter((element) => !element.closest?.('header, nav, button, [role="button"], a, time'));
    return [...new Set(nodes.map(visibleText).filter((text) => text && text.length <= 500))];
  }

  function resolveReviewedDmItem(item) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { observation: session, candidate: null };
    }
    const observedThreadId = currentDirectThreadId();
    if (!observedThreadId) {
      return {
        observation: { ...session, unexpectedUi: true, reason: 'open-an-instagram-conversation' },
        candidate: null,
      };
    }

    const expectedThreadId = directThreadId(item?.conversationId);
    if (!expectedThreadId) {
      return {
        observation: { ...session, ambiguous: true, reason: 'conversation-id-unresolved' },
        candidate: null,
      };
    }
    if (expectedThreadId !== observedThreadId) {
      return {
        observation: {
          ...session,
          ambiguous: true,
          reason: 'wrong-conversation',
          evidence: { expectedThreadId, observedThreadId },
        },
        candidate: null,
      };
    }

    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
      || document.querySelector('main');
    const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
      .map((attribute) => `[${attribute}]`)
      .join(', ');
    const identityNodes = [...(scope?.querySelectorAll?.(identitySelector) || [])]
      .filter((element) => visibleText(element));
    if (!identityNodes.length) {
      return {
        observation: {
          ...session,
          conversationId: String(item?.conversationId || ''),
          messageId: String(item?.messageId || ''),
          missing: true,
          exactIdentityAvailable: false,
          ownershipAvailable: false,
          reason: 'exact-message-identity-unavailable',
          evidence: { observedThreadId, stableIdentityNodeCount: 0 },
        },
        candidate: null,
      };
    }

    const candidates = identityNodes.map((identityNode) => {
      const row = identityNode.closest?.('[role="row"], [role="listitem"]') || identityNode;
      const identity = dmMessageId(identityNode) || dmMessageId(row);
      const timestamp = dmMessageTimestamp(identityNode, row);
      const ownership = dmOwnership(row, identityNode);
      const contents = dmContentCandidates(row);
      return {
        contentMatches: contents.filter((content) => dmContentDigest(content) === item?.contentDigest),
        identity,
        identityNode,
        ownership,
        row,
        timestamp,
      };
    }).filter((candidate) => (
      candidate.identity?.value === String(item?.messageId || '')
      && candidate.timestamp?.timestamp === Number(item?.timestamp)
      && candidate.contentMatches.length === 1
    ));

    if (!candidates.length) {
      return {
        observation: {
          ...session,
          conversationId: String(item?.conversationId || ''),
          messageId: String(item?.messageId || ''),
          missing: true,
          exactIdentityAvailable: true,
          reason: 'exact-message-not-found',
          evidence: { observedThreadId, stableIdentityNodeCount: identityNodes.length },
        },
        candidate: null,
      };
    }
    if (candidates.length !== 1) {
      return {
        observation: {
          ...session,
          ambiguous: true,
          exactIdentityAvailable: true,
          reason: 'exact-message-ambiguous',
          evidence: { observedThreadId, exactCandidateCount: candidates.length },
        },
        candidate: null,
      };
    }

    const candidate = candidates[0];
    if (candidate.ownership.sentByMe !== true) {
      return {
        observation: {
          ...session,
          sentByMe: candidate.ownership.sentByMe,
          exactIdentityAvailable: true,
          ownershipAvailable: candidate.ownership.sentByMe === false,
          reason: candidate.ownership.sentByMe === false
            ? 'received-message'
            : 'message-ownership-unavailable',
        },
        candidate: null,
      };
    }

    return {
      observation: {
        ...session,
        ambiguous: false,
        unexpectedUi: false,
        conversationId: String(item.conversationId),
        messageId: String(item.messageId),
        timestamp: Number(item.timestamp),
        contentDigest: String(item.contentDigest),
        contentLength: candidate.contentMatches[0].length,
        sentByMe: true,
        exactIdentityAvailable: true,
        ownershipAvailable: true,
        evidence: {
          source: 'extension-stable-visible-message-identity',
          observedThreadId,
          identityAttribute: candidate.identity.attribute,
          timestampBasis: candidate.timestamp.basis,
          ownershipBasis: candidate.ownership.basis,
          capturedAt: new Date().toISOString(),
        },
      },
      candidate,
    };
  }

  function pruneDmResolutions(now = Date.now()) {
    for (const [token, resolution] of dmResolutions) {
      if (now - resolution.createdAt > DM_RESOLUTION_TTL_MS) {
        dmResolutions.delete(token);
      }
    }
  }

  function inspectReviewedDmItem(item) {
    const resolved = resolveReviewedDmItem(item);
    if (!resolved.candidate) return resolved.observation;
    pruneDmResolutions();
    const token = resolutionToken();
    if (!token) {
      return {
        ...resolved.observation,
        unexpectedUi: true,
        reason: 'secure-random-unavailable',
        resolutionToken: null,
      };
    }
    dmResolutions.set(token, {
      contentDigest: String(item.contentDigest),
      conversationId: String(item.conversationId),
      createdAt: Date.now(),
      identityNode: resolved.candidate.identityNode,
      messageId: String(item.messageId),
      pathname: location.pathname,
      row: resolved.candidate.row,
      timestamp: Number(item.timestamp),
    });
    return { ...resolved.observation, resolutionToken: token };
  }

  function reviewedTargetElement({ accountIntent = null, dmIntent = null } = {}) {
    if (dmIntent) {
      const exact = resolveReviewedDmItem(dmIntent).candidate?.row || null;
      if (exact) return exact;
      const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
        || document.querySelector('main');
      const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
        .map((attribute) => `[${attribute}]`)
        .join(', ');
      const rows = new Set(
        [...(scope?.querySelectorAll?.(identitySelector) || [])]
          .filter((element) => visibleText(element))
          .filter((element) => {
            const row = element.closest?.('[role="row"], [role="listitem"]') || element;
            return (dmMessageId(element) || dmMessageId(row))?.value === String(dmIntent.messageId || '');
          })
          .map((element) => element.closest?.('[role="row"], [role="listitem"]') || element),
      );
      return rows.size === 1 ? [...rows][0] : null;
    }
    if (pageKind() === 'messages') {
      const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
        || document.querySelector('main');
      const row = [...(scope?.querySelectorAll?.('[role="row"], [role="listitem"]') || [])]
        .find((element) => visibleText(element));
      if (row) return row;
    }
    const usernames = [...new Set([
      normalizeUsername(accountIntent?.username),
      normalizeUsername(location.pathname),
    ].filter(Boolean))];
    for (const username of usernames) {
      const relationship = relationshipFromButtons(username);
      if (!relationship.ambiguous && relationship.control) return relationship.control;
    }
    return null;
  }

  function dmResolutionMatches(resolution, item) {
    if (
      !resolution
      || !resolution.row?.isConnected
      || !resolution.identityNode?.isConnected
      || resolution.pathname !== location.pathname
      || resolution.conversationId !== String(item?.conversationId || '')
      || resolution.messageId !== String(item?.messageId || '')
      || resolution.timestamp !== Number(item?.timestamp)
      || resolution.contentDigest !== String(item?.contentDigest || '')
      || item?.sentByMe !== true
    ) return false;
    const current = resolveReviewedDmItem(item);
    return Boolean(
      current.candidate
      && current.candidate.row === resolution.row
      && current.candidate.identityNode === resolution.identityNode,
    );
  }

  function pruneProfileResolutions(now = Date.now()) {
    for (const [token, resolution] of profileResolutions) {
      if (now - resolution.createdAt > PROFILE_RESOLUTION_TTL_MS) {
        profileResolutions.delete(token);
      }
    }
  }

  function inspectSession() {
    const path = location.pathname.toLowerCase();
    const pageText = String(document.body?.innerText || '').toLowerCase();
    return {
      sessionExpired: path.startsWith('/accounts/login') || Boolean(document.querySelector('input[name="username"]')),
      challenge: path.startsWith('/challenge') || path.startsWith('/accounts/suspended'),
      actionBlocked: pageText.includes('we restrict certain activity'),
      rateLimited: pageText.includes('please wait a few minutes'),
      capturedAt: new Date().toISOString(),
    };
  }

  function verifiedProfileHeader(username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return { root: null, observedProfileCount: 0 };
    const headers = [...document.querySelectorAll('main header')]
      .filter((header) => {
        if (!visibleText(header)) return false;
        return [...header.querySelectorAll('a[href], h1, h2, [role="heading"]')]
          .some((element) => {
            const hrefUsername = normalizeUsername(element.getAttribute?.('href'));
            const textUsername = normalizeUsername(visibleText(element));
            return hrefUsername === normalized || textUsername === normalized;
          });
      });
    return {
      root: headers.length === 1 ? headers[0] : null,
      observedProfileCount: headers.length,
    };
  }

  function relationshipFromButtons(expectedUsername) {
    const profile = verifiedProfileHeader(expectedUsername);
    if (!profile.root) {
      return {
        relationship: null,
        ambiguous: true,
        observedLabels: [],
        observedControlCount: 0,
        observedProfileCount: profile.observedProfileCount,
        profileIdentityVerified: false,
        profileRoot: null,
        control: null,
      };
    }
    const candidates = [...profile.root.querySelectorAll('button, [role="button"]')]
      .map((element) => ({
        element,
        label: actionLabels.normalizeActionLabel(visibleText(element)),
      }))
      .filter(({ label }) => actionLabels.relationshipForLabel(label));
    const uniqueLabels = [...new Set(candidates.map(({ label }) => label))];
    if (candidates.length !== 1 || uniqueLabels.length !== 1) {
      return {
        relationship: null,
        ambiguous: true,
        observedLabels: uniqueLabels,
        observedControlCount: candidates.length,
        observedProfileCount: profile.observedProfileCount,
        profileIdentityVerified: true,
        profileRoot: profile.root,
        control: null,
      };
    }
    const label = uniqueLabels[0];
    return {
      relationship: actionLabels.relationshipForLabel(label),
      ambiguous: false,
      observedLabels: uniqueLabels,
      observedControlCount: 1,
      observedProfileCount: profile.observedProfileCount,
      profileIdentityVerified: true,
      profileRoot: profile.root,
      control: candidates[0].element,
    };
  }

  function inspectProfile(expectedUsername) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }
    const username = normalizeUsername(location.pathname);
    const relationship = relationshipFromButtons(username);
    pruneProfileResolutions();
    let token = null;
    let secureRandomUnavailable = false;
    if (!relationship.ambiguous && username && relationship.control) {
      token = resolutionToken();
      if (token) {
        profileResolutions.set(token, {
          control: relationship.control,
          createdAt: Date.now(),
          pathname: location.pathname,
          profileRoot: relationship.profileRoot,
          relationship: relationship.relationship,
          username,
        });
      } else {
        secureRandomUnavailable = true;
      }
    }
    return {
      ...session,
      relationship: relationship.relationship,
      ambiguous: relationship.ambiguous,
      observedLabels: relationship.observedLabels,
      observedControlCount: relationship.observedControlCount,
      observedProfileCount: relationship.observedProfileCount,
      profileIdentityVerified: relationship.profileIdentityVerified,
      username,
      unexpectedUi: secureRandomUnavailable
        || !document.querySelector('main')
        || !relationship.profileIdentityVerified,
      reason: secureRandomUnavailable ? 'secure-random-unavailable' : null,
      evidence: {
        url: location.href,
        expectedUsername: normalizeUsername(expectedUsername),
        observedUsername: username,
        observedLabels: relationship.observedLabels,
        observedControlCount: relationship.observedControlCount,
        observedProfileCount: relationship.observedProfileCount,
        profileIdentityVerified: relationship.profileIdentityVerified,
        capturedAt: new Date().toISOString(),
      },
      resolutionToken: token,
    };
  }

  function waitFor(check, timeoutMs, signal = null) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    return new Promise((resolve, reject) => {
      let timer;
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(null);
      const inspect = () => {
        if (settled) return;
        if (signal?.aborted || Date.now() >= deadline) { finish(null); return; }
        try {
          const value = check();
          if (signal?.aborted || Date.now() >= deadline) finish(null);
          else if (value) finish(value);
          else timer = setTimeout(inspect, Math.min(100, deadline - Date.now()));
        } catch (error) { finish(null, error); }
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      inspect();
    });
  }

  function visibleDialogs() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .filter((dialog) => visibleText(dialog));
  }

  function dialogNamesUsername(dialog, username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return false;
    if ([...dialog.querySelectorAll('a[href]')].some((anchor) => (
      normalizeUsername(anchor.getAttribute('href')) === normalized
    ))) return true;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9._])@?${escaped}(?=$|[^a-z0-9._])`, 'i')
      .test(visibleText(dialog));
  }

  function exactUnfollowConfirmation(username, excludedDialogs = new Set()) {
    const dialogs = visibleDialogs()
      .filter((dialog) => !excludedDialogs.has(dialog))
      .filter((dialog) => dialogNamesUsername(dialog, username));
    if (dialogs.length !== 1) return null;
    const controls = [...dialogs[0].querySelectorAll('button, [role="button"]')]
      .filter((element) => visibleText(element).toLocaleLowerCase() === 'unfollow');
    return controls.length === 1 ? controls[0] : null;
  }

  function activateLiveControl(control) {
    control.click();
  }

  function visibleMenus() {
    return [...document.querySelectorAll('[role="menu"], [role="listbox"]')]
      .filter((menu) => visibleText(menu));
  }

  function liveControlWithin(element, scope) {
    const control = element?.closest?.('button, [role="button"], [role="menuitem"]');
    return control && scope?.contains?.(control) ? control : null;
  }

  function idReferences(element, attribute) {
    return new Set(String(element?.getAttribute?.(attribute) || '').split(/\s+/).filter(Boolean));
  }

  function surfaceBoundToControl(surface, control) {
    const surfaceId = String(surface?.getAttribute?.('id') || '').trim();
    const controlId = String(control?.getAttribute?.('id') || '').trim();
    return Boolean(
      (surfaceId && (
        idReferences(control, 'aria-controls').has(surfaceId)
        || idReferences(control, 'aria-owns').has(surfaceId)
      ))
      || (controlId && idReferences(surface, 'aria-labelledby').has(controlId)),
    );
  }

  function exactBoundSurface(surfaces, control, excluded = new Set()) {
    const matches = surfaces.filter((surface) => (
      !excluded.has(surface)
      && surfaceBoundToControl(surface, control)
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  function exactDmActionControls(row) {
    const matches = [];
    for (const selector of DM_ACTION_LABEL_SELECTORS) {
      for (const element of row?.querySelectorAll?.(selector) || []) {
        const control = liveControlWithin(element, row);
        if (control) matches.push(control);
      }
    }
    for (const control of row?.querySelectorAll?.('[role="button"][aria-haspopup="menu"]') || []) {
      matches.push(control);
    }
    return [...new Set(matches)].filter((control) => (
      actionLabels.isDmMessageOptionsLabel(visibleText(control))
      || [...control?.querySelectorAll?.('[aria-label]') || []]
        .some((element) => actionLabels.isDmMessageOptionsLabel(visibleText(element)))
    ));
  }

  function exactDmUnsendControls(scope) {
    const controls = [];
    for (const element of scope?.querySelectorAll?.(
      'button, [role="button"], [role="menuitem"], span, div',
    ) || []) {
      if (!actionLabels.isDmUnsendLabel(visibleText(element))) continue;
      const control = liveControlWithin(element, scope);
      if (control) controls.push(control);
    }
    return [...new Set(controls)];
  }

  function hoverExactDmRow(row) {
    const eventTargets = [];
    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      eventTargets.push(element);
      if (depth < 8) {
        for (const child of element.children || []) {
          queue.push({ element: child, depth: depth + 1 });
        }
      }
    }
    for (const target of eventTargets) {
      const rect = target.getBoundingClientRect?.() || { x: 0, y: 0, width: 0, height: 0 };
      const options = {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + (rect.width / 2),
        clientY: rect.y + (rect.height / 2),
        pointerId: 1,
        pointerType: 'mouse',
      };
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent?.(new PointerEvent('pointerenter', { ...options, bubbles: false }));
        target.dispatchEvent?.(new PointerEvent('pointerover', options));
        target.dispatchEvent?.(new PointerEvent('pointermove', options));
      }
      if (typeof MouseEvent === 'function') {
        target.dispatchEvent?.(new MouseEvent('mouseenter', { ...options, bubbles: false }));
        target.dispatchEvent?.(new MouseEvent('mouseover', options));
        target.dispatchEvent?.(new MouseEvent('mousemove', options));
      }
    }
  }

  async function performReviewedDmUnsend(item) {
    const token = String(item?.resolutionToken || '');
    if (
      !token
      || !String(item?.conversationId || '')
      || !String(item?.messageId || '')
      || !Number.isFinite(Number(item?.timestamp))
      || !String(item?.contentDigest || '')
      || item?.sentByMe !== true
    ) {
      return { unexpectedUi: true, reason: 'invalid-live-dm-request' };
    }

    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }

    pruneDmResolutions();
    const resolution = dmResolutions.get(token);
    dmResolutions.delete(token);
    if (!dmResolutionMatches(resolution, item)) {
      return { ambiguous: true, reason: 'dm-resolution-expired-or-changed' };
    }
    const controller = new AbortController();
    let interrupted = null;
    const interrupt = (reason) => {
      if (interrupted) return;
      interrupted = reason;
      dmResolutions.clear();
      controller.abort(reason);
    };
    const onFreeze = () => interrupt('page-frozen');
    const onPageHide = (event) => interrupt(event?.persisted ? 'page-cached' : 'page-left');
    document.addEventListener?.('freeze', onFreeze);
    globalThis.addEventListener?.('pagehide', onPageHide);
    const lifecycle = {
      signal: controller.signal,
      interrupted: () => interrupted,
      outcome: (uncertain = false) => ({
        unexpectedUi: true, reason: 'dm-page-interrupted', needsAttention: true,
        interruptionReason: interrupted, uncertain,
      }),
    };
    try {
      return await performResolvedDmUnsend(item, resolution, lifecycle);
    } finally {
      document.removeEventListener?.('freeze', onFreeze);
      globalThis.removeEventListener?.('pagehide', onPageHide);
    }
  }

  async function performResolvedDmUnsend(item, resolution, lifecycle) {
    if (visibleDialogs().length || visibleMenus().length) {
      return { unexpectedUi: true, reason: 'preexisting-surface-before-live-unsend' };
    }

    hoverExactDmRow(resolution.row);
    const actionControl = await waitFor(() => {
      const controls = exactDmActionControls(resolution.row);
      return controls.length === 1 ? controls[0] : null;
    }, 1_500, lifecycle.signal);
    if (lifecycle.interrupted()) return lifecycle.outcome();
    if (!actionControl) {
      return { ambiguous: true, reason: 'dm-action-control-not-exact' };
    }
    if (
      !dmResolutionMatches(resolution, item)
      || visibleDialogs().length
      || visibleMenus().length
    ) {
      return { ambiguous: true, reason: 'dm-message-changed-before-menu' };
    }

    const menusBeforeAction = new Set(visibleMenus());
    if (lifecycle.interrupted()) return lifecycle.outcome();
    activateLiveControl(actionControl);
    const menuResult = await waitFor(() => {
      const newMenus = visibleMenus().filter((menu) => !menusBeforeAction.has(menu));
      if (!newMenus.length) return null;
      const menu = exactBoundSurface(newMenus, actionControl);
      if (!menu) return { invalid: true };
      const controls = exactDmUnsendControls(menu);
      return controls.length === 1
        ? { menu, control: controls[0] }
        : { invalid: true };
    }, 3_000, lifecycle.signal);
    if (lifecycle.interrupted()) return lifecycle.outcome();
    if (!menuResult?.menu) {
      return { unexpectedUi: true, reason: 'dm-unsend-menu-not-exact' };
    }
    if (!dmResolutionMatches(resolution, item) || visibleDialogs().length) {
      return { ambiguous: true, reason: 'dm-message-changed-before-unsend-choice' };
    }

    const dialogsBeforeChoice = new Set(visibleDialogs());
    if (lifecycle.interrupted()) return lifecycle.outcome();
    activateLiveControl(menuResult.control);
    const confirmation = await waitFor(() => {
      const newDialogs = visibleDialogs().filter((dialog) => !dialogsBeforeChoice.has(dialog));
      if (!newDialogs.length) return null;
      const dialog = exactBoundSurface(
        newDialogs,
        menuResult.control,
      );
      if (!dialog) return { invalid: true };
      const controls = exactDmUnsendControls(dialog);
      return controls.length === 1 ? { control: controls[0] } : { invalid: true };
    }, 3_000, lifecycle.signal);
    if (lifecycle.interrupted()) return lifecycle.outcome();
    if (!confirmation?.control) {
      return { unexpectedUi: true, reason: 'dm-unsend-confirmation-not-exact' };
    }
    if (!dmResolutionMatches(resolution, item)) {
      return { ambiguous: true, reason: 'dm-message-changed-before-final-confirmation' };
    }

    const proof = globalThis.InstaToolboxDmThreadUnsender?.messageProof;
    if (!proof) return { unexpectedUi: true, reason: 'dm-removal-verifier-unavailable' };
    const beforeRemoval = proof.removalEvidence(resolution.row);
    if (lifecycle.interrupted()) return lifecycle.outcome();
    activateLiveControl(confirmation.control);
    const settled = await proof.waitForRemoval(resolution.row, beforeRemoval, {
      contextValid: () => {
        const currentSession = inspectSession();
        return !currentSession.sessionExpired && !currentSession.challenge
          && !currentSession.actionBlocked && !currentSession.rateLimited
          && directThreadId(item.conversationId) === directThreadId(location.pathname);
      },
    });
    if (!settled) {
      if (lifecycle.interrupted()) return lifecycle.outcome(true);
      return { unexpectedUi: true, reason: 'dm-unsend-not-confirmed', uncertain: true };
    }
    const completion = await waitFor(() => {
      const currentSession = inspectSession();
      if (
        currentSession.sessionExpired
        || currentSession.challenge
        || currentSession.actionBlocked
        || currentSession.rateLimited
      ) return { sessionStop: currentSession };
      const expectedThreadId = directThreadId(item.conversationId);
      const observedThreadId = directThreadId(location.pathname);
      if (!expectedThreadId || expectedThreadId !== observedThreadId) {
        return {
          uncertain: true,
          observation: {
            ambiguous: true,
            reason: 'wrong-conversation-after-unsend',
            evidence: { expectedThreadId, observedThreadId },
          },
        };
      }
      const retainedRowDisconnected = resolution.row?.isConnected === false;
      const retainedIdentityNodeDisconnected = resolution.identityNode?.isConnected === false;
      const current = resolveReviewedDmItem(item);
      if (current.candidate) return null;
      if (!retainedRowDisconnected || !retainedIdentityNodeDisconnected) {
        return current.observation?.missing || current.observation?.reason
          ? { uncertain: true, observation: current.observation }
          : null;
      }
      if (
        current.observation?.ambiguous
        || current.observation?.unexpectedUi
        || current.observation?.exactIdentityAvailable !== true
        || current.observation?.reason !== 'exact-message-not-found'
      ) {
        return { uncertain: true, observation: current.observation };
      }
      return {
        confirmed: true,
        observation: current.observation,
        postcondition: {
          exactCandidateAbsent: true,
          exactThread: true,
          expectedThreadId,
          observedThreadId,
          observationReason: current.observation.reason,
          retainedIdentityNodeDisconnected: true,
          retainedRowDisconnected: true,
        },
      };
    }, 5_000);
    if (completion?.sessionStop) return completion.sessionStop;
    if (!completion?.confirmed) {
      if (lifecycle.interrupted()) return lifecycle.outcome(true);
      return {
        unexpectedUi: true,
        reason: 'dm-unsend-not-confirmed',
        observation: completion?.observation || null,
      };
    }
    return {
      result: 'unsent',
      conversationId: String(item.conversationId),
      messageId: String(item.messageId),
      postcondition: completion.postcondition,
      ...(lifecycle.interrupted() ? {
        needsAttention: true, interruptionReason: lifecycle.interrupted(),
        reason: 'dm-page-interrupted', uncertain: false,
      } : {}),
    };
  }

  async function waitForRelationship(expectedRelationships, username, timeoutMs = 5_000, checkContext = null) {
    return waitFor(() => {
      const contextStop = checkContext?.();
      if (contextStop) return { contextStop };
      const session = inspectSession();
      if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
        return { sessionStop: session };
      }
      const observed = relationshipFromButtons(username);
      if (!observed.ambiguous && expectedRelationships.includes(observed.relationship)) {
        return { relationship: observed.relationship };
      }
      return null;
    }, timeoutMs);
  }

  async function performReviewedProfileAction(item, runtime = {}) {
    const username = normalizeUsername(item?.username);
    const action = String(item?.action || '');
    const token = String(item?.resolutionToken || '');
    if (!username || !['follow', 'unfollow'].includes(action) || !token) {
      return { unexpectedUi: true, reason: 'invalid-live-action-request' };
    }

    // Only an isolated caller can supply these dependencies. The message
    // router deliberately passes the item alone, never options from a payload.
    const { assertAuthorized, assertContext, signal } = runtime || {};
    const guarded = assertAuthorized !== undefined || assertContext !== undefined || signal !== undefined;
    if ((runtime !== null && typeof runtime !== 'object')
      || (assertAuthorized !== undefined && typeof assertAuthorized !== 'function')
      || (assertContext !== undefined && typeof assertContext !== 'function')
      || (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) {
      return { unexpectedUi: true, reason: 'profile-runtime-invalid', dispatched: false, uncertain: false };
    }
    let dispatched = false;
    function permits(callback, phase) {
      if (!callback) return true;
      try {
        const result = callback(Object.freeze({ action, username, phase }));
        // An async answer is not a synchronous dispatch grant. Handle rejected
        // promises without allowing them to become unhandled runtime errors.
        if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
        return result === true;
      } catch { return false; }
    }
    function contextProblem(phase = 'settlement') {
      if (guarded && normalizeUsername(location.pathname) !== username) return 'profile-context-changed';
      return permits(assertContext, phase) ? null : 'profile-context-changed';
    }
    function dispatchProblem(phase) {
      if (signal?.aborted) return 'profile-action-cancelled';
      const problem = contextProblem(phase)
        || (permits(assertAuthorized, phase) ? null : 'profile-approval-revoked');
      return problem || (signal?.aborted ? 'profile-action-cancelled' : null);
    }
    function stopped(reason, detail = {}) {
      return { unexpectedUi: true, reason, ...detail,
        ...(guarded ? { dispatched, uncertain: dispatched, needsAttention: true } : {}) };
    }
    function preflight(result) {
      return { ...result, ...(guarded ? { dispatched: false, uncertain: false } : {}) };
    }
    async function settleRelationship(expected) {
      try { return await waitForRelationship(expected, username, 5_000, contextProblem); }
      catch { return { contextStop: 'profile-outcome-unavailable' }; }
    }
    function completed(result) {
      const problem = contextProblem();
      if (problem) return stopped(problem);
      return { ...result, ...(guarded ? { dispatched, uncertain: false,
        ...(signal?.aborted ? { needsAttention: true, interruptionReason: 'profile-action-cancelled' } : {}) } : {}) };
    }

    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return preflight(session);
    }

    pruneProfileResolutions();
    const resolution = profileResolutions.get(token);
    profileResolutions.delete(token);
    if (
      !resolution
      || resolution.username !== username
      || resolution.pathname !== location.pathname
      || resolution.relationship !== item.expectedRelationship
      || !resolution.control?.isConnected
    ) {
      return preflight({ ambiguous: true, reason: 'profile-resolution-expired-or-changed' });
    }

    const current = relationshipFromButtons(username);
    const expectedRelationship = action === 'follow' ? 'not-following' : 'following';
    if (
      current.ambiguous
      || current.relationship !== expectedRelationship
      || current.relationship !== resolution.relationship
      || current.profileRoot !== resolution.profileRoot
      || current.control !== resolution.control
      || normalizeUsername(location.pathname) !== username
    ) {
      return preflight({ ambiguous: true, reason: 'profile-control-changed-before-action' });
    }

    const dialogsBeforeAction = visibleDialogs();
    if (dialogsBeforeAction.length) {
      return preflight({ unexpectedUi: true, reason: 'preexisting-dialog-before-live-action' });
    }

    const initialStop = dispatchProblem('profile-control');
    if (initialStop) return stopped(initialStop);
    // Opening Following's menu is not the account mutation. Follow and the
    // final Unfollow control are; once dispatched, settle without another click.
    dispatched = action === 'follow';
    try { activateLiveControl(current.control); }
    catch { return stopped('profile-action-dispatch-error'); }
    if (action === 'follow') {
      const completion = await settleRelationship(['following', 'requested']);
      if (completion?.contextStop) return stopped(completion.contextStop);
      if (completion?.sessionStop) return guarded ? stopped('profile-session-changed', completion.sessionStop) : completion.sessionStop;
      if (!completion) return stopped('follow-not-confirmed');
      return completed({
        result: completion.relationship === 'requested' ? 'follow-requested' : 'followed',
        relationship: completion.relationship,
      });
    }

    const excludedDialogs = new Set(dialogsBeforeAction);
    let ready;
    try {
      ready = await waitFor(() => {
        const problem = dispatchProblem('unfollow-confirmation-wait');
        if (problem) return { stopped: problem };
        const control = exactUnfollowConfirmation(username, excludedDialogs);
        return control ? { control } : null;
      }, 3_000, signal);
    } catch { return stopped('unfollow-confirmation-unavailable'); }
    const confirmationStop = ready?.stopped || dispatchProblem('unfollow-confirmation');
    if (confirmationStop) return stopped(confirmationStop);
    if (!ready?.control) {
      return stopped('unfollow-confirmation-not-exact');
    }
    if (!ready.control.isConnected || exactUnfollowConfirmation(username, excludedDialogs) !== ready.control) {
      return stopped('unfollow-confirmation-not-exact');
    }
    dispatched = true;
    try { activateLiveControl(ready.control); }
    catch { return stopped('profile-action-dispatch-error'); }
    const completion = await settleRelationship(['not-following']);
    if (completion?.contextStop) return stopped(completion.contextStop);
    if (completion?.sessionStop) return guarded ? stopped('profile-session-changed', completion.sessionStop) : completion.sessionStop;
    if (!completion) return stopped('unfollow-not-confirmed');
    return completed({ result: 'unfollowed', relationship: completion.relationship });
  }

  function captureVisibleAccounts(expectedListType = '') {
    const listContext = accountListDialog(expectedListType);
    const roots = listContext ? [listContext.dialog] : [];
    const accounts = new Map();
    for (const root of roots) {
      for (const anchor of root.querySelectorAll('a[href^="/"]')) {
        const username = normalizeUsername(anchor.getAttribute('href'));
        if (!username) continue;
        accounts.set(username, {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          displayName: visibleText(anchor) === username ? '' : visibleText(anchor),
          source: 'extension-visible-dom',
        });
      }
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function scrollableWithin(root) {
    if (!root) return null;
    const candidates = [root, ...root.querySelectorAll('div, ul, section')];
    let best = null;
    for (const element of candidates) {
      const overflowY = getComputedStyle(element).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      const slack = element.scrollHeight - element.clientHeight;
      if (slack <= 8) continue;
      if (!best || slack > best.slack) best = { element, slack };
    }
    return best?.element || null;
  }

  function accountListTypeFromText(value) {
    const label = String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (/^followers(?:\s|$)/.test(label)) return 'followers';
    if (/^following(?:\s|$)/.test(label)) return 'following';
    return '';
  }

  function accountListDialog(expectedListType = '') {
    const expected = expectedListType === 'followers' || expectedListType === 'following'
      ? expectedListType
      : '';
    for (const dialog of visibleDialogs()) {
      const heading = [...dialog.querySelectorAll('[role="heading"], h1, h2')]
        .map((element) => visibleText(element))
        .find(Boolean);
      const firstLine = visibleText(dialog)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      const observedTypes = new Set(
        [dialog.getAttribute('aria-label'), heading, firstLine]
          .map(accountListTypeFromText)
          .filter(Boolean),
      );
      if (observedTypes.size !== 1) continue;
      const [observed] = observedTypes;
      if (observed && (!expected || observed === expected)) {
        return { dialog, listType: observed };
      }
    }
    return null;
  }

  function exactProfileListCount(listType, { requireScoped = false } = {}) {
    if (listType !== 'followers' && listType !== 'following') return null;
    const profileUsername = normalizeUsername(location.pathname);
    const profileHeader = requireScoped ? verifiedProfileHeader(profileUsername).root : null;
    const scopedCounts = new Set();
    const fallbackCounts = new Set();
    for (const link of document.querySelectorAll('a[role="link"], a[href="#"]')) {
      if (!visibleText(link) || link.closest?.('[hidden], [aria-hidden="true"], [role="dialog"]')) continue;
      const values = [
        link.getAttribute('title'),
        visibleText(link),
      ];
      const exactTitle = link.querySelector?.('[title]')?.getAttribute('title');
      if (exactTitle && new RegExp(`\\b${listType}$`, 'i').test(visibleText(link).trim())) {
        values.push(`${exactTitle} ${listType}`);
      }
      for (const value of values) {
        const label = String(value || '')
          .normalize('NFKC')
          .replace(/[\u00a0\u202f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const match = label.match(/^([0-9][0-9., ]*)\s+(followers|following)$/);
        if (!match || match[2] !== listType) continue;
        if (!/^(?:\d+|\d{1,3}([,. ])\d{3}(?:\1\d{3})*)$/.test(match[1])) continue;
        const digits = match[1].replace(/\D/g, '');
        if (!digits) continue;
        const count = Number(digits);
        if (!Number.isSafeInteger(count)) continue;
        fallbackCounts.add(count);
        const href = link.getAttribute?.('href');
        if (!href || !profileUsername) continue;
        // Instagram also renders profile counters as non-navigation links.
        // Trust those only inside the uniquely identified current profile header.
        if (href === '#' && profileHeader?.contains(link)) {
          scopedCounts.add(count);
          continue;
        }
        try {
          const target = new URL(href, INSTAGRAM_WEB_ORIGIN);
          if (target.origin !== INSTAGRAM_WEB_ORIGIN) continue;
          const pathname = target.pathname
            .replace(/\/+$/, '')
            .toLowerCase();
          if (pathname === `/${profileUsername}/${listType}`) scopedCounts.add(count);
        } catch {
          // Ignore malformed, non-navigation values such as JavaScript URLs.
        }
      }
    }
    if (scopedCounts.size === 1) return [...scopedCounts][0];
    if (!requireScoped && !scopedCounts.size && fallbackCounts.size === 1) return [...fallbackCounts][0];
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  // Scrolls the open followers/following dialog to enumerate the full list.
  // Read-only: it only scrolls an already-open list and reads rendered rows.
  async function collectAccountList({ maxScrolls = 1_200, settleMs = 500, listType = '' } = {}) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { ...session, accounts: [], complete: false, reason: 'session-stop' };
    }
    let expectedListType = listType === 'followers' || listType === 'following' ? listType : '';
    let listContext = accountListDialog(expectedListType);
    let root = listContext?.dialog || null;
    let scroller = scrollableWithin(root);
    if (!root) {
      return { ...session, accounts: [], complete: false, reason: 'open-a-followers-or-following-list' };
    }
    const observedListType = listContext?.listType || expectedListType;
    expectedListType = observedListType;
    const profilePath = location.pathname;
    const expectedCountAtStart = exactProfileListCount(observedListType);

    const accounts = new Map();
    const harvest = () => {
      for (const anchor of root.querySelectorAll('a[href^="/"]')) {
        const username = normalizeUsername(anchor.getAttribute('href'));
        if (!username || accounts.has(username)) continue;
        const label = visibleText(anchor);
        accounts.set(username, {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          displayName: label === username ? '' : label,
          source: 'extension-scrolled-dom',
        });
      }
    };

    harvest();
    // Recycled rows cannot all exist in the DOM at once. Start at the top and
    // retain each window before advancing by less than one viewport.
    if (scroller) {
      scroller.scrollTop = 0;
      await sleep(settleMs);
    }
    let complete = !scroller
      && Number.isSafeInteger(expectedCountAtStart)
      && accounts.size === expectedCountAtStart;
    let stagnantRounds = 0;
    for (let round = 0; round < maxScrolls; round += 1) {
      const currentContext = accountListDialog(expectedListType);
      if (!currentContext || location.pathname !== profilePath) {
        complete = false;
        break;
      }
      const currentRoot = currentContext.dialog;
      const currentScroller = scrollableWithin(currentRoot);
      if (currentRoot !== root || currentScroller !== scroller) {
        listContext = currentContext;
        root = currentRoot;
        scroller = currentScroller;
        stagnantRounds = 0;
        if (scroller) {
          scroller.scrollTop = 0;
          await sleep(settleMs);
        }
        harvest();
      }
      harvest();
      if (!scroller) {
        complete = Number.isSafeInteger(expectedCountAtStart)
          && accounts.size === expectedCountAtStart;
        break;
      }
      const beforeCount = accounts.size;
      const beforeHeight = scroller.scrollHeight;
      const beforeTop = scroller.scrollTop;
      // Nudge only at the end to trigger a stalled lazy-loading sentinel.
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8) {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollTop - Math.max(80, Math.floor(scroller.clientHeight / 2)),
        );
        await sleep(settleMs);
        harvest();
      }
      scroller.scrollTop = Math.min(
        Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        beforeTop + Math.max(1, Math.floor(scroller.clientHeight * 0.75)),
      );
      await sleep(settleMs);
      // A long Followers list keeps a spinner up well past the settle delay.
      // Waiting for it to clear is what stops a big list being declared
      // complete while thousands of rows are still unfetched.
      let loading = false;
      for (let wait = 0; wait < 24; wait += 1) {
        loading = Boolean(root.querySelector('[role="progressbar"], svg[aria-label*="Loading" i]'));
        if (!loading) break;
        await sleep(250);
      }
      const settledContext = accountListDialog(expectedListType);
      if (location.pathname !== profilePath || !settledContext) {
        complete = false;
        break;
      }
      if (settledContext.dialog !== root || scrollableWithin(root) !== scroller) continue;
      harvest();

      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
      const grew = accounts.size > beforeCount || scroller.scrollHeight > beforeHeight;
      stagnantRounds = grew || loading ? 0 : stagnantRounds + 1;
      const check = inspectSession();
      if (check.sessionExpired || check.challenge || check.actionBlocked || check.rateLimited) {
        return {
          ...check,
          accounts: [...accounts.values()],
          complete: false,
          reason: 'session-stop',
        };
      }
      if (atBottom && !loading
        && Number.isSafeInteger(expectedCountAtStart)
        && accounts.size === expectedCountAtStart) {
        complete = true;
        break;
      }
      // Instagram lazy-loads in bursts and can pause between pages, so a couple
      // of quiet rounds does not mean the end. Be patient before concluding.
      if (atBottom && !loading && stagnantRounds >= 10) {
        break;
      }
    }

    const expectedCountAtEnd = exactProfileListCount(observedListType);
    const expectedCount = expectedCountAtEnd ?? expectedCountAtStart;
    const countChanged = Number.isSafeInteger(expectedCountAtStart)
      && Number.isSafeInteger(expectedCountAtEnd)
      && expectedCountAtStart !== expectedCountAtEnd;
    const countMismatch = Number.isSafeInteger(expectedCount)
      && accounts.size !== expectedCount;
    if (countChanged || countMismatch || !Number.isSafeInteger(expectedCount)) complete = false;

    return {
      ...session,
      accounts: [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username)),
      complete,
      listType: listContext?.listType || null,
      expectedCount,
      observedCount: accounts.size,
      capturedAt: new Date().toISOString(),
      reason: countChanged
        ? 'list-count-changed'
        : countMismatch
          ? 'list-count-mismatch'
          : !Number.isSafeInteger(expectedCount)
            ? 'list-count-unverified'
            : complete
              ? 'list-complete'
              : 'list-truncated',
    };
  }

  // Enumerates messages the signed-in account sent in the open conversation.
  // Read-only: no controls are activated here.
  async function enumerateSentDms({ maxScrolls = 300, settleMs = 300, limit = 500 } = {}) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { ...session, messages: [], complete: false, reason: 'session-stop' };
    }
    const conversationId = currentDirectThreadId();
    if (!conversationId) {
      return {
        ...session,
        messages: [],
        complete: false,
        reason: 'open-an-instagram-conversation',
      };
    }

    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
      || document.querySelector('main');
    const scroller = scrollableWithin(scope);
    const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
      .map((attribute) => `[${attribute}]`)
      .join(', ');
    const found = new Map();

    const harvest = () => {
      const identityNodes = [...(scope?.querySelectorAll?.(identitySelector) || [])]
        .filter((element) => visibleText(element));
      for (const identityNode of identityNodes) {
        const row = identityNode.closest?.('[role="row"], [role="listitem"]') || identityNode;
        const identity = dmMessageId(identityNode) || dmMessageId(row);
        if (!identity?.value) continue;
        const ownership = dmOwnership(row, identityNode);
        if (ownership.sentByMe !== true) continue;
        const timestamp = dmMessageTimestamp(identityNode, row);
        if (timestamp?.timestamp == null) continue;
        const contents = dmContentCandidates(row);
        // Only exactly-identifiable single-content rows are eligible for unsend.
        if (contents.length !== 1) continue;
        const key = identity.value;
        if (found.has(key)) continue;
        found.set(key, {
          conversationId,
          messageId: identity.value,
          identityBasis: identity.attribute,
          timestamp: timestamp.timestamp,
          timestampBasis: timestamp.basis,
          contentDigest: dmContentDigest(contents[0]),
          preview: contents[0].slice(0, 120),
          ownershipBasis: ownership.basis,
          sentByMe: true,
        });
      }
    };

    harvest();
    let complete = !scroller;
    let stagnantRounds = 0;
    // Instagram renders the thread with `flex-direction: column-reverse`, so
    // scrollTop 0 is the NEWEST message and older ones live at NEGATIVE
    // scrollTop. Scrolling to 0 to "go up" would sit on the newest message
    // forever and never page in history.
    const reversed = getComputedStyle(scroller || scope).flexDirection === 'column-reverse'
      || scroller?.scrollTop < 0;
    const oldestOffset = () => (reversed
      ? -(scroller.scrollHeight - scroller.clientHeight)
      : 0);

    for (let round = 0; scroller && round < maxScrolls && found.size < limit; round += 1) {
      const beforeCount = found.size;
      const beforeHeight = scroller.scrollHeight;
      const target = oldestOffset();
      // Nudge off the edge first so the jump is a real scroll change even when
      // we are already pinned at the oldest end.
      if (Math.abs(scroller.scrollTop - target) <= 8) {
        scroller.scrollTop = target + (reversed ? 1 : -1)
          * Math.max(80, Math.floor(scroller.clientHeight / 2));
        await sleep(60);
      }
      scroller.scrollTop = target;
      await sleep(settleMs);
      // Instagram shows a spinner while a page loads; wait it out rather than
      // guessing with a fixed delay.
      for (let wait = 0; wait < 20; wait += 1) {
        if (!scope?.querySelector?.('[role="progressbar"], svg[aria-label*="Loading" i]')) break;
        await sleep(250);
      }
      harvest();

      const atTop = Math.abs(scroller.scrollTop - oldestOffset()) <= 8;
      const grew = found.size > beforeCount || scroller.scrollHeight > beforeHeight;
      stagnantRounds = grew ? 0 : stagnantRounds + 1;
      if (atTop && stagnantRounds >= 3) {
        complete = true;
        break;
      }
      const check = inspectSession();
      if (check.sessionExpired || check.challenge || check.actionBlocked || check.rateLimited) {
        return {
          ...check,
          messages: [...found.values()],
          complete: false,
          reason: 'session-stop',
        };
      }
    }

    const messages = [...found.values()]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
    return {
      ...session,
      conversationId,
      messages,
      complete,
      exactIdentityAvailable: messages.length > 0,
      capturedAt: new Date().toISOString(),
      reason: messages.length
        ? (complete ? 'thread-complete' : 'thread-truncated')
        : 'exact-message-identity-unavailable',
    };
  }

  function pageKind() {
    const path = location.pathname.toLowerCase();
    if (path.startsWith('/accounts/login')) return 'login';
    if (path.startsWith('/direct/')) return 'messages';
    if (path.startsWith('/explore')) return 'explore';
    if (path.startsWith('/reel')) return 'reels';
    if (path.startsWith('/stories')) return 'stories';
    if (path.startsWith('/p/')) return 'post';
    return normalizeUsername(location.pathname) ? 'profile' : 'feed';
  }

  function inspectVisibleMessages() {
    const session = inspectSession();
    const kind = pageKind();
    const conversationId = currentDirectThreadId();
    if (!conversationId) {
      return {
        ...session,
        pageKind: kind,
        conversationId: '',
        conversationLabel: '',
        exactIdentityAvailable: false,
        ownershipAvailable: false,
        fragments: [],
        reason: 'open-an-instagram-conversation',
        capturedAt: new Date().toISOString(),
      };
    }

    const main = document.querySelector('main');
    const heading = [...(main?.querySelectorAll('h1, h2, header [dir="auto"]') || [])]
      .map(visibleText)
      .find(Boolean) || '';
    const rowText = [...(main?.querySelectorAll('[role="row"] [dir="auto"]') || [])];
    const candidates = (rowText.length
      ? rowText
      : [...(main?.querySelectorAll('div[dir="auto"]') || [])])
      .filter((element) => !element.querySelector('[dir="auto"]'))
      .filter((element) => !element.closest('header, nav, button, [role="button"], a'))
      .map(visibleText)
      .filter((text) => text && text.length <= 500);
    const fragments = [...new Set(candidates)].slice(-30).map((text, index) => ({
      index,
      text,
      source: 'extension-visible-dom-fragment',
    }));
    return {
      ...session,
      pageKind: kind,
      conversationId,
      conversationLabel: heading,
      exactIdentityAvailable: false,
      ownershipAvailable: false,
      fragments,
      reason: fragments.length ? 'visible-fragments-only' : 'no-visible-message-fragments',
      capturedAt: new Date().toISOString(),
    };
  }

  function inspectPageContext() {
    const kind = pageKind();
    const session = inspectSession();
    return {
      ...session,
      pageKind: kind,
      url: location.href,
      username: kind === 'profile' ? normalizeUsername(location.pathname) : '',
      profile: kind === 'profile' ? inspectProfile(location.pathname) : null,
    };
  }

  globalThis.InstaToolboxInstagramInspector = Object.freeze({
    captureVisibleAccounts,
    collectAccountList,
    detectAuthenticatedUsername,
    enumerateSentDms,
    fetchFollowerComparison,
    followerComparisonRecord,
    followerComparisonReport,
    followerComparisonSummary,
    normalizeFollowerDiagnostics,
    inspectPageContext,
    inspectProfile,
    inspectReviewedDmItem,
    inspectSession,
    inspectVisibleMessages,
    normalizeUsername,
    // The executors are exported so the userscript build runs this same audited
    // engine instead of carrying a second copy of the DOM logic. Both callers
    // still have to supply a resolution token minted by the matching inspect
    // call, so exporting them does not widen what an action can do.
    performReviewedDmUnsend,
    performReviewedProfileAction,
    reviewedTargetElement,
  });

  // Only the extension build has a runtime to talk to. Under Tampermonkey this
  // file provides the engine and the message router is simply not installed.
  if (!globalThis.chrome?.runtime?.onMessage?.addListener) return;

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.kind === 'insta-toolbox-inspect-profile') {
      sendResponse(inspectProfile(request.username));
      return;
    }
    if (request?.kind === 'insta-toolbox-inspect-session') {
      sendResponse(inspectSession());
      return;
    }
    if (request?.kind === 'insta-toolbox-capture-visible-accounts') {
      sendResponse({
        capturedAt: new Date().toISOString(),
        accounts: captureVisibleAccounts(),
      });
      return;
    }
    if (request?.kind === 'insta-toolbox-collect-account-list') {
      collectAccountList(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'account-list-collection-failed' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-enumerate-sent-dms') {
      enumerateSentDms(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'sent-dm-enumeration-failed' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-inspect-visible-messages') {
      sendResponse(inspectVisibleMessages());
      return;
    }
    if (request?.kind === 'insta-toolbox-inspect-reviewed-dm-item') {
      sendResponse(inspectReviewedDmItem(request.item));
      return;
    }
    if (request?.kind === 'insta-toolbox-perform-reviewed-profile-action') {
      performReviewedProfileAction(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-action-driver-error' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-perform-reviewed-dm-unsend') {
      performReviewedDmUnsend(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-dm-driver-error' }));
      return true;
    }
  });
})();

(() => {
  'use strict';
  if (globalThis.InstaToolboxInstagramViewer) return;
  const origin = 'https://www.instagram.com';
  const username = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(normalized) ? normalized : null;
  };
  function accountKey(value) {
    const normalized = username(value);
    if (!normalized) return null;
    return `iguser-v1-${[...normalized].map((character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
  }
  const visible = (node) => Boolean(node?.isConnected
    && !node.closest?.('[hidden], [aria-hidden="true"]')
    && node.getClientRects?.().length);
  function pathOf(link) {
    try {
      const url = new URL(link.getAttribute('href'), origin);
      return url.origin === origin && !url.username && !url.password
        && !url.search && !url.hash ? url.pathname : '';
    } catch { return ''; }
  }
  function inspect({ document = globalThis.document, location = globalThis.location,
    session = globalThis.InstaToolboxInstagramInspector?.inspectSession?.() || {} } = {}) {
    const unavailable = { accountVerified: false, usable: false, accountId: null, threadId: null };
    if (location?.origin !== origin) return { ...unavailable, reason: 'instagram-origin-required' };
    const threadId = String(location.pathname).match(/^\/direct\/t\/([0-9]+)\/?$/)?.[1] || null;
    const restriction = session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited;
    if (restriction) return { ...unavailable, threadId, restriction: true, reason: 'instagram-restricted' };
    const lists = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
    if (lists.length !== 1) return { ...unavailable, threadId, reason: 'account-picker-unavailable' };
    const list = lists[0];
    const headings = [...list.querySelectorAll('h2')].filter((heading) => {
      const picker = heading.closest('[role="button"][tabindex="0"]');
      return visible(heading) && picker && list.contains(picker) && visible(picker);
    });
    if (headings.length !== 1) return { ...unavailable, threadId, reason: 'account-picker-ambiguous' };
    const accountId = username(headings[0].textContent);
    if (!accountId) return { ...unavailable, threadId, reason: 'account-name-unavailable' };
    const profiles = [...document.querySelectorAll('a[role="link"][href]')].filter((link) => {
      if (!visible(link) || list.contains(link)
        || link.getAttribute('aria-label')?.startsWith('Open the profile page of')) return false;
      const match = pathOf(link).match(/^\/([a-z0-9._]+)\/?$/i);
      if (!match || username(match[1]) !== accountId) return false;
      const pictures = [...link.querySelectorAll('img')].filter(visible);
      if (pictures.length !== 1
        || String(pictures[0].getAttribute('alt')).toLowerCase() !== `${accountId}'s profile picture`) return false;
      for (let rail = link.parentElement; rail && rail !== document.body; rail = rail.parentElement) {
        if (rail.contains(list)) return false;
        const paths = new Set([...rail.querySelectorAll('a[href]')].filter(visible).map(pathOf));
        if (paths.has('/') && (paths.has('/reels/') || paths.has('/reels'))
          && (paths.has('/direct/inbox/') || paths.has('/direct/inbox'))) return true;
      }
      return false;
    });
    if (profiles.length !== 1) return { ...unavailable, threadId, reason: 'account-navigation-unavailable' };
    return { accountVerified: true, accountId, threadId, usable: Boolean(threadId),
      accountKey: accountKey(accountId), identityKind: 'verified-viewer-username',
      restriction: false, evidence: 'visible-account-picker-and-navigation' };
  }
  Object.defineProperty(globalThis, 'InstaToolboxInstagramViewer', {
    configurable: false, writable: false, value: Object.freeze({ inspect, accountKey }),
  });
})();

(() => {
  'use strict';
  if (globalThis.InstaToolboxReactionCleanup) return;

  // A separate pass over surviving messages; it never invokes message Unsend.
  function create({ reactions = globalThis.InstaToolboxOwnReactions,
    createWalker = globalThis.InstaToolboxDmThreadUnsender?.createMessageWalker,
    inspectContext, now = Date.now } = {}) {
    if (typeof createWalker !== 'function' || typeof inspectContext !== 'function'
      || typeof reactions?.create !== 'function' || typeof reactions?.consumePlan !== 'function') {
      throw new Error('reaction-cleanup-unavailable');
    }
    let current = null;
    const wait = (ms, signal) => new Promise((resolve, reject) => {
      let timer, settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new DOMException('Stopped', 'AbortError'));
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(), ms);
      if (signal.aborted) abort();
    });
    let state = Object.freeze({ status: 'idle', removed: 0, skipped: 0,
      uncertain: 0, checked: 0, canStop: false, message: 'Ready' });
    const listeners = new Set();
    function publish(patch) {
      state = Object.freeze({ ...state, ...patch });
      for (const listener of listeners) { try { listener({ ...state }); } catch {} }
      return { ...state };
    }
    function contextFor(plan) {
      const context = inspectContext();
      if (context?.then || context?.threadId !== plan.threadId
        || context?.accountId !== plan.accountUsername || context.accountVerified !== true
        || context.usable !== true || context.restriction) throw new Error('reaction-context-changed');
      return context;
    }
    return Object.freeze({
      snapshot: () => ({ ...state }),
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener); listener({ ...state });
        return () => listeners.delete(listener);
      },
      stop() {
        if (!current || current.controller.signal.aborted) return false;
        publish({ status: 'stopping', canStop: false, message: 'Stopping after this reaction…' });
        current.controller.abort('Stopped'); return true;
      },
      async start({ plan, signal, onVerifiedRemoval } = {}) {
        if (current) throw new Error('reaction-cleanup-active');
        if (!plan || (signal && (typeof signal.aborted !== 'boolean'
          || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) {
          throw new Error('reaction-review-required');
        }
        contextFor(plan);
        reactions.consumePlan(plan, plan.threadId, plan.accountUsername);
        const controller = new AbortController();
        const run = { controller };
        current = run;
        const abort = () => controller.abort(signal?.reason || 'Stopped');
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        let walker;
        const checkRun = () => {
          if (current !== run || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
          if (plan.expiresAt <= now()) throw new Error('reaction-review-expired');
          contextFor(plan); return true;
        };
        const assertAuthorized = () => {
          checkRun();
          if (walker && walker.assertCurrent() !== true) throw new Error('reaction-traversal-interrupted');
          return true;
        };
        publish({ status: 'running', removed: 0, skipped: 0, uncertain: 0, complete: false, reason: null,
          checked: 0, canStop: true, message: 'Checking your reactions…' });
        try {
          assertAuthorized();
          walker = createWalker({ threadId: plan.threadId, expiresAt: plan.expiresAt,
            signal: controller.signal, order: 'newest', holdUntilClosed: true });
          if (typeof walker?.assertCurrent !== 'function' || typeof walker.next !== 'function'
            || typeof walker.close !== 'function') throw new Error('reaction-traversal-unavailable');
          const adapter = reactions.create({ inspectContext, assertAuthorized });
          let completed = false;
          let nextRemovalAt = 0;
          while (plan.limit === null || state.removed < plan.limit) {
            assertAuthorized();
            const item = await walker.next();
            checkRun();
            if (item.done) {
              if (!['exhausted', 'stable-exhaustion'].includes(item.reason)) {
                throw new Error(item.reason || 'reaction-traversal-unproven');
              }
              completed = true; break;
            }
            assertAuthorized();
            const row = item.value?.row || item.value;
            if (!row?.isConnected) throw new Error('reaction-message-changed');
            const badges = adapter.badges(row);
            for (const badge of badges) {
              assertAuthorized();
              if (plan.limit !== null && state.removed >= plan.limit) break;
              const remaining = nextRemovalAt - now();
              if (remaining > 0) await wait(remaining, controller.signal);
              assertAuthorized();
              const result = await adapter.remove({ row, badge, threadId: plan.threadId,
                accountId: plan.accountUsername, signal: controller.signal });
              if (result?.verified === true && result.removed === 1) {
                nextRemovalAt = now() + 1_000;
                publish({ removed: state.removed + 1,
                  message: `${state.removed + 1} reaction${state.removed === 0 ? '' : 's'} removed` });
                // Count settled removals even if Stop arrived after dispatch.
                if (typeof onVerifiedRemoval === 'function') {
                  try { await onVerifiedRemoval(Object.freeze({ removed: state.removed, threadId: plan.threadId })); }
                  catch { throw new Error('reaction-checkpoint-failed'); }
                }
                if (result.needsAttention) throw new Error(result.reason || 'reaction-dialog-close-unavailable');
              } else if (result?.skipped === true) {
                publish({ skipped: state.skipped + 1 });
              } else {
                throw Object.assign(new Error('reaction-outcome-uncertain'), { code: 'REACTION_OUTCOME_UNCERTAIN' });
              }
            }
            publish({ checked: state.checked + 1 });
          }
          if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
          publish({ status: 'completed', complete: completed, canStop: false,
            message: `${state.removed} reaction${state.removed === 1 ? '' : 's'} removed${state.skipped ? ` · ${state.skipped} skipped` : ''}` });
        } catch (error) {
          const uncertain = error?.code === 'REACTION_OUTCOME_UNCERTAIN';
          const stopped = !uncertain && controller.signal.aborted;
          publish({ status: stopped ? 'stopped' : 'needs-attention', complete: false,
            uncertain: uncertain ? 1 : 0, canStop: false,
            reason: uncertain ? 'reaction-outcome-uncertain' : error?.message || 'reaction-cleanup-interrupted',
            message: uncertain
              ? 'Reaction removal is uncertain. Check the conversation before trying again.'
              : stopped ? `Stopped · ${state.removed} reaction${state.removed === 1 ? '' : 's'} removed`
                : error?.message === 'reaction-checkpoint-failed'
                  ? `${state.removed} reaction${state.removed === 1 ? '' : 's'} removed; the local result could not be saved.`
                  : error?.message === 'reaction-dialog-close-unavailable'
                    ? `${state.removed} reaction${state.removed === 1 ? '' : 's'} removed. Close Instagram’s reaction list before continuing.`
                  : 'Reaction cleanup stopped. The conversation needs attention.' });
        } finally {
          try { walker?.close(); } finally {
            signal?.removeEventListener('abort', abort);
            if (current === run) current = null;
          }
        }
        return { ...state };
      },
    });
  }
  Object.defineProperty(globalThis, 'InstaToolboxReactionCleanup', {
    configurable: false, writable: false, value: Object.freeze({ create }),
  });
})();

const localModules = Object.create(null);
localModules["extension/inbox-discovery.js"] = (() => {

const ORIGIN = 'https://www.instagram.com';
const SECTIONS = ['primary', 'general', 'requests'];
const validAccount = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function inboxThreadId(href) {
  if (typeof href !== 'string' || href.length > 2_048) return null;
  try {
    const url = new URL(href, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password) return null;
    return /^\/direct\/t\/([0-9]{1,128})\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

// Collects already rendered links. Navigation/scrolling and terminal evidence
// belong to a separately reviewed native-inbox adapter, not this collector.
function createInboxDiscovery({ accountId, sections = ['primary'], maxThreads = 1_000, maxSamples = 250, proveTerminal = null }) {
  if (!validAccount(accountId)) throw new Error('account-identity-required');
  if (!Array.isArray(sections) || !sections.length || !sections.every((section) => SECTIONS.includes(section))) throw new Error('inbox-section-invalid');
  if (!Number.isSafeInteger(maxThreads) || maxThreads < 1 || maxThreads > 10_000
    || !Number.isSafeInteger(maxSamples) || maxSamples < 1 || maxSamples > 1_000) throw new Error('discovery-bound-invalid');
  if (proveTerminal !== null && typeof proveTerminal !== 'function') throw new Error('terminal-adapter-invalid');
  const sectionNames = [...new Set(sections)];
  const inventory = new Map();
  const sectionState = new Map(sectionNames.map((section) => [section, { section, samples: 0, complete: false, reason: 'not-scanned' }]));
  let stopped = false;
  let stopReason = null;
  const snapshot = () => ({
    version: 1, accountId, complete: !stopped && [...sectionState.values()].every((section) => section.complete),
    stopped, reason: stopReason,
    sections: [...sectionState.values()].map((section) => ({ ...section })),
    conversations: [...inventory.values()].map((conversation) => ({ threadId: conversation.threadId, sections: [...conversation.sections] })),
  });
  function stop(reason) { stopped = true; stopReason = reason; return snapshot(); }
  return Object.freeze({
    snapshot,
    stop: () => stop('stopped'),
    observe({ root, section, observedAccountId, loading = false, signal } = {}) {
      if (stopped) return snapshot();
      if (signal?.aborted) return stop('cancelled');
      if (observedAccountId !== accountId) return stop('account-changed');
      const state = sectionState.get(section);
      if (!state) throw new Error('section-not-requested');
      if (!root || typeof root.querySelectorAll !== 'function' || root.isConnected === false) {
        state.complete = false; state.reason = 'inbox-container-unavailable'; return snapshot();
      }
      if (state.samples >= maxSamples) return stop('sample-limit');
      state.samples += 1;
      state.complete = false;
      state.reason = loading ? 'loading' : 'partial';
      for (const anchor of root.querySelectorAll('a[href]')) {
        if (signal?.aborted) return stop('cancelled');
        if (anchor.isConnected === false || anchor.closest?.('[aria-hidden="true"], [hidden]')) continue;
        const threadId = inboxThreadId(anchor.getAttribute('href'));
        if (!threadId) continue;
        let conversation = inventory.get(threadId);
        if (!conversation) {
          if (inventory.size >= maxThreads) return stop('thread-limit');
          conversation = { threadId, sections: new Set() }; inventory.set(threadId, conversation);
        }
        conversation.sections.add(section);
      }
      // A quiet viewport or repeated last row alone is not exhaustion evidence.
      // No native proof adapter ships with this module, so default is partial.
      if (!loading && proveTerminal) {
        try {
          const proof = proveTerminal({ root, section, accountId, samples: state.samples });
          state.complete = proof?.kind === 'native-terminal-marker'
            && proof.accountId === accountId && proof.section === section
            && proof.noPendingLoad === true && proof.stable === true;
          if (state.complete) state.reason = null;
        } catch { state.reason = 'terminal-proof-unavailable'; }
      }
      if (signal?.aborted) return stop('cancelled');
      return snapshot();
    },
  });
}

return Object.freeze({ inboxThreadId, createInboxDiscovery });
})();
localModules["extension/inbox-native-navigation.js"] = (() => {
const { inboxThreadId } = localModules["extension/inbox-discovery.js"];

const ORIGIN = 'https://www.instagram.com';
const SECTION_LABELS = { primary: 'Primary', general: 'General', requests: 'Requests' };
function nativeInboxSection(value) {
  const label = String(value || '').trim();
  if (/^Requests?(?:\s*\(\d+\))?$/.test(label)) return 'requests';
  return Object.keys(SECTION_LABELS).find((section) => SECTION_LABELS[section] === label) || null;
}
const visible = (node) => node?.isConnected !== false && !node?.closest?.('[hidden], [aria-hidden="true"]')
  && (!node?.getClientRects || node.getClientRects().length > 0);
const inboxUrl = (href) => {
  try { const url = new URL(href, ORIGIN); return url.origin === ORIGIN && !url.username && !url.password && /^\/direct\/inbox\/?$/.test(url.pathname); }
  catch { return false; }
};

// Navigation can mark a conversation read. It never starts a cleanup runner.
function createNativeInboxDiscovery({
  accountId, resolveAccount, navigationAcknowledged = false,
  document = globalThis.document, window = globalThis.window,
  sections = ['primary'], expiresAt, now = Date.now, signal,
  maxThreads = 1_000, maxSamples = 100, maxVisits = 2_000,
  routeTimeoutMs = 8_000, settleMs = 400, proveTerminal = null, resolveSection = null, onProgress = null,
} = {}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId || '') || typeof resolveAccount !== 'function') throw new Error('account-identity-required');
  if (!Array.isArray(sections) || !sections.length || sections.some((name) => !Object.hasOwn(SECTION_LABELS, name))) throw new Error('inbox-section-invalid');
  for (const [value, ceiling] of [[maxThreads, 10_000], [maxSamples, 1_000], [maxVisits, 20_000], [routeTimeoutMs, 30_000], [settleMs, 5_000]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error('discovery-bound-invalid');
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error('discovery-expired');
  if (proveTerminal !== null && typeof proveTerminal !== 'function') throw new Error('terminal-adapter-invalid');
  if (resolveSection !== null && typeof resolveSection !== 'function') throw new Error('section-adapter-invalid');
  if (onProgress !== null && typeof onProgress !== 'function') throw new Error('progress-adapter-invalid');
  const sectionState = [...new Set(sections)].map((section) => ({ section, samples: 0, complete: false, reason: 'not-scanned' }));
  const inventory = new Map();
  // Native row evidence is private to this instance; snapshots never retain it.
  const navigationEvidence = new Map();
  const displayLabels = new Map();
  const controller = new AbortController();
  const discoveryContext = { expiresAt, signal, controller, expiryReason: 'discovery-expired' };
  let started = false, finished = false, stopped = false, reason = null, visits = 0;
  let navigator = null;
  const href = () => String(window.location.href);
  const snapshot = () => ({
    version: 1, accountId, complete: !stopped && sectionState.every((state) => state.complete),
    stopped, reason, visits, needsInboxReturn: !inboxUrl(href()),
    sections: sectionState.map((state) => ({ ...state })),
    conversations: [...inventory].map(([threadId, names]) => ({ threadId, sections: [...names] })),
  });
  const publish = () => { try { onProgress?.(snapshot()); } catch {} };
  function guard(context = discoveryContext) {
    if (context.controller.signal.aborted || context.signal?.aborted) throw new Error(context.stopReason || 'cancelled');
    if (now() >= context.expiresAt) throw new Error(context.expiryReason);
    if (new URL(href()).origin !== ORIGIN) { displayLabels.clear(); throw new Error('origin-changed'); }
    // A synchronous isolated-world resolver prevents a hung identity lookup
    // from retaining navigation authority. Page storage is not an authority.
    const identity = resolveAccount();
    if (identity?.then || identity?.verified !== true || identity.accountId !== accountId) {
      displayLabels.clear(); throw new Error('account-changed');
    }
    if (identity.restriction) throw new Error('account-restricted');
  }
  function waitFor(check, timeout = routeTimeoutMs, context = discoveryContext) {
    return new Promise((resolve, reject) => {
      let timer, poll, observer, settled = false;
      const timeoutDeadline = now() + timeout;
      const deadline = Math.min(timeoutDeadline, context.expiresAt);
      const deadlineReason = context.expiresAt <= timeoutDeadline
        ? context.expiryReason
        : 'navigation-timeout';
      const finish = (error, value) => {
        if (settled) return; settled = true;
        clearTimeout(timer); clearInterval(poll); observer?.disconnect();
        window.removeEventListener?.('popstate', inspect); window.removeEventListener?.('hashchange', inspect);
        context.signal?.removeEventListener('abort', inspect); context.controller.signal.removeEventListener('abort', inspect);
        error ? reject(error) : resolve(value);
      };
      function inspect() {
        if (settled) return;
        try {
          guard(context);
          if (now() >= deadline) return finish(new Error(deadlineReason));
          const result = check(); if (result) finish(null, result);
        }
        catch (error) { finish(error); }
      }
      try {
        inspect(); if (settled) return;
        if (window.MutationObserver) { observer = new window.MutationObserver(inspect); observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true }); }
        window.addEventListener?.('popstate', inspect); window.addEventListener?.('hashchange', inspect);
        context.signal?.addEventListener('abort', inspect, { once: true }); context.controller.signal.addEventListener('abort', inspect, { once: true });
        poll = setInterval(inspect, Math.min(50, Math.max(1, Math.floor(timeout / 4))));
        timer = setTimeout(() => { inspect(); if (!settled) finish(new Error(deadlineReason)); }, Math.max(0, deadline - now()));
        inspect();
      } catch (error) { finish(error); }
    });
  }
  const settle = async (context = discoveryContext) => {
    const until = now() + settleMs;
    await waitFor(() => now() >= until, settleMs + 100, context);
  };
  function listRoot() {
    const roots = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
    if (roots.length !== 1) throw new Error('inbox-container-unavailable');
    return roots[0];
  }
  function messagePanes() {
    return [...document.querySelectorAll('[data-pagelet="IGDMessagesList"]')];
  }
  function readyMessagePane() {
    const panes = messagePanes().filter(visible);
    if (panes.length !== 1) return null;
    const pane = panes[0];
    if (pane.getAttribute?.('aria-busy') === 'true'
      || pane.closest?.('[aria-busy="true"]')
      || [...pane.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible)) return null;
    const actions = [...pane.querySelectorAll('[aria-label="Message actions"]')].filter(visible);
    // No observed native empty-state marker binds an empty pane to a thread.
    // A shell or skeleton alone cannot authorize the message runner.
    return actions.length ? { pane, actions } : null;
  }
  async function freshMessagePane(threadId, priorPanes, priorActions, context = discoveryContext, timeout = routeTimeoutMs) {
    let candidate = null, stableSince = null;
    return waitFor(() => {
      const actual = inboxThreadId(href());
      if (actual && actual !== threadId) throw new Error('conversation-changed');
      if (!actual && !inboxUrl(href())) throw new Error('unexpected-route');
      const ready = actual === threadId ? readyMessagePane() : null;
      if (!ready || priorPanes.includes(ready.pane)
        || priorPanes.some((pane) => pane.isConnected !== false)
        || priorActions.some((action) => ready.pane.contains(action))) {
        candidate = null; stableSince = null; return false;
      }
      if (candidate?.pane !== ready.pane || candidate.actions.length !== ready.actions.length
        || candidate.actions.some((action, index) => action !== ready.actions[index])) {
        candidate = ready; stableSince = now(); return false;
      }
      return now() - stableSince >= settleMs ? ready : false;
    }, timeout, context);
  }
  function nativeDisplayLabel(pane, priorHeaders) {
    // The observed header and composer are sibling branches of one chat.
    // A heading elsewhere in main, the inbox rail or a message is not a title.
    for (let parent = pane.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth += 1) {
      const branches = [...(parent.children || [])];
      if (branches.length !== 2) continue;
      const header = branches.find((node) => node.getAttribute?.('data-pagelet') === 'IGDInboxHeaderOffMsys');
      const content = branches.find((node) => node !== header && node.contains?.(pane));
      if (!header || !content || !visible(header)) continue;
      if (priorHeaders.includes(header) || header.closest?.('[aria-busy="true"]')
        || header.getAttribute?.('aria-busy') === 'true'
        || [...header.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible)) return null;
      if (parent.querySelectorAll('[data-pagelet="IGDMessagesList"]').length !== 1
        || parent.querySelectorAll('[aria-label="Thread list"]').length
        || [...content.querySelectorAll('[data-pagelet="IGDComposerForCannes"]')].filter(visible).length !== 1) return null;
      const headings = [...header.querySelectorAll('h2')].filter(visible);
      if (headings.length !== 1) return null;
      const title = String(headings[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length > 160 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(title)) return null;
      const links = [...header.querySelectorAll('a[role="link"][href]')].filter((node) => visible(node)
        && String(node.getAttribute('aria-label') || '').startsWith('Open the profile page of '));
      let username = null;
      if (links.length === 1 && links[0].contains(headings[0])) {
        try {
          const url = new URL(links[0].getAttribute('href'), ORIGIN);
          const match = /^\/([a-zA-Z0-9._]{1,30})\/?$/.exec(url.pathname);
          if (url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && match
            && !['accounts', 'direct', 'explore', 'reels', 'stories', 'p', 'reel', 'about', 'legal'].includes(match[1].toLowerCase())) {
            username = match[1].toLowerCase();
          }
        } catch {}
      }
      return Object.freeze({ title, username, kind: username ? 'profile' : 'chat-title', source: 'native-conversation-header' });
    }
    return null;
  }
  function auxiliaryCollection(node, root) {
    // Notes occupy a separate native role=list inside Thread list. Avatar
    // images alone do not distinguish those profile buttons from threads.
    for (let current = node; current && current !== root; current = current.parentElement) {
      if (current.getAttribute?.('role') === 'list'
        || current.getAttribute?.('aria-roledescription')?.trim().toLowerCase() === 'carousel') return true;
    }
    return false;
  }
  function rows(root) {
    return [...root.querySelectorAll('[role="button"], a[href]')].filter((row) => {
      if (!visible(row) || auxiliaryCollection(row, root)) return false;
      if (row.getAttribute?.('aria-disabled') === 'true' || row.disabled) return false;
      if (row.tagName === 'A' && !inboxThreadId(row.getAttribute('href'))) return false;
      if (row.tagName !== 'A' && !row.querySelector?.('img')) return false;
      const parentRow = row.parentElement?.closest?.('[role="button"], a[href]');
      return !parentRow || !root.contains(parentRow);
    });
  }
  function scroller(root) {
    const candidates = [root, ...root.querySelectorAll('*')].filter((node) => {
      if (!visible(node) || auxiliaryCollection(node, root) || node.clientHeight <= 0 || node.scrollHeight <= node.clientHeight + 1) return false;
      const overflow = window.getComputedStyle?.(node)?.overflowY;
      return /^(auto|scroll|overlay)$/.test(overflow || '');
    });
    // Multiple scroll owners cannot be selected safely by size alone.
    if (candidates.length > 1) throw new Error('inbox-scroller-ambiguous');
    if (candidates.length) return candidates[0];
    if (root.scrollHeight > root.clientHeight + 1) throw new Error('inbox-scroller-unavailable');
    return root;
  }
  function fingerprint(row) {
    const text = String(row.textContent || '').replace(/\s+/g, ' ').trim();
    const label = String(row.getAttribute?.('aria-label') || '').trim();
    const images = [...(row.querySelectorAll?.('img[alt]') || [])].map((image) => image.getAttribute('alt') || '');
    if (!text && !label && !images.some(Boolean)) return null;
    const value = JSON.stringify([text, label, images]);
    return value.length <= 8_192 ? value : null;
  }
  async function selectSection(section, context = discoveryContext) {
    guard(context);
    const tabs = [...document.querySelectorAll('[role="tab"]')].filter(visible);
    const matches = tabs.filter((tab) => nativeInboxSection(tab.getAttribute('aria-label') || tab.textContent) === section);
    if (!matches.length && resolveSection?.() === section) return;
    if (matches.length !== 1) throw new Error('section-control-unavailable');
    if (matches[0].getAttribute('aria-selected') !== 'true') {
      matches[0].click();
      await waitFor(() => [...document.querySelectorAll('[role="tab"]')].some((tab) => visible(tab)
        && nativeInboxSection(tab.getAttribute('aria-label') || tab.textContent) === section
        && tab.getAttribute('aria-selected') === 'true'), routeTimeoutMs, context);
    }
    await settle(context);
  }
  async function returnToInbox(threadId, position, section, context = discoveryContext) {
    guard(context);
    if (inboxThreadId(href()) !== threadId) throw new Error('conversation-changed');
    const links = [...document.querySelectorAll('a[href]')].filter((node) => visible(node) && inboxUrl(node.getAttribute('href')));
    if (!links.length) throw new Error('inbox-return-unavailable');
    links[0].click();
    await waitFor(() => inboxUrl(href()) && [...document.querySelectorAll('[aria-label="Thread list"]')].some(visible), routeTimeoutMs, context);
    await selectSection(section, context);
    const scroll = scroller(listRoot()); scroll.scrollTop = position;
    await settle(context);
  }
  async function scan(state) {
    await selectSection(state.section);
    let priorWindow = null;
    for (; state.samples < maxSamples;) {
      guard(); if (!inboxUrl(href())) throw new Error('inbox-route-changed');
      state.samples += 1; state.reason = 'partial';
      const root = listRoot(), scroll = scroller(root), position = scroll.scrollTop || 0;
      const count = rows(root).length, windowIds = [];
      for (let index = 0; index < count; index += 1) {
        guard(); if (!inboxUrl(href())) throw new Error('inbox-route-changed');
        if (visits >= maxVisits) throw new Error('visit-limit');
        const currentRoot = listRoot(), row = rows(currentRoot)[index];
        if (!row || !currentRoot.contains(row)) throw new Error('inbox-window-changed');
        // The position is only used to observe a row. Resulting route IDs,
        // never row positions or preview text, identify conversations.
        const evidence = { row, fingerprint: fingerprint(row), href: row.tagName === 'A' ? row.getAttribute('href') : null,
          section: state.section, position };
        const priorPanes = messagePanes();
        const priorActions = priorPanes.flatMap((pane) => [...pane.querySelectorAll('[aria-label="Message actions"]')]);
        const priorHeaders = [...document.querySelectorAll('[data-pagelet="IGDInboxHeaderOffMsys"]')];
        visits += 1; row.click();
        const threadId = await waitFor(() => {
          const id = inboxThreadId(href());
          if (!id && !inboxUrl(href())) throw new Error('unexpected-route');
          return id;
        });
        if (evidence.href && inboxThreadId(evidence.href) !== threadId) throw new Error('conversation-changed');
        if (!inventory.has(threadId)) {
          if (inventory.size >= maxThreads) throw new Error('thread-limit');
          inventory.set(threadId, new Set());
        }
        inventory.get(threadId).add(state.section);
        const captures = navigationEvidence.get(threadId) || new Map();
        captures.set(state.section, evidence); navigationEvidence.set(threadId, captures);
        try {
          const ready = await freshMessagePane(threadId, priorPanes, priorActions, discoveryContext, Math.min(routeTimeoutMs, 1_500));
          const label = nativeDisplayLabel(ready.pane, priorHeaders);
          if (label) displayLabels.set(threadId, label); else displayLabels.delete(threadId);
        } catch (error) {
          displayLabels.delete(threadId);
          if (error.message !== 'navigation-timeout') throw error;
        }
        windowIds.push(threadId); publish();
        await returnToInbox(threadId, position, state.section);
      }
      guard();
      const nextRoot = listRoot();
      if (proveTerminal) {
        const proof = proveTerminal({ root: nextRoot, accountId, section: state.section, samples: state.samples });
        if (proof?.kind === 'native-terminal-marker' && proof.accountId === accountId && proof.section === state.section && proof.noPendingLoad === true && proof.stable === true) {
          state.complete = true; state.reason = null; return;
        }
      }
      const signature = windowIds.join(',');
      if (signature === priorWindow) { state.reason = 'repeated-window-unverified'; return; }
      priorWindow = signature;
      const next = scroller(nextRoot), end = Math.max(0, next.scrollHeight - next.clientHeight);
      const destination = Math.min(end, (next.scrollTop || 0) + Math.max(1, Math.floor(next.clientHeight * 0.8)));
      if (destination <= (next.scrollTop || 0)) { state.reason = 'end-unverified'; return; }
      next.scrollTop = destination; await settle();
    }
    state.reason = 'sample-limit';
  }
  function createNavigator({ expiresAt: navigationExpiresAt } = {}) {
    if (!finished || !inventory.size) throw new Error('inbox-discovery-required');
    if (!Number.isFinite(navigationExpiresAt) || navigationExpiresAt <= now()
      || navigationExpiresAt > now() + 20 * 60_000) throw new Error('navigation-expired');
    navigator?.stop();
    const context = { expiresAt: navigationExpiresAt, controller: new AbortController(),
      expiryReason: 'navigation-expired', signal: null, stopReason: null };
    guard(context);
    let active = false, verifiedPane = null, paneObserver = null;
    const invalidatePane = () => {
      if (!verifiedPane) return;
      const current = messagePanes().filter(visible);
      if (inboxThreadId(href()) !== verifiedPane.threadId || current.length !== 1
        || current[0] !== verifiedPane.pane) verifiedPane = null;
    };
    const stop = (stopReason = 'cancelled') => {
      context.stopReason = stopReason; context.controller.abort();
      verifiedPane = null; paneObserver?.disconnect();
      clearTimeout(expiryTimer);
      document.removeEventListener?.('freeze', interrupted);
      window.removeEventListener?.('pagehide', interrupted);
      window.removeEventListener?.('popstate', invalidatePane);
      window.removeEventListener?.('hashchange', invalidatePane);
    };
    const interrupted = () => stop('page-interrupted');
    const expiryTimer = setTimeout(() => stop('navigation-expired'), Math.max(0, navigationExpiresAt - now()));
    expiryTimer.unref?.();
    document.addEventListener?.('freeze', interrupted);
    window.addEventListener?.('pagehide', interrupted);
    window.addEventListener?.('popstate', invalidatePane);
    window.addEventListener?.('hashchange', invalidatePane);
    try {
      if (window.MutationObserver) {
        paneObserver = new window.MutationObserver(invalidatePane);
        paneObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      }
    } catch (error) { stop('conversation-pane-observer-unavailable'); throw error; }
    navigator = Object.freeze({
      stop: () => stop(),
      async navigate(threadId, { signal: navigationSignal } = {}) {
        if (active) throw new Error('inbox-navigation-active');
        if (!inventory.has(threadId)) throw new Error('thread-not-discovered');
        active = true; context.signal = navigationSignal;
        try {
          guard(context);
          invalidatePane();
          const currentPane = readyMessagePane();
          const reusablePane = verifiedPane?.threadId === threadId
            && currentPane?.pane === verifiedPane.pane && inboxThreadId(href()) === threadId;
          if (!reusablePane) {
            // A fresh reviewed run cannot inherit an older navigator's pane
            // proof. Re-enter through the native inbox even if its URL is open.
            verifiedPane = null;
            const evidence = [...navigationEvidence.get(threadId).values()][0];
            const current = inboxThreadId(href());
            if (current) await returnToInbox(current, evidence.position, evidence.section, context);
            else if (!inboxUrl(href())) throw new Error('inbox-route-changed');
            else {
              await selectSection(evidence.section, context);
              scroller(listRoot()).scrollTop = evidence.position;
              await settle(context);
            }
            guard(context);
            if (!inboxUrl(href())) throw new Error('inbox-route-changed');
            const currentRows = rows(listRoot());
            const exactLinks = currentRows.filter((row) => row.tagName === 'A'
              && inboxThreadId(row.getAttribute('href')) === threadId);
            if (!exactLinks.length && evidence.fingerprint) {
              const capturedIds = [...navigationEvidence].filter(([, captures]) => [...captures.values()]
                .some((capture) => capture.fingerprint === evidence.fingerprint)).map(([id]) => id);
              if (capturedIds.length !== 1 || capturedIds[0] !== threadId) throw new Error('conversation-row-ambiguous');
            }
            const matches = exactLinks.length ? exactLinks : currentRows.filter((row) => evidence.fingerprint
              && fingerprint(row) === evidence.fingerprint);
            if (matches.length !== 1) throw new Error(matches.length ? 'conversation-row-ambiguous' : 'conversation-row-changed');
            const row = matches[0];
            if (row.tagName === 'A' && inboxThreadId(row.getAttribute('href')) !== threadId) throw new Error('conversation-row-changed');
            // Capture every mounted pane, including hidden cached ones. A URL
            // transition can precede React replacing the previous chat.
            const priorPanes = messagePanes();
            const priorActions = priorPanes.flatMap((pane) => [...pane.querySelectorAll('[aria-label="Message actions"]')]);
            guard(context); row.click();
            try {
              const ready = await freshMessagePane(threadId, priorPanes, priorActions, context);
              verifiedPane = { pane: ready.pane, threadId };
            } catch (error) {
              if (error.message === 'navigation-timeout' && inboxThreadId(href()) === threadId) {
                throw new Error('conversation-pane-unverified');
              }
              throw error;
            }
          }
          guard(context);
          if (inboxThreadId(href()) !== threadId) throw new Error('conversation-changed');
          invalidatePane();
          const ready = readyMessagePane();
          if (!verifiedPane || verifiedPane.threadId !== threadId || ready?.pane !== verifiedPane.pane) {
            throw new Error('conversation-pane-unverified');
          }
          return Object.freeze({ accountId, threadId, verified: true });
        } catch (error) {
          stop(error.message);
          throw error;
        } finally { active = false; context.signal = null; }
      },
    });
    return navigator;
  }
  return Object.freeze({
    snapshot, createNavigator,
    reviewLabels() {
      try {
        const identity = resolveAccount();
        if (controller.signal.aborted || new URL(href()).origin !== ORIGIN || identity?.then
          || identity?.verified !== true || identity.accountId !== accountId) displayLabels.clear();
      } catch { displayLabels.clear(); }
      return [...displayLabels].map(([threadId, label]) => ({ threadId, ...label }));
    },
    stop() { stopped = true; reason = 'cancelled'; displayLabels.clear(); controller.abort(); navigator?.stop(); return snapshot(); },
    async run() {
      if (started) throw new Error('discovery-already-started');
      started = true;
      if (navigationAcknowledged !== true) throw new Error('navigation-acknowledgment-required');
      try {
        guard(); if (!inboxUrl(href())) throw new Error('inbox-route-required');
        for (const state of sectionState) {
          try { await scan(state); }
          catch (error) { state.reason = error.message; throw error; }
          publish();
        }
      } catch (error) { stopped = true; reason = error.message; }
      finished = true;
      publish(); return snapshot();
    },
  });
}

return Object.freeze({ nativeInboxSection, createNativeInboxDiscovery });
})();
localModules["extension/inbox-coordinator.js"] = (() => {

// Browser-neutral job state. Runtime adapters must supply trusted identity and
// exact-target checks; this module does not open tabs or click Instagram controls.
const MAX_THREADS = 1_000;
const MAX_REVIEW_AGE_MS = 20 * 60 * 1_000;
const INBOX_COORDINATOR_CAPABILITIES = Object.freeze({
  maxPreparedWorkers: 5,
  defaultConcurrentMutations: 1,
  maxConcurrentMutations: 5,
  assignmentModes: Object.freeze(['contiguous', 'batches']),
});
const TERMINAL = new Set(['completed', 'partial', 'skipped', 'failed', 'uncertain']);
const clone = (value) => structuredClone(value);
const fail = (reason) => { throw new Error(reason); };
const identity = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const record = (value) => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function createInboxReview(input, now = Date.now()) {
  if (!record(input) || !Number.isFinite(now) || (input.discovery && !record(input.discovery))) fail('review-invalid');
  if (input.version !== undefined && ![1, 2].includes(input.version)) fail('review-version-invalid');
  const duringRun = input.messageWindow === 'during-run';
  if (input.messageWindow !== undefined && !duringRun) fail('message-window-invalid');
  if ((duringRun && input.version === 1) || (input.version === 2 && !duringRun)) fail('message-window-invalid');
  const arrivalPolicy = duringRun ? 'include-sent-while-running' : 'skip-after-review-or-pause';
  if (input.arrivalPolicy !== undefined && input.arrivalPolicy !== arrivalPolicy) fail('message-window-invalid');
  if (!identity(input?.accountId)) fail('account-identity-required');
  if (!Array.isArray(input.threadIds) || !input.threadIds.length
    || input.threadIds.length > MAX_THREADS || !input.threadIds.every(identity)) fail('thread-inventory-invalid');
  const threadIds = [...new Set(input.threadIds)];
  const scope = input.scope || 'all';
  if (!['all', 'newest', 'oldest'].includes(scope)) fail('message-scope-invalid');
  const limit = scope === 'all' ? null : input.limit;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5_000)) fail('message-limit-invalid');
  const speed = input.speed || 'standard';
  if (speed !== 'standard') fail('speed-invalid');
  const workerCount = input.workerCount ?? 1;
  if (!Number.isInteger(workerCount) || workerCount < 1
    || workerCount > INBOX_COORDINATOR_CAPABILITIES.maxPreparedWorkers) fail('worker-count-invalid');
  const assignmentMode = input.assignmentMode ?? 'contiguous';
  if (!INBOX_COORDINATOR_CAPABILITIES.assignmentModes.includes(assignmentMode)) fail('assignment-mode-invalid');
  const mutationConcurrency = input.mutationConcurrency ?? 1;
  if (!Number.isInteger(mutationConcurrency) || mutationConcurrency < 1) fail('mutation-concurrency-invalid');
  if (mutationConcurrency > INBOX_COORDINATOR_CAPABILITIES.maxConcurrentMutations
    || mutationConcurrency > workerCount) fail('mutation-concurrency-invalid');
  // Preserve canonical keys for existing reviews. New scheduling choices are
  // explicit review content, never an interpretation added to an older approval.
  const scheduling = {};
  if (input.assignmentMode !== undefined) scheduling.assignmentMode = assignmentMode;
  if (input.mutationConcurrency !== undefined) scheduling.mutationConcurrency = mutationConcurrency;
  const expiresAt = input.expiresAt ?? now + MAX_REVIEW_AGE_MS;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_REVIEW_AGE_MS) fail('review-expired');
  const sections = [...new Set(input.discovery?.sections || [])];
  if (!sections.every((entry) => ['primary', 'general', 'requests'].includes(entry))) fail('inbox-section-invalid');
  return Object.freeze({
    version: duringRun ? 2 : 1, accountId: input.accountId, threadIds: Object.freeze(threadIds),
    scope, limit, speed, workerCount, removeOwnReactions: input.removeOwnReactions === true,
    ...scheduling,
    reviewedAt: now, expiresAt,
    arrivalPolicy,
    ...(duringRun ? { messageWindow: 'during-run' } : {}),
    discovery: Object.freeze({ sections: Object.freeze(sections), complete: input.discovery?.complete === true }),
  });
}

function inboxReviewKey(review) {
  // Exact canonical content, not an authentication token or a lossy digest.
  return JSON.stringify(review);
}

function createInboxCoordinator({ review, save, now = Date.now, restored = null, stageTimeoutMs = 30_000, saveTimeoutMs = 10_000, concurrencyCapability = null }) {
  if (typeof save !== 'function') fail('durable-storage-required');
  if (!Number.isFinite(stageTimeoutMs) || stageTimeoutMs < 1 || stageTimeoutMs > 120_000) fail('stage-timeout-invalid');
  if (!Number.isFinite(saveTimeoutMs) || saveTimeoutMs < 1 || saveTimeoutMs > 120_000) fail('save-timeout-invalid');
  const frozen = createInboxReview(review, review.reviewedAt ?? now());
  const key = inboxReviewKey(frozen);
  const concurrency = frozen.mutationConcurrency ?? 1;
  // Only the trusted runtime may supply this admission policy. Never read it
  // from page messages, a checkpoint, or reviewed client settings.
  if (concurrencyCapability !== null && !record(concurrencyCapability)) fail('concurrent-mutations-unavailable');
  const capability = concurrencyCapability ? clone(concurrencyCapability) : null;
  if (concurrency > 1 && (!record(capability) || capability.version !== 1
    || capability.accountId !== frozen.accountId
    || !Number.isInteger(capability.maxConcurrentMutations) || capability.maxConcurrentMutations < concurrency
    || capability.maxConcurrentMutations > INBOX_COORDINATOR_CAPABILITIES.maxConcurrentMutations
    || !Number.isFinite(capability.expiresAt) || capability.expiresAt <= now())) fail('concurrent-mutations-unavailable');
  let state = {
    version: 1, review: clone(frozen), status: 'review', reason: null,
    tasks: frozen.threadIds.map((threadId, index) => ({
      threadId, workerIndex: frozen.assignmentMode === 'batches' ? index % frozen.workerCount
        : Math.min(frozen.workerCount - 1, Math.floor(index / Math.ceil(frozen.threadIds.length / frozen.workerCount))),
      ...(frozen.assignmentMode === 'batches' ? { batchIndex: Math.floor(index / frozen.workerCount) } : {}),
      status: 'pending', messageRemovals: 0, reactionRemovals: 0, reason: null,
    })),
    pendingMutation: null, nextActionAt: 0,
    ...(concurrency > 1 ? { pendingMutations: [] } : {}),
  };
  if (restored) {
    if (!record(restored) || restored.version !== 1 || inboxReviewKey(restored.review) !== key
      || !Array.isArray(restored.tasks) || restored.tasks.length !== frozen.threadIds.length
      || restored.tasks.some((task, index) => !record(task) || task.threadId !== frozen.threadIds[index]
        || task.workerIndex !== state.tasks[index].workerIndex
        || task.batchIndex !== state.tasks[index].batchIndex
        || !['pending', 'running', ...TERMINAL].includes(task.status)
        || !Number.isSafeInteger(task.messageRemovals) || task.messageRemovals < 0
        || !Number.isSafeInteger(task.reactionRemovals) || task.reactionRemovals < 0)) fail('checkpoint-invalid');
    state.tasks = clone(restored.tasks);
    state.nextActionAt = Number.isFinite(restored.nextActionAt) ? restored.nextActionAt : 0;
    for (const task of state.tasks) {
      if (task.status === 'running') { task.status = 'partial'; task.reason = 'worker-restart'; }
    }
    if (restored.pendingMutation) {
      if (!record(restored.pendingMutation)
        || !['message', 'reaction'].includes(restored.pendingMutation.kind)
        || !['prepared', 'dispatched', 'uncertain'].includes(restored.pendingMutation.phase)) fail('checkpoint-invalid');
      const task = state.tasks.find((item) => item.threadId === restored.pendingMutation.threadId);
      if (!task) fail('checkpoint-invalid');
      task.status = 'uncertain'; task.reason = 'interrupted-mutation';
      state.pendingMutation = { threadId: task.threadId, kind: restored.pendingMutation.kind, phase: 'uncertain' };
    }
    if (restored.pendingMutations !== undefined) {
      if (concurrency === 1 || !Array.isArray(restored.pendingMutations)
        || restored.pendingMutations.length > concurrency || restored.pendingMutation) fail('checkpoint-invalid');
      const seen = new Set();
      state.pendingMutations = restored.pendingMutations.map((pending) => {
        if (!record(pending) || !['message', 'reaction'].includes(pending.kind)
          || !['prepared', 'dispatched', 'uncertain'].includes(pending.phase)
          || seen.has(pending.threadId)) fail('checkpoint-invalid');
        const task = state.tasks.find((item) => item.threadId === pending.threadId);
        if (!task) fail('checkpoint-invalid');
        seen.add(task.threadId); task.status = 'uncertain'; task.reason = 'interrupted-mutation';
        return { threadId: task.threadId, kind: pending.kind, phase: 'uncertain' };
      });
    }
    state.status = 'paused'; state.reason = 'review-required-after-restart';
  }
  let tail = Promise.resolve();
  let authorized = false;
  let generation = 0;
  let abort = new AbortController();
  let storageTimeout = null;
  const leases = new Map();
  const attempts = new Set();
  const inFlight = new Map();
  const pendingFor = (threadId) => state.pendingMutation?.threadId === threadId
    || state.pendingMutations?.some((item) => item.threadId === threadId);
  const hasPending = () => !!state.pendingMutation || !!state.pendingMutations?.length;
  const snapshot = () => clone(state);
  function currentBatch() {
    if (frozen.assignmentMode !== 'batches') return null;
    const unfinished = state.tasks.find((task) => !TERMINAL.has(task.status)
      || leases.has(task.threadId) || pendingFor(task.threadId));
    return unfinished?.batchIndex ?? null;
  }
  const serial = (fn) => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  function revoke(reason, status = 'paused') {
    authorized = false; generation += 1; abort.abort(reason);
    state.status = status; state.reason = reason;
    // Retain leases: a missing heartbeat cannot prove an old worker stopped.
  }
  async function persist() {
    // A timed-out adapter may still write later. Never start a newer write in
    // this instance after that point, even if the old promise eventually settles.
    if (storageTimeout) throw storageTimeout;
    try {
      const checkpoint = snapshot();
      await new Promise((resolve, reject) => {
        let settled = false;
        const deadline = now() + saveTimeoutMs;
        const finish = (error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        const expired = () => {
          storageTimeout = new Error('storage-timeout');
          finish(storageTimeout);
        };
        const timer = setTimeout(expired, saveTimeoutMs);
        Promise.resolve().then(() => save(checkpoint)).then(() => {
          if (settled) return;
          if (now() >= deadline) expired(); else finish();
        }, (error) => finish(error instanceof Error ? error : new Error('storage-failed')));
      });
    } catch (error) {
      revoke(storageTimeout ? 'storage-timeout' : 'storage-failed', state.status === 'stopped' ? 'stopped' : 'paused');
      throw error;
    }
  }
  function active(accountId) {
    if (storageTimeout) fail('storage-timeout');
    if (accountId !== frozen.accountId) { revoke('account-changed'); fail('account-changed'); }
    if (now() >= frozen.expiresAt) { revoke('approval-expired'); fail('approval-expired'); }
    if (concurrency > 1 && now() >= capability.expiresAt) { revoke('concurrency-capability-expired'); fail('concurrency-capability-expired'); }
    if (!authorized || state.status !== 'running') fail(state.reason || 'approval-required');
  }
  function taskFor(lease) {
    if (!lease || leases.get(lease.threadId) !== lease || lease.generation !== generation) fail('stale-worker');
    return state.tasks.find((task) => task.threadId === lease.threadId);
  }
  function boundedStage(callback, signal, cancelOnAbort, startImmediately = false) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        if (error) reject(error); else resolve(value);
      };
      const cancelled = () => finish(new Error('inspection-cancelled'));
      const timer = setTimeout(() => finish(new Error('worker-response-timeout')), stageTimeoutMs);
      if (cancelOnAbort) {
        signal.addEventListener('abort', cancelled, { once: true });
        if (signal.aborted) { cancelled(); return; }
      }
      if (startImmediately) {
        try { Promise.resolve(callback()).then((value) => finish(null, value), (error) => finish(error)); }
        catch (error) { finish(error); }
      } else Promise.resolve().then(callback).then((value) => finish(null, value), (error) => finish(error));
    });
  }
  async function concurrentMutation(lease, { accountId, actionId, kind, inspect, execute, delayMs }) {
    const operation = await serial(async () => {
      active(accountId);
      const task = taskFor(lease);
      if (!identity(actionId) || !['message', 'reaction'].includes(kind)) fail('mutation-invalid');
      if (kind === 'reaction' && !frozen.removeOwnReactions) fail('reaction-not-approved');
      if (kind === 'message' && frozen.limit !== null && task.messageRemovals >= frozen.limit) fail('message-limit-reached');
      if (!Number.isFinite(delayMs) || delayMs < 0 || typeof inspect !== 'function' || typeof execute !== 'function') fail('mutation-adapter-invalid');
      if (state.pendingMutation || state.pendingMutations.some((item) => item.phase === 'uncertain')) fail('reconciliation-required');
      if (inFlight.has(lease.threadId)) fail('thread-mutation-in-flight');
      if (inFlight.size >= concurrency) fail('mutation-capacity');
      if (now() < state.nextActionAt) fail('account-pacing');
      const actionKey = `${lease.threadId}:${kind}:${actionId}`;
      if (attempts.has(actionKey)) fail('duplicate-action');
      const item = { task, actionKey, signal: abort.signal, dispatched: false, marker: null };
      inFlight.set(lease.threadId, item);
      return item;
    });
    try {
      let evidence;
      try {
        evidence = await boundedStage(() => inspect({ threadId: lease.threadId, signal: operation.signal, reviewedAt: frozen.reviewedAt }), operation.signal, true);
      } catch (error) {
        if (state.status === 'running') revoke(error.message === 'worker-response-timeout' ? 'worker-response-timeout' : 'inspection-failed');
        throw error;
      }
      let execution;
      await serial(async () => {
        active(accountId); taskFor(lease);
        if (['challenge', 'action-block', 'rate-limit', 'session-expired'].includes(evidence?.restriction)) {
          revoke(evidence.restriction); fail(evidence.restriction);
        }
        if (evidence?.accountId !== frozen.accountId || evidence?.threadId !== lease.threadId
          || evidence?.ownershipVerified !== true || evidence?.withinReviewedBoundary !== true
          || evidence?.exactTarget !== true) fail('target-not-proven');
        if (now() < state.nextActionAt) fail('account-pacing');
        operation.marker = { threadId: lease.threadId, kind, phase: 'prepared' };
        state.pendingMutations.push(operation.marker);
        await persist();
        active(accountId); taskFor(lease);
        attempts.add(operation.actionKey);
        operation.marker.phase = 'dispatched';
        await persist();
        active(accountId); taskFor(lease);
        if (now() < state.nextActionAt) fail('account-pacing');
        // Anchor spacing to actual adapter invocation, after every awaited save.
        // Start synchronously inside this serial admission, but never hold the
        // state queue while its execution/verification promise is outstanding.
        execution = boundedStage(() => {
          active(accountId); taskFor(lease);
          state.nextActionAt = now() + delayMs;
          operation.dispatched = true;
          return execute({ threadId: lease.threadId, signal: operation.signal, evidence });
        }, operation.signal, false, true);
      });
      let result;
      try {
        result = await execution;
      } catch (error) {
        if (!operation.dispatched) throw error;
        result = { verified: false };
      }
      return await serial(async () => {
        // Settlement is allowed after revocation. Each exact dispatched action
        // owns its own marker and may report a verified outcome only once.
        if (result?.verified === true) {
          operation.task[kind === 'message' ? 'messageRemovals' : 'reactionRemovals'] += 1;
          state.pendingMutations = state.pendingMutations.filter((item) => item !== operation.marker);
        } else {
          operation.task.status = 'uncertain'; operation.task.reason = 'removal-not-proven';
          operation.marker.phase = 'uncertain';
          revoke('removal-not-proven', state.status === 'stopped' ? 'stopped' : 'paused');
        }
        if (['challenge', 'action-block', 'rate-limit', 'session-expired'].includes(result?.restriction)) {
          revoke(result.restriction, state.status === 'stopped' ? 'stopped' : 'paused');
        }
        await persist();
        return { verified: result?.verified === true, state: snapshot() };
      });
    } finally {
      await serial(async () => {
        inFlight.delete(lease.threadId);
        if (!operation.dispatched && operation.marker && !storageTimeout && state.reason !== 'storage-failed') {
          state.pendingMutations = state.pendingMutations.filter((item) => item !== operation.marker);
          await persist();
        }
      });
    }
  }
  return Object.freeze({
    snapshot,
    batchProgress: () => ({
      mode: frozen.assignmentMode || 'contiguous',
      currentBatchIndex: currentBatch(),
      totalBatches: frozen.assignmentMode === 'batches' ? Math.ceil(frozen.threadIds.length / frozen.workerCount) : null,
      preparedWorkerLimit: frozen.workerCount,
      mutationConcurrency: concurrency,
    }),
    approve: (reviewKey, accountId) => serial(async () => {
      if (storageTimeout) fail('storage-timeout');
      if (reviewKey !== key || accountId !== frozen.accountId) fail('review-changed');
      if (hasPending() || leases.size || inFlight.size) fail('reconciliation-required');
      if (state.status === 'stopped' || state.status === 'completed') fail('job-finished');
      if (now() >= frozen.expiresAt) fail('approval-expired');
      if (concurrency > 1 && now() >= capability.expiresAt) fail('concurrency-capability-expired');
      authorized = true; abort = new AbortController(); state.status = 'running'; state.reason = null;
      await persist(); return snapshot();
    }),
    claim: (workerIndex, accountId) => serial(async () => {
      active(accountId);
      if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= frozen.workerCount) fail('worker-invalid');
      if ([...leases.values()].some((lease) => lease.workerIndex === workerIndex)) fail('worker-already-assigned');
      const batch = currentBatch();
      const task = state.tasks.find((item) => item.workerIndex === workerIndex && item.status === 'pending'
        && (frozen.assignmentMode !== 'batches' || item.batchIndex === batch));
      if (!task) return null;
      const lease = Object.freeze({ threadId: task.threadId, workerIndex, generation });
      leases.set(task.threadId, lease); task.status = 'running'; await persist(); return lease;
    }),
    mutate: (lease, options) => concurrency > 1 ? concurrentMutation(lease, options) : serial(async () => {
      const { accountId, actionId, kind, inspect, execute, delayMs } = options;
      active(accountId);
      const task = taskFor(lease);
      if (!identity(actionId) || !['message', 'reaction'].includes(kind)) fail('mutation-invalid');
      if (kind === 'reaction' && !frozen.removeOwnReactions) fail('reaction-not-approved');
      if (kind === 'message' && frozen.limit !== null && task.messageRemovals >= frozen.limit) fail('message-limit-reached');
      if (!Number.isFinite(delayMs) || delayMs < 0 || typeof inspect !== 'function' || typeof execute !== 'function') fail('mutation-adapter-invalid');
      if (state.pendingMutation) fail('reconciliation-required');
      if (now() < state.nextActionAt) fail('account-pacing');
      const actionKey = `${lease.threadId}:${kind}:${actionId}`;
      if (attempts.has(actionKey)) fail('duplicate-action');
      const signal = abort.signal;
      let evidence;
      try {
        evidence = await boundedStage(() => inspect({ threadId: lease.threadId, signal, reviewedAt: frozen.reviewedAt }), signal, true);
      } catch (error) {
        if (state.status === 'running') revoke(error.message === 'worker-response-timeout' ? 'worker-response-timeout' : 'inspection-failed');
        throw error;
      }
      active(accountId); taskFor(lease);
      if (evidence?.accountId !== frozen.accountId || evidence?.threadId !== lease.threadId
        || evidence?.ownershipVerified !== true || evidence?.withinReviewedBoundary !== true
        || evidence?.exactTarget !== true) fail('target-not-proven');
      state.pendingMutation = { threadId: lease.threadId, kind, phase: 'prepared' };
      await persist();
      active(accountId); taskFor(lease);
      attempts.add(actionKey);
      state.pendingMutation.phase = 'dispatched';
      // Persist the dispatch marker before the adapter can affect Instagram.
      await persist();
      active(accountId); taskFor(lease);
      let result;
      try { result = await boundedStage(() => execute({ threadId: lease.threadId, signal, evidence }), signal, false); }
      catch { result = { verified: false }; }
      if (result?.verified === true) {
        task[kind === 'message' ? 'messageRemovals' : 'reactionRemovals'] += 1;
        state.pendingMutation = null;
        state.nextActionAt = now() + delayMs;
      } else {
        task.status = 'uncertain'; task.reason = 'removal-not-proven';
        state.pendingMutation.phase = 'uncertain';
        revoke('removal-not-proven', state.status === 'stopped' ? 'stopped' : 'paused');
      }
      await persist();
      return { verified: result?.verified === true, state: snapshot() };
    }),
    finish: (lease, status, reason = null) => serial(async () => {
      const task = taskFor(lease);
      if (!TERMINAL.has(status) || status === 'uncertain' || state.pendingMutation
        || pendingFor(lease.threadId) || inFlight.has(lease.threadId)) fail('completion-invalid');
      task.status = status; task.reason = reason; leases.delete(task.threadId);
      if (state.tasks.every((item) => TERMINAL.has(item.status))) {
        authorized = false;
        state.status = state.tasks.every((item) => item.status === 'completed') ? 'completed' : 'partial';
      }
      await persist(); return snapshot();
    }),
    settleInterrupted: (lease) => serial(async () => {
      if (!['paused', 'stopped'].includes(state.status) || authorized
        || !lease || leases.get(lease.threadId) !== lease) fail('interrupted-settlement-invalid');
      if (state.pendingMutation || pendingFor(lease.threadId) || inFlight.has(lease.threadId)) fail('reconciliation-required');
      const task = state.tasks.find(item => item.threadId === lease.threadId);
      if (!task || task.status !== 'running') fail('interrupted-settlement-invalid');
      task.status = 'partial'; task.reason = state.reason || 'interrupted';
      leases.delete(lease.threadId);
      await persist(); return snapshot();
    }),
    interrupt: (reason = 'paused', { stop = false } = {}) => {
      revoke(reason, stop ? 'stopped' : 'paused');
      return serial(async () => { await persist(); return snapshot(); });
    },
    retireWorker: (threadId, { terminated, reconciled = false } = {}) => serial(async () => {
      if (terminated !== true) fail('worker-termination-required');
      if (inFlight.has(threadId)) fail('worker-settlement-required');
      if (pendingFor(threadId) && reconciled !== true) fail('reconciliation-required');
      const task = state.tasks.find((item) => item.threadId === threadId);
      if (!task) fail('thread-not-reviewed');
      leases.delete(threadId);
      if (state.pendingMutation?.threadId === threadId) state.pendingMutation = null;
      if (state.pendingMutations) state.pendingMutations = state.pendingMutations.filter((item) => item.threadId !== threadId);
      if (['running', 'partial', 'uncertain'].includes(task.status)) {
        task.status = 'skipped'; task.reason = 'worker-retired';
      }
      await persist(); return snapshot();
    }),
  });
}

return Object.freeze({ INBOX_COORDINATOR_CAPABILITIES, createInboxReview, inboxReviewKey, createInboxCoordinator });
})();
localModules["extension/inbox-userscript-discovery.js"] = (() => {
const { createNativeInboxDiscovery, nativeInboxSection } = localModules["extension/inbox-native-navigation.js"];
const { createInboxReview } = localModules["extension/inbox-coordinator.js"];


const ORIGIN = 'https://www.instagram.com';
const visible = (node) => Boolean(node?.isConnected && !node.closest?.('[hidden], [aria-hidden="true"]')
  && node.getClientRects?.().length);
const copy = (value) => structuredClone(value);

// Inventory, review, and captured native navigation never approve cleanup.
function createUserscriptInboxDiscovery({
  document = globalThis.document, window = globalThis.window,
  viewer = globalThis.InstaToolboxInstagramViewer, now = Date.now, onProgress = null,
  routeTimeoutMs = 8_000, settleMs = 400,
} = {}) {
  if (!document || !window?.location || typeof viewer?.inspect !== 'function'
    || typeof viewer.accountKey !== 'function' || typeof now !== 'function'
    || (onProgress !== null && typeof onProgress !== 'function')) throw new Error('inbox-discovery-unavailable');
  let active = null, inventory = null, captured = null, navigator = null;
  let state = { status: 'idle', reason: null, inventory: null, executionAvailable: false };
  const snapshot = () => copy(state);
  const publish = (patch) => {
    state = { ...state, ...patch };
    try { onProgress?.(snapshot()); } catch {}
    return snapshot();
  };
  function rejectContext(reason) {
    navigator?.stop(); navigator = null; captured = null; inventory = null;
    publish({ status: 'needs-attention', reason, inventory: null });
    throw new Error(reason);
  }
  function context() {
    const evidence = viewer.inspect({ document, location: window.location });
    const key = viewer.accountKey(evidence?.accountId);
    if (evidence?.then || evidence?.accountVerified !== true || !key
      || evidence.accountKey !== key || evidence.identityKind !== 'verified-viewer-username'
      || window.location.origin !== ORIGIN) return rejectContext('inbox-viewer-unverified');
    if (evidence.restriction) return rejectContext('inbox-account-restricted');
    return { accountId: key, verified: true, restriction: null };
  }
  function section() {
    const roots = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
    if (roots.length !== 1) return null;
    const selected = [...roots[0].querySelectorAll('[role="tab"][aria-selected="true"]')].filter(visible);
    if (selected.length !== 1) return null;
    const label = (selected[0].getAttribute('aria-label') || selected[0].textContent || '').trim();
    return nativeInboxSection(label);
  }
  const stop = () => {
    if (navigator) { navigator.stop(); navigator = null; return true; }
    if (!active) return false;
    active.stop(); publish({ status: 'stopping', reason: 'cancelled', inventory: active.snapshot() });
    return true;
  };
  return Object.freeze({
    snapshot, stop,
    availableSections() {
      const roots = [...document.querySelectorAll('[aria-label="Thread list"]')].filter(visible);
      if (roots.length !== 1) return [];
      return [...new Set([...roots[0].querySelectorAll('[role="tab"]')]
        .filter(visible)
        .map((tab) => nativeInboxSection(tab.getAttribute('aria-label') || tab.textContent))
        .filter(Boolean))];
    },
    reviewLabels() {
      const current = context();
      if (state.inventory && current.accountId !== state.inventory.accountId) return rejectContext('inbox-account-changed');
      return (active || captured)?.reviewLabels() || [];
    },
    async discover({ navigationAcknowledged = false, sections = ['primary'], expiresAt = now() + 5 * 60_000 } = {}) {
      if (active) throw new Error('inbox-discovery-active');
      if (navigationAcknowledged !== true) throw new Error('navigation-acknowledgment-required');
      if (!Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt > now() + 20 * 60_000) throw new Error('discovery-expired');
      if (!/^\/direct\/inbox\/?$/.test(window.location.pathname)) throw new Error('inbox-route-required');
      const identity = context();
      navigator?.stop(); navigator = null; captured = null; inventory = null;
      const operation = createNativeInboxDiscovery({
        accountId: identity.accountId, resolveAccount: context,
        navigationAcknowledged, document, window, sections, expiresAt, now,
        routeTimeoutMs, settleMs, resolveSection: section,
        onProgress: (value) => publish({ inventory: value }),
      });
      active = operation;
      const interrupted = () => { operation.stop(); publish({ status: 'stopping', reason: 'page-interrupted' }); };
      document.addEventListener?.('freeze', interrupted);
      window.addEventListener?.('pagehide', interrupted);
      publish({ status: 'discovering', reason: null, inventory: operation.snapshot() });
      try {
        const result = await operation.run();
        const current = context();
        if (current.accountId !== identity.accountId) throw new Error('inbox-account-changed');
        inventory = copy(result);
        captured = operation;
        return publish({ status: result.stopped ? 'needs-attention' : 'ready',
          reason: result.reason, inventory: result });
      } catch (error) {
        captured = null; inventory = null;
        publish({ status: 'needs-attention', reason: error.message, inventory: null });
        throw error;
      } finally {
        document.removeEventListener?.('freeze', interrupted);
        window.removeEventListener?.('pagehide', interrupted);
        if (active === operation) active = null;
      }
    },
    createNavigator({ expiresAt } = {}) {
      if (active) throw new Error('inbox-discovery-active');
      if (!inventory || !captured) throw new Error('inbox-discovery-required');
      const current = context();
      if (current.accountId !== inventory.accountId) {
        navigator?.stop(); navigator = null; captured = null; inventory = null;
        publish({ status: 'needs-attention', reason: 'inbox-account-changed', inventory: null });
        throw new Error('inbox-account-changed');
      }
      const native = captured.createNavigator({ expiresAt });
      navigator?.stop();
      navigator = Object.freeze({
        stop: () => native.stop(),
        async navigate(threadId, options) {
          try { return await native.navigate(threadId, options); }
          catch (error) {
            if (/account-changed|viewer-unverified|origin-changed/.test(error.message)) {
              captured = null; inventory = null;
            }
            publish({ status: 'needs-attention', reason: error.message, inventory });
            throw error;
          }
        },
      });
      return navigator;
    },
    review({ threadIds, scope = 'all', limit = null } = {}) {
      if (active) throw new Error('inbox-discovery-active');
      if (!inventory) throw new Error('inbox-discovery-required');
      const current = context();
      if (current.accountId !== inventory.accountId) {
        return rejectContext('inbox-account-changed');
      }
      const available = new Set(inventory.conversations.map((entry) => entry.threadId));
      if (!Array.isArray(threadIds) || !threadIds.length
        || !threadIds.every((id) => available.has(id))) throw new Error('thread-not-discovered');
      return createInboxReview({ accountId: current.accountId, threadIds, scope, limit,
        speed: 'standard', workerCount: 1, removeOwnReactions: false,
        discovery: { sections: inventory.sections.filter((entry) => entry.samples > 0).map((entry) => entry.section),
          complete: inventory.complete === true },
      }, now());
    },
  });
}

return Object.freeze({ createUserscriptInboxDiscovery });
})();
localModules["extension/inbox-single-tab.js"] = (() => {
const { createInboxCoordinator, createInboxReview, inboxReviewKey } = localModules["extension/inbox-coordinator.js"];

const fail = (reason) => { throw new Error(reason); };
const restricted = (context) => context?.restriction || context?.challenge || context?.rateLimited
  || context?.actionBlocked || context?.sessionExpired;

// This adapter has no page-message entry point. Its runner, navigation and
// identity readers must all belong to the same isolated runtime.
function createSingleTabInboxReview(input, now = Date.now()) {
  if (input?.messageWindow !== 'during-run') fail('message-window-review-required');
  if (input.workerCount !== undefined && input.workerCount !== 1) fail('single-tab-worker-required');
  if (input.mutationConcurrency !== undefined && input.mutationConcurrency !== 1) fail('serial-mutations-required');
  if (input.removeOwnReactions === true) fail('inbox-reactions-unavailable');
  const review = createInboxReview({ ...input, workerCount: 1, mutationConcurrency: 1,
    messageWindow: 'during-run', removeOwnReactions: false }, now);
  if (review.messageWindow !== 'during-run') fail('message-window-contract-unavailable');
  return review;
}

function createSingleTabInboxController({
  review, runner, navigate, inspectCurrent, locks, save, now = Date.now,
  restored = null, stageTimeoutMs = 30_000, saveTimeoutMs = 10_000,
} = {}) {
  if (typeof runner?.start !== 'function' || typeof runner?.createPlan !== 'function'
    || typeof navigate !== 'function' || typeof inspectCurrent !== 'function'
    || typeof locks?.request !== 'function' || typeof save !== 'function'
    || typeof now !== 'function') fail('single-tab-runtime-unavailable');
  const frozen = createSingleTabInboxReview(review, review?.reviewedAt ?? now());
  const reviewKey = inboxReviewKey(frozen);
  if (inboxReviewKey(review) !== reviewKey) fail('single-tab-review-invalid');
  const coordinator = createInboxCoordinator({ review: frozen, save, now, restored, stageTimeoutMs, saveTimeoutMs });
  const listeners = new Set();
  const abort = new AbortController();
  const lockName = `insta-toolbox:account-activity:${frozen.accountId}`;
  let authority = null, used = false, running = null, active = null, lockHeld = false;
  let phase = restored ? 'review-required' : 'review', documentId = null, actionSequence = 0;
  const pendingNative = new Set();
  const snapshot = () => {
    const state = coordinator.snapshot();
    return { ...state, phase,
      currentThreadId: active?.lease.threadId || null, lockHeld,
      canStart: !restored && !used && !abort.signal.aborted,
      canStop: Boolean(running && phase !== 'finished' && !abort.signal.aborted),
      canSkip: Boolean(active && !active.abort.signal.aborted && !abort.signal.aborted),
    };
  };
  function publish(nextPhase = phase) {
    phase = nextPhase;
    for (const listener of listeners) { try { listener(snapshot()); } catch {} }
  }
  function context(threadId = null, requireAuthority = true) {
    if (abort.signal.aborted) fail('inbox-run-stopped');
    if (now() >= frozen.expiresAt) fail('approval-expired');
    if (requireAuthority && (!authority || !lockHeld || coordinator.snapshot().status !== 'running')) fail('inbox-approval-revoked');
    const value = inspectCurrent();
    if (!value || value.then || value.accountVerified !== true || value.accountId !== frozen.accountId
      || value.usable !== true || typeof value.documentId !== 'string' || !value.documentId
      || (documentId && documentId !== value.documentId)) fail('inbox-context-changed');
    if (restricted(value)) fail('inbox-account-restricted');
    if (threadId !== null && value.threadId !== threadId) fail('inbox-thread-changed');
    return value;
  }
  async function pacing(signal) {
    while (coordinator.snapshot().nextActionAt > now()) {
      context(active.lease.threadId);
      if (signal.aborted || active.abort.signal.aborted) fail('inbox-thread-stopped');
      await new Promise((resolve, reject) => {
        let timer, settled = false;
        const finish = (error) => {
          if (settled) return; settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', cancelled);
          active?.abort.signal.removeEventListener('abort', cancelled);
          error ? reject(error) : resolve();
        };
        const cancelled = () => finish(new Error('inbox-thread-stopped'));
        signal.addEventListener('abort', cancelled, { once: true });
        active.abort.signal.addEventListener('abort', cancelled, { once: true });
        timer = setTimeout(() => finish(), Math.min(250, coordinator.snapshot().nextActionAt - now()));
        if (signal.aborted || active.abort.signal.aborted) cancelled();
      });
    }
  }
  function adapterFor(item, token) {
    let grant = null, inFlight = false;
    const attemptedKeys = new Set();
    const guard = () => {
      if (token !== authority || active !== item || item.abort.signal.aborted) fail('inbox-thread-stopped');
      context(item.lease.threadId);
      return true;
    };
    const validCandidate = (candidate) => candidate?.ownershipVerified === true
      && (candidate.key === null || (typeof candidate.key === 'string' && candidate.key.length > 0 && candidate.key.length <= 512))
      && (candidate.timestamp === null || (Number.isFinite(candidate.timestamp) && candidate.timestamp > 0));
    const assertAction = ({ threadId, candidate }) => {
      guard();
      if (!grant || grant.signal.aborted || threadId !== item.lease.threadId || !validCandidate(candidate)
        || candidate.key !== grant.candidate.key || candidate.timestamp !== grant.candidate.timestamp) fail('inbox-target-changed');
      return true;
    };
    return Object.freeze({
      signal: item.abort.signal,
      assertContext({ threadId }) { guard(); if (threadId !== item.lease.threadId) fail('inbox-thread-changed'); return true; },
      assertAction,
      async execute({ candidate, threadId, signal, execute }) {
        guard();
        if (threadId !== item.lease.threadId || !validCandidate(candidate) || typeof execute !== 'function'
          || !signal || signal.aborted) fail('inbox-target-unproven');
        if (candidate.key && attemptedKeys.has(candidate.key)) fail('inbox-target-already-attempted');
        if (inFlight) fail('inbox-action-in-flight');
        const approvedCandidate = Object.freeze({ key: candidate.key, timestamp: candidate.timestamp,
          ownershipVerified: true });
        inFlight = true;
        let verified = false;
        try {
          await pacing(signal);
          guard();
          const result = await coordinator.mutate(item.lease, {
            accountId: frozen.accountId, actionId: `single_${++actionSequence}`, kind: 'message', delayMs: 1_000,
            inspect: async ({ signal: coordinatorSignal }) => {
              guard();
              if (signal.aborted || coordinatorSignal.aborted) fail('inbox-thread-stopped');
              return { accountId: frozen.accountId, threadId, ownershipVerified: true,
                withinReviewedBoundary: frozen.messageWindow === 'during-run', exactTarget: true };
            },
            execute: async ({ signal: coordinatorSignal }) => {
              const cancel = () => item.abort.abort(coordinatorSignal.reason || 'inbox-approval-revoked');
              coordinatorSignal.addEventListener('abort', cancel, { once: true });
              grant = { candidate: approvedCandidate, signal: coordinatorSignal };
              try {
                assertAction({ threadId, candidate: approvedCandidate });
                if (signal.aborted || coordinatorSignal.aborted) fail('inbox-thread-stopped');
                if (approvedCandidate.key) attemptedKeys.add(approvedCandidate.key);
                const native = Promise.resolve().then(execute);
                pendingNative.add(native);
                try { verified = (await native)?.verified === true; }
                finally { pendingNative.delete(native); }
                return { verified };
              } finally {
                grant = null;
                coordinatorSignal.removeEventListener('abort', cancel);
              }
            },
          });
          publish();
          return { verified: result.verified === true };
        } catch (error) {
          if (!verified) throw error;
          // Keep a proven result counted in the runner even if its checkpoint
          // failed. The coordinator has already revoked further authority.
          item.abort.abort('inbox-checkpoint-failed');
          return { verified: true, stopReason: 'inbox-checkpoint-failed' };
        } finally {
          inFlight = false;
        }
      },
    });
  }
  async function executeQueue(token) {
    return locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock || lock.name !== lockName || lock.mode !== 'exclusive') fail('inbox-account-busy');
      lockHeld = true;
      try {
        documentId = context(null, false).documentId;
        await coordinator.approve(reviewKey, frozen.accountId);
        context();
        while (!abort.signal.aborted && coordinator.snapshot().status === 'running') {
          context();
          const lease = await coordinator.claim(0, frozen.accountId);
          if (!lease) break;
          const item = { lease, abort: new AbortController(), skipped: false };
          active = item;
          const cancel = () => item.abort.abort(abort.signal.reason || 'inbox-run-stopped');
          abort.signal.addEventListener('abort', cancel, { once: true });
          try {
            publish('opening-conversation');
            await navigate({ accountId: frozen.accountId, threadId: lease.threadId,
              expiresAt: frozen.expiresAt, signal: item.abort.signal,
              assertCurrent: () => { context(); if (item.abort.signal.aborted) fail('inbox-thread-stopped'); return true; } });
            if (!item.abort.signal.aborted) {
              context(lease.threadId);
              const plan = runner.createPlan({ threadId: lease.threadId, scope: frozen.scope,
                limit: frozen.limit, speed: 'standard', expiresAt: frozen.expiresAt });
              if (!plan) fail('inbox-thread-plan-invalid');
              publish('unsending');
              const outcome = await runner.start({ plan, workerAdapter: adapterFor(item, token) });
              if (outcome?.uncertain > 0 || coordinator.snapshot().pendingMutation) {
                if (coordinator.snapshot().status === 'running') await coordinator.interrupt('removal-not-proven');
              } else if (!abort.signal.aborted && coordinator.snapshot().status === 'running') {
                const status = item.skipped ? 'skipped' : outcome?.status === 'completed' ? 'completed'
                  : outcome?.processed > 0 ? 'partial' : 'failed';
                await coordinator.finish(lease, status, status === 'completed' ? null : item.skipped ? 'skipped' : 'conversation-incomplete');
                if (!item.skipped && outcome?.status !== 'completed') await coordinator.interrupt('conversation-incomplete');
              }
            } else if (item.skipped && !abort.signal.aborted && coordinator.snapshot().status === 'running') {
              await coordinator.finish(lease, 'skipped', 'skipped');
            }
          } catch (error) {
            if (item.skipped && !abort.signal.aborted && coordinator.snapshot().status === 'running'
              && !coordinator.snapshot().pendingMutation) await coordinator.finish(lease, 'skipped', 'skipped');
            else {
              if (coordinator.snapshot().status === 'running') await coordinator.interrupt('execution-interrupted').catch(() => {});
              throw error;
            }
          } finally {
            abort.signal.removeEventListener('abort', cancel);
            item.abort.abort('conversation-finished');
            if (pendingNative.size) publish('settling');
            await Promise.allSettled([...pendingNative]);
            const settled = coordinator.snapshot();
            if (['paused', 'stopped'].includes(settled.status) && !settled.pendingMutation
              && settled.tasks.find(task => task.threadId === lease.threadId)?.status === 'running') {
              await coordinator.settleInterrupted(lease).catch(() => {});
            }
            active = null;
          }
        }
      } catch (error) {
        if (coordinator.snapshot().status === 'running') await coordinator.interrupt('execution-interrupted').catch(() => {});
        throw error;
      } finally {
        // An adapter timeout is not proof that a native action finished. Keep
        // the account lock until every dispatched native promise has settled.
        await Promise.allSettled([...pendingNative]);
        lockHeld = false;
        authority = null;
        publish('finished');
      }
      return snapshot();
    });
  }
  function interrupt(reason, stop) {
    if (used && phase === 'finished') return Promise.resolve(snapshot());
    abort.abort(reason);
    authority = null;
    publish('settling');
    const persisted = coordinator.interrupt(reason, { stop });
    return Promise.allSettled([persisted, running]).then(() => snapshot());
  }
  return Object.freeze({
    snapshot,
    reviewKey: () => reviewKey,
    subscribe(listener) {
      if (typeof listener !== 'function') fail('inbox-listener-invalid');
      listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener);
    },
    approve(key) {
      if (restored) fail('review-required-after-restart');
      if (used || abort.signal.aborted || authority) fail('inbox-review-already-used');
      if (key !== reviewKey) fail('inbox-review-changed');
      documentId = context(null, false).documentId;
      authority = Object.freeze({});
      return authority;
    },
    start(token) {
      if (restored || token !== authority || !authority || used || abort.signal.aborted) return Promise.reject(new Error('inbox-runtime-approval-required'));
      used = true;
      publish('starting');
      running = executeQueue(token).finally(() => { authority = null; publish('finished'); });
      return running;
    },
    pause: () => interrupt('paused', false),
    stop: () => interrupt('stopped', true),
    skip() {
      if (!active || abort.signal.aborted || active.abort.signal.aborted) return false;
      active.skipped = true; active.abort.abort('conversation-skipped'); publish('settling'); return true;
    },
  });
}

return Object.freeze({ createSingleTabInboxReview, createSingleTabInboxController });
})();
localModules["extension/inbox-userscript-workers.js"] = (() => {

const JOB_KEY = 'instaToolboxGhostJobV1';
const VERSION = 1;
const MAX_THREADS = 1_000;
const MAX_WORKERS = 5;
const MAX_TTL_MS = 12 * 60 * 60_000;
const HEARTBEAT_MS = 3_000;
const STALE_MS = 90_000;
const TERMINAL = new Set(['completed', 'partial', 'skipped', 'failed', 'uncertain', 'stopped']);
const reviews = new WeakSet();
const consumed = new WeakSet();

const clone = value => structuredClone(value);
const fail = reason => { throw new Error(reason); };
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const digest = (value) => {
  const source = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function createUserscriptGhostReview({
  accountId,
  threadIds,
  workerCount = 2,
  openInBackground = true,
  expiresAt,
} = {}, now = Date.now()) {
  if (!identity(accountId) || !Array.isArray(threadIds) || !threadIds.length
    || threadIds.length > MAX_THREADS || !threadIds.every(identity)) fail('ghost-review-invalid');
  const unique = [...new Set(threadIds)];
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > MAX_WORKERS) {
    fail('ghost-worker-count-invalid');
  }
  const expiry = Math.min(Number(expiresAt) || (now + MAX_TTL_MS), now + MAX_TTL_MS);
  if (!Number.isFinite(expiry) || expiry <= now) fail('ghost-review-expired');
  const review = Object.freeze({
    version: VERSION,
    accountId,
    threadIds: Object.freeze(unique),
    workerCount: Math.min(workerCount, unique.length),
    openInBackground: openInBackground !== false,
    scope: 'all',
    reviewedAt: now,
    expiresAt: expiry,
  });
  reviews.add(review);
  return review;
}

const userscriptGhostReviewKey = review => JSON.stringify(review);

function createUserscriptGhostBridge({
  storage,
  locks,
  openTab,
  runner,
  inspectContext,
  location = globalThis.location,
  now = Date.now,
  random = Math.random,
  randomId = () => crypto.randomUUID(),
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  if (typeof storage?.get !== 'function' || typeof storage?.set !== 'function'
    || typeof storage?.listen !== 'function' || typeof storage?.unlisten !== 'function'
    || typeof locks?.request !== 'function' || typeof openTab !== 'function'
    || typeof runner?.createPlan !== 'function' || typeof runner?.start !== 'function'
    || typeof runner?.stop !== 'function' || typeof inspectContext !== 'function'
    || typeof now !== 'function' || typeof random !== 'function' || typeof randomId !== 'function'
    || typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function'
    || typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    fail('ghost-bridge-adapter-required');
  }

  const jobLock = () => 'insta-toolbox:ghost-job';
  const mutationLock = accountId => `insta-toolbox:ghost-mutation:${accountId}`;
  const coordinatorLock = jobId => `insta-toolbox:ghost-coordinator:${jobId}`;
  const read = async () => clone(await storage.get(JOB_KEY));
  const write = async value => storage.set(JOB_KEY, clone(value));
  const update = mutator => locks.request(jobLock(), { mode: 'exclusive' }, async () => {
    const current = await read();
    const next = await mutator(current);
    if (next) await write(next);
    return next ? clone(next) : current;
  });
  const validJob = (job) => job?.version === VERSION && identity(job.jobId)
    && identity(job.accountId) && Array.isArray(job.tasks)
    && job.tasks.every(task => identity(task.threadId) && typeof task.status === 'string');
  const activeJob = (job) => validJob(job) && job.status === 'running'
    && Number(job.expiresAt) > now();
  const coordinatorPresent = job => locks.request(
    coordinatorLock(job.jobId),
    { mode: 'exclusive', ifAvailable: true },
    async lock => !lock,
  );
  const threadFromLocation = () => String(location?.pathname || '').match(/^\/direct\/t\/([^/?#]+)\/?$/)?.[1] || null;
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    let timer = null;
    const finish = (error) => {
      clearTimeoutFn(timer);
      signal?.removeEventListener?.('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    if (signal?.aborted) return abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    timer = setTimeoutFn(() => finish(), ms);
  });

  function createManager(review) {
    if (!review || !reviews.has(review) || consumed.has(review)) fail('ghost-review-required');
    const coordinatorId = randomId();
    const listeners = new Set();
    const handles = new Map();
    let storageListener = null;
    let heartbeat = null;
    let current = null;
    let finishing = null;
    let releaseCoordinatorLock = null;
    let coordinatorLockPromise = null;
    let resolveFinished = null;
    const finished = new Promise(resolve => { resolveFinished = resolve; });
    const snapshot = () => current ? clone(current) : null;
    const publish = (job) => {
      current = job ? clone(job) : null;
      const value = snapshot();
      for (const listener of listeners) listener(value);
      if (value && value.status !== 'running') settle();
    };
    const settle = () => {
      if (finishing) return finishing;
      finishing = Promise.resolve().then(async () => {
        if (heartbeat !== null) clearIntervalFn(heartbeat);
        heartbeat = null;
        if (storageListener !== null) storage.unlisten(storageListener);
        storageListener = null;
        releaseCoordinatorLock?.();
        releaseCoordinatorLock = null;
        await Promise.resolve(coordinatorLockPromise).catch(() => {});
        for (const handle of handles.values()) {
          try { await handle?.close?.(); } catch {}
        }
        handles.clear();
        resolveFinished(snapshot());
        return snapshot();
      });
      return finishing;
    };
    const tick = async () => {
      const launches = [];
      const job = await update((value) => {
        if (!validJob(value) || value.jobId !== current?.jobId
          || value.coordinatorId !== coordinatorId || value.status !== 'running') return value;
        if (now() >= value.expiresAt) {
          value.status = 'expired'; value.reason = 'approval-expired';
          for (const task of value.tasks) if (!TERMINAL.has(task.status)) task.status = 'stopped';
          return value;
        }
        value.coordinatorHeartbeatAt = now();
        const stale = value.tasks.find(task => task.status === 'running'
          && now() - Number(task.workerHeartbeatAt) > STALE_MS);
        if (stale) {
          stale.status = 'uncertain'; stale.reason = 'worker-lost';
          value.status = 'paused'; value.reason = 'worker-lost';
          return value;
        }
        const active = value.tasks.filter(task => ['opening', 'running'].includes(task.status)).length;
        for (const task of value.tasks.filter(task => task.status === 'pending').slice(0, value.workerCount - active)) {
          task.status = 'opening';
          task.launchId = randomId();
          launches.push({ threadId: task.threadId, launchId: task.launchId });
        }
        if (value.tasks.every(task => TERMINAL.has(task.status))) {
          value.status = value.tasks.every(task => task.status === 'completed') ? 'completed' : 'partial';
        }
        value.updatedAt = now();
        return value;
      });
      publish(job);
      for (const launch of launches) {
        try {
          const handle = await openTab(`https://www.instagram.com/direct/t/${encodeURIComponent(launch.threadId)}/`, {
            active: !review.openInBackground, insert: true, setParent: true,
          });
          handles.set(launch.threadId, handle);
        } catch {
          const failed = await update((value) => {
            if (!validJob(value) || value.jobId !== current?.jobId) return value;
            const task = value.tasks.find(item => item.threadId === launch.threadId
              && item.launchId === launch.launchId && item.status === 'opening');
            if (task) { task.status = 'failed'; task.reason = 'tab-open-failed'; }
            value.status = 'paused'; value.reason = 'tab-open-failed'; value.updatedAt = now();
            return value;
          });
          publish(failed);
        }
      }
      return snapshot();
    };
    return Object.freeze({
      kind: 'multi-tab',
      snapshot,
      subscribe(listener) {
        if (typeof listener !== 'function') fail('ghost-listener-required');
        listeners.add(listener); if (current) listener(snapshot());
        return () => listeners.delete(listener);
      },
      async start() {
        if (current) fail('ghost-manager-started');
        consumed.add(review);
        const jobId = randomId();
        current = {
          version: VERSION, jobId, coordinatorId, accountId: review.accountId,
          status: 'running', reason: null, workerCount: review.workerCount,
          openInBackground: review.openInBackground,
          expiresAt: review.expiresAt, reviewedAt: review.reviewedAt,
          reviewKey: userscriptGhostReviewKey(review), coordinatorHeartbeatAt: now(),
          nextActionAt: 0, pendingMutation: null, updatedAt: now(),
          tasks: review.threadIds.map((threadId, index) => ({
            threadId, index, status: 'pending', messageRemovals: 0, reason: null,
          })),
        };
        let announceCoordinatorLock;
        const coordinatorReady = new Promise(resolve => { announceCoordinatorLock = resolve; });
        coordinatorLockPromise = locks.request(
          coordinatorLock(jobId),
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            announceCoordinatorLock(Boolean(lock));
            if (!lock) return;
            await new Promise(resolve => { releaseCoordinatorLock = resolve; });
          },
        );
        if (!await coordinatorReady) fail('ghost-coordinator-active');
        try {
          await locks.request(jobLock(), { mode: 'exclusive' }, async () => {
            const existing = await read();
            if (activeJob(existing)) fail('ghost-job-active');
            await write(current);
          });
          storageListener = storage.listen(JOB_KEY, value => {
            if (!validJob(value) || value.jobId !== current?.jobId) return;
            publish(value);
          });
          heartbeat = setIntervalFn(() => { void tick().catch(() => {}); }, HEARTBEAT_MS);
          await tick();
          return finished;
        } catch (error) {
          current.status = 'failed'; current.reason = error?.message || 'ghost-start-failed';
          await settle();
          throw error;
        }
      },
      async stop() {
        if (!current || current.status !== 'running') return snapshot();
        const stopped = await update((value) => {
          if (!validJob(value) || value.jobId !== current.jobId) return value;
          value.status = 'stopped'; value.reason = 'stopped'; value.updatedAt = now();
          for (const task of value.tasks) if (!TERMINAL.has(task.status)) {
            task.status = 'stopped'; task.reason = 'stopped';
          }
          return value;
        });
        publish(stopped);
        await settle();
        return snapshot();
      },
    });
  }

  async function attachWorker() {
    const threadId = threadFromLocation();
    if (!threadId) return null;
    const workerId = randomId();
    let latest = await read();
    const context = inspectContext();
    if (!activeJob(latest) || !await coordinatorPresent(latest)
      || context?.accountId !== latest.accountId
      || context?.threadId !== threadId || context?.usable !== true) return null;
    latest = await update((value) => {
      if (!activeJob(value) || value.accountId !== context.accountId) return value;
      const task = value.tasks.find(item => item.threadId === threadId && item.status === 'opening');
      if (!task) return value;
      task.status = 'running'; task.workerId = workerId; task.workerHeartbeatAt = now();
      value.updatedAt = now();
      return value;
    });
    let task = latest?.tasks?.find(item => item.threadId === threadId);
    if (!task || task.workerId !== workerId || task.status !== 'running') return null;
    const controller = new AbortController();
    const storageListener = storage.listen(JOB_KEY, value => {
      if (!validJob(value) || value.jobId !== latest.jobId) {
        controller.abort('ghost-worker-revoked'); runner.stop(); return;
      }
      latest = clone(value);
      const row = latest.tasks.find(item => item.threadId === threadId);
      if (latest.status !== 'running' || row?.workerId !== workerId || row.status !== 'running') {
        controller.abort(latest.reason || 'ghost-worker-revoked'); runner.stop();
      }
    });
    const heartbeat = setIntervalFn(() => { void update((value) => {
      if (!validJob(value) || value.jobId !== latest.jobId || value.status !== 'running') return value;
      const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
      if (row?.status === 'running') row.workerHeartbeatAt = now();
      value.updatedAt = now();
      return value;
    }).catch(() => { controller.abort('ghost-worker-storage-failed'); runner.stop(); }); }, HEARTBEAT_MS);
    const valid = (candidate = null) => {
      const currentContext = inspectContext();
      const row = latest?.tasks?.find(item => item.threadId === threadId);
      if (controller.signal.aborted || !activeJob(latest) || row?.workerId !== workerId
        || row?.status !== 'running' || currentContext?.accountId !== latest.accountId
        || currentContext?.threadId !== threadId || currentContext?.usable !== true
        || currentContext?.restriction) fail('ghost-worker-context-changed');
      if (candidate && candidate.ownershipVerified !== true) fail('ghost-worker-target-unproven');
      return true;
    };
    let grant = null;
    const adapter = Object.freeze({
      signal: controller.signal,
      assertContext: ({ threadId: expected }) => expected === threadId && valid(),
      assertAction: ({ threadId: expected, candidate }) => expected === threadId && grant
        && candidate?.key === grant.key && candidate?.timestamp === grant.timestamp && valid(candidate),
      execute: ({ candidate, threadId: expected, signal, execute }) => locks.request(
        mutationLock(latest.accountId), { mode: 'exclusive' }, async () => {
          if (expected !== threadId || signal.aborted || typeof execute !== 'function') fail('ghost-worker-target-unproven');
          latest = await read(); valid(candidate);
          if (!await coordinatorPresent(latest)) fail('ghost-coordinator-lost');
          while (Number(latest.nextActionAt) > now()) {
            await sleep(Math.min(500, latest.nextActionAt - now()), controller.signal);
            latest = await read(); valid(candidate);
            if (!await coordinatorPresent(latest)) fail('ghost-coordinator-lost');
          }
          grant = { key: candidate.key, timestamp: candidate.timestamp };
          latest = await update((value) => {
            if (!activeJob(value) || value.jobId !== latest.jobId || value.pendingMutation) fail('ghost-job-changed');
            const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
            if (row?.status !== 'running') fail('ghost-worker-revoked');
            value.pendingMutation = { threadId, workerId, phase: 'dispatched' };
            value.nextActionAt = now() + 1_000 + Math.floor(Math.max(0, Math.min(1, random())) * 1_000);
            value.updatedAt = now();
            return value;
          });
          let result;
          try { result = await execute(); }
          catch { result = { verified: false }; }
          latest = await update((value) => {
            if (!validJob(value) || value.jobId !== latest.jobId) return value;
            const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
            if (result?.verified === true && row) {
              row.messageRemovals += 1; value.pendingMutation = null;
            } else {
              if (row) { row.status = 'uncertain'; row.reason = 'removal-not-proven'; }
              if (value.pendingMutation?.workerId === workerId) value.pendingMutation.phase = 'uncertain';
              value.status = 'paused'; value.reason = 'removal-not-proven';
            }
            value.updatedAt = now();
            return value;
          });
          grant = null;
          if (result?.verified !== true) controller.abort('removal-not-proven');
          return { verified: result?.verified === true };
        }),
    });
    try {
      const plan = runner.createPlan({ threadId, scope: 'all', expiresAt: latest.expiresAt });
      if (!plan) fail('ghost-thread-plan-invalid');
      const outcome = await runner.start({ plan, workerAdapter: adapter });
      latest = await update((value) => {
        if (!validJob(value) || value.jobId !== latest.jobId) return value;
        const row = value.tasks.find(item => item.threadId === threadId && item.workerId === workerId);
        if (!row || row.status !== 'running') return value;
        row.status = outcome?.status === 'completed' ? 'completed'
          : outcome?.uncertain ? 'uncertain' : outcome?.processed > 0 ? 'partial' : 'failed';
        row.reason = outcome?.status === 'completed' ? null : outcome?.message || 'conversation-incomplete';
        if (row.status === 'uncertain') { value.status = 'paused'; value.reason = 'removal-not-proven'; }
        value.updatedAt = now();
        return value;
      });
      return clone(latest.tasks.find(item => item.threadId === threadId));
    } finally {
      clearIntervalFn(heartbeat);
      storage.unlisten(storageListener);
      grant = null;
    }
  }

  return Object.freeze({
    createReview: value => createUserscriptGhostReview(value, now()),
    createManager,
    attachWorker,
    readJob: read,
  });
}

const USERSCRIPT_GHOST_LIMITS = Object.freeze({ maxWorkers: MAX_WORKERS, maxThreads: MAX_THREADS });

return Object.freeze({ createUserscriptGhostReview, userscriptGhostReviewKey, createUserscriptGhostBridge, USERSCRIPT_GHOST_LIMITS });
})();
localModules["extension/inbox-userscript-panel.js"] = (() => {
const { createUserscriptInboxDiscovery } = localModules["extension/inbox-userscript-discovery.js"];
const { inboxReviewKey } = localModules["extension/inbox-coordinator.js"];
const { createSingleTabInboxController, createSingleTabInboxReview } = localModules["extension/inbox-single-tab.js"];
const { createUserscriptGhostBridge, userscriptGhostReviewKey } = localModules["extension/inbox-userscript-workers.js"];




function mountUserscriptInboxPanel({
  container, document = globalThis.document, window = globalThis.window,
  viewer = globalThis.InstaToolboxInstagramViewer,
  runner = globalThis.InstaToolboxDmThreadUnsender,
  confirmAction, cancelConfirmation = () => {}, save, load = async () => null,
  workerTransport = null,
  defaultWorkerCount = 2,
  openWorkersInBackground = true,
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
  container.append(note, section, acknowledgment, controls, inventoryStatus, filterLabel, filterStatus,
    list, workersLabel, workerModeLabel, workerNote, supportNote, recovery, actions, storageNote, results);

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
  const discovery = createUserscriptInboxDiscovery({ document, window, viewer, onProgress: showInventory });
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
      if (ghostBridge) {
        const account = context();
        const plan = ghostBridge.createReview({
          accountId: account.accountId,
          threadIds: captured.threadIds,
          workerCount: Number(workers.value),
          openInBackground: workerMode.value === 'background',
          expiresAt: Date.now() + 12 * 60 * 60_000,
        });
        const key = userscriptGhostReviewKey(plan);
        const confirmed = await confirmAction({
          title: `Clean up ${plan.threadIds.length} conversation${plan.threadIds.length === 1 ? '' : 's'}?`,
          message: 'Permanently unsend your messages in the selected conversations.',
          detail: 'Keep the inbox tab and worker tabs open. Worker tabs prepare conversations in parallel; removals stay account-paced and stop together.',
          confirmLabel: 'Start Ghost mode',
          facts: [{ label: 'Account', value: account.accountLabel ? `@${account.accountLabel}` : 'Current signed-in account' },
            { label: 'Conversations', value: String(plan.threadIds.length) },
            { label: 'Worker tabs', value: String(plan.workerCount) },
            { label: 'Open tabs', value: plan.openInBackground ? 'In the background' : 'In front' },
            { label: 'Messages', value: 'All messages you sent' }],
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

return Object.freeze({ mountUserscriptInboxPanel });
})();
localModules["extension/inbox-checkpoint-store.js"] = (() => {
const { createInboxReview, inboxReviewKey } = localModules["extension/inbox-coordinator.js"];

const TASK_STATUSES = new Set(['pending', 'running', 'completed', 'partial', 'skipped', 'failed', 'uncertain']);
const JOB_STATUSES = new Set(['review', 'running', 'paused', 'stopped', 'completed', 'partial']);
const REASONS = new Set([
  'paused', 'stopped', 'completed', 'stable-exhaustion', 'limit-reached', 'expired',
  'thread-changed', 'wrong-thread', 'account-changed', 'viewer-changed', 'user-stop',
  'worker-restart', 'worker-retired', 'worker-response-timeout', 'worker-closed',
  'interrupted', 'interrupted-mutation', 'review-required-after-restart',
  'removal-not-proven', 'inspection-failed', 'storage-timeout', 'storage-failed',
  'challenge', 'rate-limited', 'action-blocked', 'session-expired',
  'context-changed', 'context-unavailable', 'document-frozen', 'page-hidden',
  'pagehide', 'freeze', 'reconciliation-required', 'other',
]);
const record = (value) => value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = (value) => structuredClone(value);
const fail = (reason) => { throw new Error(reason); };
const reason = (value) => value == null ? null : REASONS.has(value) ? value : 'other';
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function sanitize(snapshot) {
  if (!record(snapshot) || snapshot.version !== 1 || !record(snapshot.review)
    || !Number.isSafeInteger(snapshot.review.reviewedAt) || snapshot.review.reviewedAt <= 0
    || !JOB_STATUSES.has(snapshot.status)) fail('checkpoint-invalid');
  const review = createInboxReview(snapshot.review, snapshot.review.reviewedAt);
  if (!Array.isArray(snapshot.tasks) || snapshot.tasks.length !== review.threadIds.length) fail('checkpoint-invalid');
  const tasks = snapshot.tasks.map((task, index) => {
    const workerIndex = review.assignmentMode === 'batches' ? index % review.workerCount
      : Math.min(review.workerCount - 1, Math.floor(index / Math.ceil(review.threadIds.length / review.workerCount)));
    const batchIndex = review.assignmentMode === 'batches' ? Math.floor(index / review.workerCount) : undefined;
    if (!record(task) || task.threadId !== review.threadIds[index] || task.workerIndex !== workerIndex
      || task.batchIndex !== batchIndex || !TASK_STATUSES.has(task.status)
      || !count(task.messageRemovals) || !count(task.reactionRemovals)) fail('checkpoint-invalid');
    return {
      threadId: task.threadId, workerIndex, ...(batchIndex !== undefined ? { batchIndex } : {}),
      status: task.status, messageRemovals: task.messageRemovals,
      reactionRemovals: task.reactionRemovals, reason: reason(task.reason),
    };
  });
  const seen = new Set();
  const pending = (value) => {
    if (!record(value) || !review.threadIds.includes(value.threadId) || seen.has(value.threadId)
      || !['message', 'reaction'].includes(value.kind)
      || !['prepared', 'dispatched', 'uncertain'].includes(value.phase)) fail('checkpoint-invalid');
    seen.add(value.threadId);
    return { threadId: value.threadId, kind: value.kind, phase: value.phase };
  };
  const pendingMutation = snapshot.pendingMutation == null ? null : pending(snapshot.pendingMutation);
  const concurrency = review.mutationConcurrency ?? 1;
  let pendingMutations;
  if (snapshot.pendingMutations !== undefined) {
    if (concurrency === 1 || pendingMutation || !Array.isArray(snapshot.pendingMutations)
      || snapshot.pendingMutations.length > concurrency) fail('checkpoint-invalid');
    pendingMutations = snapshot.pendingMutations.map(pending);
  }
  if (!Number.isFinite(snapshot.nextActionAt) || snapshot.nextActionAt < 0) fail('checkpoint-invalid');
  return {
    version: 1, review: clone(review), status: snapshot.status, reason: reason(snapshot.reason), tasks,
    pendingMutation, nextActionAt: snapshot.nextActionAt,
    ...(pendingMutations !== undefined ? { pendingMutations } : {}),
  };
}

function parseRecord(value) {
  if (value == null) return { version: 1, jobs: [] };
  // Earlier candidates stored one plain coordinator snapshot at this same key.
  if (record(value) && value.version === 1 && value.jobs === undefined
    && record(value.review) && Array.isArray(value.tasks)) {
    return { version: 1, jobs: [sanitize(value)] };
  }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.jobs) || value.jobs.length > 20) fail('checkpoint-history-invalid');
  const jobs = value.jobs.map(sanitize);
  const keys = jobs.map((job) => inboxReviewKey(job.review));
  if (new Set(keys).size !== keys.length) fail('checkpoint-history-invalid');
  return { version: 1, jobs };
}

function recover(snapshot) {
  const copy = clone(snapshot);
  const markers = [copy.pendingMutation, ...(copy.pendingMutations || [])].filter(Boolean);
  for (const task of copy.tasks) {
    if (task.status === 'running') { task.status = 'partial'; task.reason = 'worker-restart'; }
    if (markers.some((marker) => marker.threadId === task.threadId)) {
      task.status = 'uncertain'; task.reason = 'interrupted-mutation';
    }
  }
  for (const marker of markers) marker.phase = 'uncertain';
  if (markers.length || ['review', 'running', 'paused'].includes(copy.status)) {
    copy.status = 'paused'; copy.reason = 'review-required-after-restart';
  }
  return copy;
}

/** One trusted coordinator owns a store instance and its single backing key. */
function createInboxCheckpointStore({ read, write, inspectAccount, timeoutMs = 10_000, now = Date.now } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function' || typeof inspectAccount !== 'function'
    || typeof now !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail('checkpoint-storage-adapter-invalid');
  let tail = Promise.resolve();
  let writeFailure = null;
  const serial = (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  function account() {
    const context = inspectAccount();
    if (!record(context) || context.accountVerified !== true || context.restriction
      || typeof context.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(context.accountId)) fail('verified-account-required');
    return context.accountId;
  }
  const sameAccount = (expected) => { if (account() !== expected) fail('checkpoint-account-changed'); };
  async function bounded(operation, kind) {
    let timer;
    const started = now();
    if (!Number.isFinite(started)) fail('checkpoint-clock-invalid');
    try {
      const value = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`checkpoint-${kind}-timeout`)), timeoutMs); }),
      ]);
      const ended = now();
      if (!Number.isFinite(ended) || ended < started || ended - started >= timeoutMs) fail(`checkpoint-${kind}-timeout`);
      return value;
    } finally { clearTimeout(timer); }
  }
  async function readFor(expected) {
    const stored = parseRecord(await bounded(read, 'read'));
    sameAccount(expected);
    return stored;
  }
  return Object.freeze({
    load: () => serial(async () => {
      const expected = account();
      const stored = await readFor(expected);
      const latest = stored.jobs.find((job) => job.review.accountId === expected);
      return latest ? recover(latest) : null;
    }),
    history: () => serial(async () => {
      const expected = account();
      const stored = await readFor(expected);
      return stored.jobs.filter((job) => job.review.accountId === expected).map(recover);
    }),
    save: (snapshot) => {
      // Copy immediately: a queued persistence call must not observe later mutations.
      let clean;
      let expected;
      try {
        expected = account(); clean = sanitize(snapshot);
        if (clean.review.accountId !== expected) fail('checkpoint-account-mismatch');
      } catch (error) { return Promise.reject(error); }
      return serial(async () => {
        if (writeFailure) throw writeFailure;
        sameAccount(expected);
        const stored = await readFor(expected);
        const key = inboxReviewKey(clean.review);
        const previous = stored.jobs.find((job) => inboxReviewKey(job.review) === key);
        if (previous && clean.tasks.some((task, index) => (
          task.messageRemovals < previous.tasks[index].messageRemovals
          || task.reactionRemovals < previous.tasks[index].reactionRemovals
        ))) fail('checkpoint-count-regression');
        const next = { version: 1, jobs: [clean, ...stored.jobs.filter((job) => inboxReviewKey(job.review) !== key)].slice(0, 20) };
        sameAccount(expected);
        try { await bounded(() => write(clone(next)), 'write'); }
        catch (error) {
          // A timed-out or rejected write may still settle. Fence all newer writes.
          writeFailure = new Error(error?.message === 'checkpoint-write-timeout' ? 'checkpoint-write-timeout' : 'checkpoint-write-failed');
          throw writeFailure;
        }
        sameAccount(expected);
        return clone(clean);
      });
    },
  });
}

return Object.freeze({ createInboxCheckpointStore });
})();
localModules["src/core/presence.js"] = (() => {

/**
 * Deterministic, account-bound Presence planning.
 * No network, DOM, credentials, or action authority.
 * Inputs describe observations; a future trusted adapter must revalidate them.
 */
const PRESENCE_VERSION = 1;
const PRESENCE_CAPABILITIES = Object.freeze({
  planning: true, preview: true, live: false, discovery: false,
  scheduledExecution: false, likes: false, comments: false, messages: false,
  background: false, ghostHandoff: false,
});
const ROUTINES = Object.freeze({
  discover: Object.freeze({ name: 'Find my people', goal: 'discover', followLimit: 12, unfollowLimit: 0 }),
  maintain: Object.freeze({ name: 'Stay connected', goal: 'maintain', followLimit: 6, unfollowLimit: 0 }),
  curate: Object.freeze({ name: 'Make room', goal: 'curate', followLimit: 0, unfollowLimit: 12 }),
});
const DAY = 86_400_000;
const MAX_ITEMS = 2_000;
const RESERVED = new Set(['accounts', 'direct', 'explore', 'reels', 'stories', 'settings', 'api']);
const RELATIONS = new Set(['following', 'not-following', 'requested', 'unknown']);
const SOURCES = new Set(['manual', 'mutual-checker', 'managed-history']);
const STOPS = new Set(['challenge', 'rate-limit', 'action-blocked', 'signed-out', 'uncertain']);

function record(value, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object.`);
  }
  return value;
}
function integer(value, min, max, fallback, name) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return n;
}
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,29}$/u.test(value)) {
    throw new TypeError(`${name} must be a stable numeric ID string.`);
  }
  return value;
}
function timestamp(value, name) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be an epoch-millisecond integer.`);
  }
  return value;
}
function bool(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be true or false.`);
  return value;
}
function list(value, name, max = MAX_ITEMS) {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${name} must contain at most ${max} items.`);
  return value;
}
function strings(value, name, max = 30) {
  return [...new Set(list(value, name, max).map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 80) throw new TypeError(`Invalid ${name} item.`);
    return item.trim().toLowerCase();
  }))].sort();
}
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
function normalizeHandle(value) {
  const text = typeof value === 'string' ? value.trim().replace(/^@/u, '').toLowerCase() : '';
  if (!/^[a-z0-9._]{1,30}$/u.test(text) || RESERVED.has(text)) throw new TypeError('Invalid Instagram username.');
  return text;
}

/** Return a new allowlisted profile; imported enabled/authority fields are ignored. */
function normalizeProfile(input = {}) {
  const p = record(input, 'Profile');
  if (p.version !== undefined && p.version !== PRESENCE_VERSION) throw new TypeError('Unsupported profile version.');
  const goal = p.goal ?? 'discover';
  if (!Object.hasOwn(ROUTINES, goal)) throw new TypeError('Unknown routine.');
  const preset = ROUTINES[goal];
  const timezone = p.timezone ?? 'UTC';
  if (typeof timezone !== 'string' || timezone.length > 80) throw new TypeError('Invalid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0); }
  catch { throw new TypeError('Invalid time zone.'); }
  const window = record(p.window ?? { start: 540, end: 1200 }, 'Active window');
  const start = integer(window.start, 0, 1439, 540, 'Start minute');
  const end = integer(window.end, 0, 1439, 1200, 'End minute');
  if (start === end) throw new TypeError('Choose a nonempty active window.');
  return deepFreeze({
    version: PRESENCE_VERSION,
    accountId: identifier(p.accountId, 'Account ID'),
    username: normalizeHandle(p.username), goal, timezone, window: { start, end },
    topics: strings(p.topics ?? [], 'Topics'),
    excludedTopics: strings(p.excludedTopics ?? [], 'Excluded topics'),
    protectedIds: [...new Set(list(p.protectedIds ?? [], 'Protected IDs', 500)
      .map((id) => identifier(id, 'Protected ID')))].sort(),
    followLimit: integer(p.followLimit, 0, 50, preset.followLimit, 'Follow limit'),
    unfollowLimit: integer(p.unfollowLimit, 0, 50, preset.unfollowLimit, 'Unfollow limit'),
    waitDays: integer(p.waitDays, 1, 365, 7, 'Follow-up days'),
    evidenceMaxAgeMinutes: integer(p.evidenceMaxAgeMinutes, 1, 1440, 30, 'Evidence age'),
    skipPrivate: bool(p.skipPrivate, true, 'Skip private'),
    keepMutuals: true, reviewRequired: true, liveEnabled: false,
  });
}

/** Active windows are local wall time; waiting periods below use elapsed time. */
function activeNow(profile, now) {
  const p = normalizeProfile(profile);
  timestamp(now, 'Now');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: p.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const minute = Number(parts.find((x) => x.type === 'hour').value) * 60
    + Number(parts.find((x) => x.type === 'minute').value);
  const { start, end } = p.window;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function normalizeCandidate(input) {
  const c = record(input, 'Candidate');
  const relation = c.relation ?? 'unknown';
  if (!RELATIONS.has(relation)) throw new TypeError('Invalid relationship.');
  const source = c.source ?? 'manual';
  if (!SOURCES.has(source)) throw new TypeError('Unsupported candidate source.');
  const proof = c.followsMeEvidence ?? 'unknown';
  if (!['direct', 'complete-list', 'partial-list', 'unknown'].includes(proof)) throw new TypeError('Invalid relationship evidence.');
  if (c.followsMe != null && typeof c.followsMe !== 'boolean') throw new TypeError('Invalid follow-back state.');
  if (c.isPrivate != null && typeof c.isPrivate !== 'boolean') throw new TypeError('Invalid privacy state.');
  return {
    accountId: identifier(c.accountId, 'Observation account'),
    targetId: identifier(c.targetId, 'Target ID'), username: normalizeHandle(c.username),
    relation, source, followsMe: c.followsMe ?? null, followsMeEvidence: proof,
    isPrivate: c.isPrivate ?? null,
    observedAt: timestamp(c.observedAt, 'Observation time'),
    topics: strings(c.topics ?? [], 'Candidate topics'),
  };
}
function normalizeHistory(input) {
  const h = record(input, 'History');
  return {
    accountId: identifier(h.accountId, 'History account'),
    targetId: identifier(h.targetId, 'History target'),
    followedAt: timestamp(h.followedAt, 'Follow time'),
    outcome: ['verified', 'uncertain'].includes(h.outcome) ? h.outcome : 'uncertain',
    origin: h.origin === 'presence' ? 'presence' : 'legacy',
  };
}

/**
 * Compile finite suggestions. This is NOT a signed job or permission to click.
 * IDs/observations from a UI or import remain untrusted until runtime inspection.
 */
function compilePlan({ profile, candidates = [], history = [], now, usage = {} }) {
  timestamp(now, 'Now');
  const p = normalizeProfile(profile);
  record(usage, 'Usage');
  const usedFollow = integer(usage.follow, 0, 1_000_000, 0, 'Used follows');
  const usedUnfollow = integer(usage.unfollow, 0, 1_000_000, 0, 'Used unfollows');
  const rows = list(candidates, 'Candidates').map(normalizeCandidate);
  const events = list(history, 'History', 10_000).map(normalizeHistory);
  const counts = new Map();
  const names = new Map();
  const eventsById = new Map();
  for (const c of rows) {
    counts.set(c.targetId, (counts.get(c.targetId) || 0) + 1);
    names.set(c.username, (names.get(c.username) || 0) + 1);
  }
  for (const h of events) {
    if (h.accountId !== p.accountId) continue;
    const bucket = eventsById.get(h.targetId) || [];
    bucket.push(h); eventsById.set(h.targetId, bucket);
  }
  const active = activeNow(p, now);
  const decisions = rows.map((c) => {
    const sharedTopics = c.topics.filter((t) => p.topics.includes(t));
    const decision = { targetId: c.targetId, username: c.username, source: c.source,
      state: 'held', action: null, reason: '', score: sharedTopics.length, dueAt: null };
    const end = (state, reason, action = null) => ({ ...decision, state, reason, action });
    if (c.accountId !== p.accountId) return end('held', 'Different account');
    if (c.targetId === p.accountId || c.username === p.username) return end('protected', 'Your own account');
    if (counts.get(c.targetId) > 1 || names.get(c.username) > 1) return end('held', 'Duplicate or conflicting identity');
    if (p.protectedIds.includes(c.targetId)) return end('protected', 'On your keep list');
    if (c.observedAt > now || now - c.observedAt > p.evidenceMaxAgeMinutes * 60_000) {
      return end('held', 'Refresh this observation');
    }
    const prior = eventsById.get(c.targetId) || [];
    if (c.relation === 'requested') return end('protected', 'Follow request already pending');
    if (c.relation === 'not-following') {
      if (prior.length) return end('protected', 'Previously followed; no repeat cycle');
      if (p.goal === 'curate') return end('skipped', 'This routine only revisits managed follows');
      if (p.skipPrivate && c.isPrivate !== false) return end('held', 'Private or unknown account visibility');
      if (c.topics.some((t) => p.excludedTopics.includes(t))) return end('skipped', 'Matches an excluded topic');
      if (p.goal === 'maintain' && !(c.followsMe === true && ['direct', 'complete-list'].includes(c.followsMeEvidence))) {
        return end('held', 'Follow-back evidence required for Stay connected');
      }
      if (p.goal === 'discover' && (!p.topics.length || !sharedTopics.length)) return end('skipped', 'No selected interest match');
      return end('eligible', p.goal === 'maintain' ? 'Follows you; review a follow back' : `Matches ${sharedTopics.join(', ')}`, 'follow');
    }
    if (c.relation !== 'following') return end('held', 'Current relationship is unknown');
    if (c.followsMe === true) return end('protected', 'Mutual connection');
    if (prior.length !== 1 || prior[0]?.origin !== 'presence' || prior[0]?.outcome !== 'verified') {
      return end('protected', 'No unique verified managed follow');
    }
    const event = prior[0];
    if (event.followedAt > now) return end('held', 'Invalid future follow history');
    decision.dueAt = event.followedAt + p.waitDays * DAY;
    if (now < decision.dueAt) return end('waiting', 'Still in your follow-up window');
    if (c.followsMe !== false || !['direct', 'complete-list'].includes(c.followsMeEvidence)) {
      return end('held', 'Not found is not proof of a non-mutual');
    }
    return end('eligible', 'Follow-up due; verified non-mutual', 'unfollow');
  }).sort((a, b) => b.score - a.score || (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0));
  const available = { follow: Math.max(0, p.followLimit - usedFollow), unfollow: Math.max(0, p.unfollowLimit - usedUnfollow) };
  const targets = [];
  for (const d of decisions) {
    if (d.state !== 'eligible') continue;
    if (!active) { d.state = 'held'; d.reason = 'Outside your active window'; continue; }
    if (!available[d.action]) { d.state = 'held'; d.reason = 'Your session allowance is used'; continue; }
    available[d.action] -= 1;
    d.state = 'planned';
    targets.push({ targetId: d.targetId, username: d.username, action: d.action, reason: d.reason });
  }
  return deepFreeze({
    kind: 'presence-review', version: PRESENCE_VERSION, executable: false,
    accountId: p.accountId, profile: p, createdAt: now, expiresAt: now + 15 * 60_000,
    activeWindow: active, targets, decisions,
    notice: 'Planning only. Live execution requires a fresh review and a trusted browser adapter.',
  });
}

/** Pure arbitration advice, not an inter-tab mutex or action authorization. */
function modeHandoff({ current, next, inFlight = false, uncertain = false }) {
  if (!['presence', 'ghost', 'idle'].includes(current) || !['presence', 'ghost', 'idle'].includes(next)) {
    throw new TypeError('Unknown activity mode.');
  }
  if (uncertain) return Object.freeze({ ready: false, reason: 'Reconcile the uncertain action first.' });
  if (inFlight) return Object.freeze({ ready: false, reason: 'Wait for the dispatched action to settle.' });
  return Object.freeze({ ready: true, reason: 'Revoke the old mode, then review the new scope.', requiresFreshReview: next !== 'idle' });
}

/** Finite, synchronous, no-click preview state machine. No injected executor. */
function createPreviewSession(plan, now = Date.now) {
  record(plan, 'Plan');
  if (plan.kind !== 'presence-review' || plan.version !== PRESENCE_VERSION || plan.executable !== false) {
    throw new TypeError('A planning-only Presence review is required.');
  }
  const accountId = identifier(plan.accountId, 'Plan account');
  const createdAt = timestamp(plan.createdAt, 'Plan creation');
  const expiresAt = timestamp(plan.expiresAt, 'Plan expiry');
  if (expiresAt <= createdAt || expiresAt - createdAt > 15 * 60_000) throw new TypeError('Invalid plan lifetime.');
  const targets = list(plan.targets, 'Plan targets', 100).map((t) => {
    record(t, 'Target');
    if (!['follow', 'unfollow'].includes(t.action)) throw new TypeError('Unsupported preview action.');
    return Object.freeze({ targetId: identifier(t.targetId, 'Target ID'), username: normalizeHandle(t.username), action: t.action });
  });
  if (new Set(targets.map((t) => t.targetId)).size !== targets.length) throw new TypeError('Duplicate plan target.');
  let state = 'draft'; let cursor = 0; let reason = ''; const results = [];
  const snapshot = () => deepFreeze({ mode: 'preview', live: false, state, accountId,
    total: targets.length, simulated: cursor, reason, results: results.map((x) => ({ ...x })) });
  return Object.freeze({ snapshot, dispatch(event, context = {}) {
    const clock = timestamp(now(), 'Clock');
    if (['stopped', 'expired', 'simulated'].includes(state)) return snapshot();
    if (clock < createdAt || clock >= expiresAt) { state = 'expired'; reason = 'Review expired. Build a fresh plan.'; return snapshot(); }
    if (context.accountId !== undefined && context.accountId !== accountId) {
      state = 'stopped'; reason = 'Account changed.'; return snapshot();
    }
    if (STOPS.has(context.restriction)) { state = 'stopped'; reason = context.restriction; return snapshot(); }
    if (event === 'stop') { state = 'stopped'; reason = 'Stopped by you.'; return snapshot(); }
    if (event === 'ghost') { state = 'paused'; reason = 'Ghost needs a separate review; no automatic handoff.'; return snapshot(); }
    if (event === 'review' && state === 'draft') {
      if (context.accountId !== accountId) throw new Error('Review must name the planning account.');
      state = 'ready';
    } else if (event === 'start' && state === 'ready') {
      state = targets.length ? 'previewing' : 'simulated';
    } else if (event === 'pause' && state === 'previewing') { state = 'paused'; reason = 'Preview paused.';
    } else if (event === 'resume' && state === 'paused') {
      if (context.accountId !== accountId) throw new Error('Resume must name the planning account.');
      state = 'ready'; reason = 'Review ready; start the preview again.';
    } else if (event === 'step' && state === 'previewing') {
      results.push({ ...targets[cursor], outcome: 'simulated' }); cursor += 1;
      if (cursor === targets.length) state = 'simulated';
    } else { throw new Error(`Cannot ${event} from ${state}.`); }
    return snapshot();
  } });
}

return Object.freeze({ PRESENCE_VERSION, PRESENCE_CAPABILITIES, ROUTINES, normalizeHandle, normalizeProfile, activeNow, compilePlan, modeHandoff, createPreviewSession });
})();
localModules["extension/presence-native-inputs.js"] = (() => {
const { normalizeHandle, normalizeProfile } = localModules["src/core/presence.js"];

const numericId = (value) => typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value) ? value : null;
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function unavailable(reason) {
  return freeze({ status: 'unavailable', executable: false, reason, inputs: null });
}
function viewerIdentity(viewer) {
  if (viewer?.accountVerified !== true || viewer.restriction
    || viewer.identityKind !== 'verified-viewer-username'
    || viewer.evidence !== 'visible-account-picker-and-navigation') return null;
  try {
    const username = normalizeHandle(viewer.accountId);
    const key = `iguser-v1-${[...username].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
    return viewer.accountKey === key ? { username, key } : null;
  } catch { return null; }
}

function captureRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100_000) return null;
  const identities = new Map();
  const names = new Map();
  const ambiguousIds = new Set();
  const ambiguousNames = new Set();
  let unresolved = 0;
  for (const row of rows) {
    let username;
    try { username = normalizeHandle(row?.username); } catch { unresolved += 1; continue; }
    const id = numericId(row?.instagramId);
    if (!id || row.instagramIdAmbiguous === true || row.source !== 'authenticated-instagram-web') {
      unresolved += 1;
      ambiguousNames.add(username);
      if (id) ambiguousIds.add(id);
      continue;
    }
    if (identities.has(id) && identities.get(id) !== username) {
      ambiguousIds.add(id);
      ambiguousNames.add(identities.get(id));
      ambiguousNames.add(username);
    }
    if (names.has(username) && names.get(username) !== id) {
      ambiguousIds.add(id);
      ambiguousIds.add(names.get(username));
      ambiguousNames.add(username);
    }
    identities.set(id, username);
    names.set(username, id);
  }
  const accounts = [...identities].filter(([id, username]) => (
    !ambiguousIds.has(id) && !ambiguousNames.has(username)
  )).map(([id, username]) => ({ id, username }));
  return { accounts, unresolved: unresolved + identities.size - accounts.length };
}

/** Dependencies must remain in the trusted runtime closure, never page messages. */
function createPresenceNativeInputs({ fetchFollowerComparison, inspectViewer, now = Date.now } = {}) {
  if (typeof fetchFollowerComparison !== 'function' || typeof inspectViewer !== 'function'
    || typeof now !== 'function') throw new TypeError('Trusted checker and viewer adapters are required.');
  const receipts = new WeakMap();
  const seenResults = new WeakSet();
  let generation = 0;
  function inspect() {
    try { return viewerIdentity(inspectViewer()); } catch { return null; }
  }

  async function captureComparison({ username, retryRateLimits = false, signal, onProgress } = {}) {
    const token = ++generation;
    const start = now();
    const before = inspect();
    // Only these options reach the native checker; callers cannot inject a fetch implementation.
    const result = await fetchFollowerComparison({ username, retryRateLimits, signal, onProgress });
    const end = now();
    const after = inspect();
    if (result && typeof result === 'object') {
      if (seenResults.has(result)) return result;
      seenResults.add(result);
    }
    if (token !== generation || signal?.aborted || !before || !after
      || before.key !== after.key || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || end < start || !result || typeof result !== 'object') return result;
    let subject;
    try { subject = normalizeHandle(result.username); } catch { return result; }
    const requested = (() => { try { return normalizeHandle(username); } catch { return null; } })();
    const accountId = numericId(result.subjectInstagramId);
    const observedAt = Date.parse(result.capturedAt);
    if (subject !== before.username || requested !== subject || !accountId
      || result.source !== 'authenticated-instagram-web'
      || !Number.isSafeInteger(observedAt) || observedAt < start || observedAt > end) return result;
    const followers = captureRows(result.followers);
    const following = captureRows(result.following);
    if (!followers || !following) return result;
    receipts.set(result, freeze({
      token, accountId, username: subject, viewerKey: before.key, observedAt,
      followers, following,
      complete: { followers: result.complete?.followers === true, following: result.complete?.following === true },
    }));
    return result;
  }

  function prepareProductionInputs({ capture, profile = {} } = {}) {
    const receipt = capture && typeof capture === 'object' ? receipts.get(capture) : null;
    if (!receipt || receipt.token !== generation) return unavailable('fresh-runtime-capture-required');
    const viewer = inspect();
    if (!viewer || viewer.key !== receipt.viewerKey) return unavailable('viewer-changed-or-unavailable');
    if (profile.goal !== undefined && profile.goal !== 'maintain') return unavailable('routine-source-unavailable');
    if ((profile.accountId !== undefined && profile.accountId !== receipt.accountId)
      || (profile.username !== undefined && normalizeHandle(profile.username) !== receipt.username)) {
      return unavailable('profile-account-mismatch');
    }
    const normalized = normalizeProfile({ ...profile, accountId: receipt.accountId, username: receipt.username, goal: 'maintain' });
    const clock = now();
    const expiresAt = receipt.observedAt + Math.min(30, normalized.evidenceMaxAgeMinutes) * 60_000;
    if (!Number.isSafeInteger(clock) || clock < receipt.observedAt || clock >= expiresAt) return unavailable('capture-expired');
    const followingIds = new Map(receipt.following.accounts.map((row) => [row.id, row.username]));
    const followingNames = new Map(receipt.following.accounts.map((row) => [row.username, row.id]));
    const negativeEvidence = receipt.complete.following && receipt.following.unresolved === 0;
    let identityConflicts = 0;
    const candidates = [];
    for (const follower of receipt.followers.accounts) {
      if ((followingIds.has(follower.id) && followingIds.get(follower.id) !== follower.username)
        || (followingNames.has(follower.username) && followingNames.get(follower.username) !== follower.id)) {
        identityConflicts += 1;
        continue;
      }
      candidates.push({
        accountId: receipt.accountId, targetId: follower.id, username: follower.username,
        relation: followingIds.has(follower.id) ? 'following' : negativeEvidence ? 'not-following' : 'unknown',
        source: 'mutual-checker', followsMe: true, followsMeEvidence: 'direct',
        isPrivate: null, observedAt: receipt.observedAt, topics: [],
      });
    }
    const truncated = candidates.length > 2_000;
    return freeze({
      status: 'ready-for-review', executable: false, live: false,
      accountBinding: { accountId: receipt.accountId, username: receipt.username, basis: 'current-viewer-and-original-checker-result' },
      expiresAt,
      inputs: { profile: normalized, candidates: candidates.slice(0, 2_000), history: [], usage: {} },
      evidence: {
        followersComplete: receipt.complete.followers, followingComplete: receipt.complete.following,
        negativeFollowingEvidence: negativeEvidence, privacy: 'unavailable',
        unresolvedFollowers: receipt.followers.unresolved, unresolvedFollowing: receipt.following.unresolved,
        identityConflicts, truncated, omitted: Math.max(0, candidates.length - 2_000),
      },
    });
  }

  return Object.freeze({ captureComparison, prepareProductionInputs, invalidate() { generation += 1; } });
}

return Object.freeze({ createPresenceNativeInputs });
})();
localModules["extension/presence-native-actions.js"] = (() => {

const PROFILE_PATH = /^\/([A-Za-z0-9._]{1,30})\/?$/;
const STORY_PATH = /^\/stories\/([A-Za-z0-9._]{1,30})\/([^/?#]+)\/?/;
const CONTENT_PATH = /^\/(?:p|reel)\/([^/?#]+)\/?/;
const RESERVED = new Set(['accounts', 'about', 'api', 'direct', 'explore', 'reels', 'settings', 'stories', 'web']);

const clean = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const fail = (reason, details = {}) => Object.assign(new Error(reason), details);

function createPresenceNativeActions({
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
  const controlName = (node) => clean(node?.getAttribute?.('aria-label')
    || node?.textContent
    || node?.querySelector?.('[aria-label]')?.getAttribute?.('aria-label')
    || node?.querySelector?.('title')?.textContent);
  const exactButtons = (root, names) => [...root.querySelectorAll('button')]
    .filter(visible)
    .filter((node) => names.has(lower(controlName(node))));
  const exactControls = (root, names) => [...root.querySelectorAll('a[href],button,[role="button"]')]
    .filter(visible)
    .filter((node, index, all) => all.indexOf(node) === index)
    .filter((node) => names.has(lower(controlName(node))));
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
  const storyLoaded = (expected) => {
    const match = String(location.pathname || '').match(STORY_PATH);
    if (!match || match[1].toLocaleLowerCase() !== expected.username || match[2] !== expected.storyId) return false;
    const media = [...document.querySelectorAll('main video, main img, [role="dialog"] video, [role="dialog"] img')].filter(visible);
    const controls = exactButtons(document, new Set(['pause', 'next', 'like', 'unlike']));
    return media.length > 0 && controls.length > 0;
  };
  const waitFor = (predicate, signal) => new Promise((resolve, reject) => {
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
      try { result = predicate() === true; } catch {}
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
      ready = () => location.pathname === '/';
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
      if (current && storyLoaded({ username: current[1].toLocaleLowerCase(), storyId: current[2] })) {
        const controls = exactButtons(document, new Set(['next']));
        if (controls.length !== 1) return [];
        return [{ action, id: `story-next:${current[1].toLocaleLowerCase()}:${current[2]}`,
          label: 'Next story', target: { fromPath: String(location.pathname) },
          root: document, control: controls[0] }];
      }
      const unique = new Map();
      for (const link of [...document.querySelectorAll('a[href]')].filter(visible)) {
        const target = story(link);
        if (target && !unique.has(target.storyId)) unique.set(target.storyId, { action,
          id: `story:${target.username}:${target.storyId}`, label: `@${target.username}'s story`,
          target, root: link, control: link });
      }
      return [...unique.values()];
    }
    if (action === 'reactStories') {
      const current = String(location.pathname || '').match(STORY_PATH);
      if (!current) return [];
      const controls = exactButtons(document, new Set(['like']));
      if (controls.length !== 1) return [];
      const target = { username: current[1].toLocaleLowerCase(), storyId: current[2] };
      return [{ action, id: `story-reaction:${target.username}:${target.storyId}`,
        label: `React to @${target.username}'s story`, target, root: document, control: controls[0] }];
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
        current.control.click();
        const verified = await waitFor(() => {
          if (!current.target.fromPath) return storyLoaded(current.target);
          if (String(location.pathname) === current.target.fromPath) return false;
          const next = String(location.pathname).match(STORY_PATH);
          return Boolean(next) && storyLoaded({ username: next[1].toLocaleLowerCase(), storyId: next[2] });
        }, signal);
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

return Object.freeze({ createPresenceNativeActions });
})();
localModules["extension/presence-session.js"] = (() => {

const ACTION_ORDER = Object.freeze([
  'viewStories',
  'reactStories',
  'likePosts',
  'followPeople',
  'acceptRequests',
]);

const PRESENCE_ACTION_LABELS = Object.freeze({
  viewStories: 'View stories',
  reactStories: 'React to stories',
  likePosts: 'Like posts',
  followPeople: 'Follow people',
  acceptRequests: 'Accept incoming requests',
});

const SESSION_REVIEW_TTL_MS = 15 * 60_000;
const LIVE_REVIEW_TTL_MS = 12 * 60 * 60_000;
const MAX_ACTIONS = 50;
const MAX_LIVE_ACTIONS = 500;
const MIN_ACTIONS = 1;
const reviews = new WeakSet();
const consumed = new WeakSet();

const fail = (reason) => { throw new Error(reason); };
const text = (value) => typeof value === 'string' ? value.trim() : '';
const count = (value, fallback = 10) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= MIN_ACTIONS && number <= MAX_ACTIONS
    ? number : fallback;
};
const boundedInteger = (value, { min, max, fallback }) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};
const digest = (value) => {
  const source = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const clone = (value) => structuredClone(value);

function normalizePresenceSessionOptions(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const actions = Object.fromEntries(ACTION_ORDER.map((action) => [action, source.actions?.[action] === true]));
  if (actions.reactStories) actions.viewStories = true;
  const mode = source.mode === 'live' ? 'live' : 'session';
  return Object.freeze({
    actions: Object.freeze(actions),
    mode,
    maxActions: mode === 'live'
      ? boundedInteger(source.maxActions, { min: 1, max: MAX_LIVE_ACTIONS, fallback: 200 })
      : count(source.maxActions),
    liveDurationMinutes: boundedInteger(source.liveDurationMinutes,
      { min: 30, max: 720, fallback: 120 }),
    liveBurstActions: boundedInteger(source.liveBurstActions,
      { min: 1, max: 20, fallback: 5 }),
    quietMinutes: boundedInteger(source.quietMinutes,
      { min: 1, max: 120, fallback: 10 }),
  });
}

function createPresenceSession({
  nativeActions,
  locks = null,
  now = Date.now,
  random = Math.random,
  wait = null,
  onUpdate = () => {},
  minDelayMs = 2_000,
  maxDelayMs = 5_000,
} = {}) {
  if (typeof nativeActions?.inspectContext !== 'function'
    || typeof nativeActions?.find !== 'function'
    || typeof nativeActions?.execute !== 'function'
    || (locks !== null && typeof locks?.request !== 'function')
    || typeof now !== 'function' || typeof random !== 'function'
    || (wait !== null && typeof wait !== 'function') || typeof onUpdate !== 'function') {
    fail('presence-session-adapter-required');
  }
  if (!Number.isFinite(minDelayMs) || !Number.isFinite(maxDelayMs)
    || minDelayMs < 0 || maxDelayMs < minDelayMs || maxDelayMs > 60_000) {
    fail('presence-session-pacing-invalid');
  }

  let controller = null;
  let pauseGate = null;
  let runSequence = 0;
  let state = Object.freeze({
    status: 'idle', reason: null, accountId: null, current: null,
    completed: 0, skipped: 0, uncertain: 0, maxActions: 0,
    mode: 'session', runId: null, enabledActions: Object.freeze([]),
    results: Object.freeze([]), canPause: false,
    canResume: false, canStop: false,
  });

  const publish = (patch = {}) => {
    const nextResults = patch.results || state.results;
    state = Object.freeze({ ...state, ...patch, results: Object.freeze([...nextResults].slice(0, 50)) });
    onUpdate(snapshot());
    return state;
  };
  const snapshot = () => clone(state);
  const active = () => controller && ['running', 'waiting', 'quiet', 'paused', 'stopping'].includes(state.status);
  const context = (accountId) => {
    const value = nativeActions.inspectContext();
    if (value?.accountVerified !== true || value.usable !== true || value.accountId !== accountId
      || value.challenge || value.actionBlocked || value.rateLimited || value.sessionExpired
      || value.frozen || value.discarded) fail('presence-context-changed');
    return value;
  };
  const sleep = async (ms, signal) => {
    if (wait) return wait(ms, signal);
    const deadline = now() + ms;
    while (now() < deadline && state.status !== 'paused') {
      await new Promise((resolve, reject) => {
        let timer = null;
        const done = () => { signal?.removeEventListener?.('abort', abort); if (timer !== null) clearTimeout(timer); resolve(); };
        const abort = () => { if (timer !== null) clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
        if (signal?.aborted) return abort();
        signal?.addEventListener?.('abort', abort, { once: true });
        timer = setTimeout(done, Math.min(1_000, Math.max(0, deadline - now())));
      });
    }
  };
  const awaitResume = async (signal) => {
    while (state.status === 'paused') {
      await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Stopped', 'AbortError'));
        if (signal.aborted) return abort();
        pauseGate = () => { signal.removeEventListener('abort', abort); pauseGate = null; resolve(); };
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  };

  function createReview({ accountId, options, expiresAt } = {}) {
    const normalized = normalizePresenceSessionOptions(options);
    const enabledActions = ACTION_ORDER.filter((action) => normalized.actions[action]);
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(text(accountId))) fail('presence-account-required');
    if (!enabledActions.length) fail('presence-action-required');
    const ttl = normalized.mode === 'live'
      ? Math.min(LIVE_REVIEW_TTL_MS, normalized.liveDurationMinutes * 60_000)
      : SESSION_REVIEW_TTL_MS;
    const expiry = Math.min(Number(expiresAt) || (now() + ttl), now() + ttl);
    if (expiry <= now()) fail('presence-review-expired');
    const payload = Object.freeze({ accountId: text(accountId), options: normalized,
      enabledActions: Object.freeze(enabledActions), expiresAt: expiry });
    const review = Object.freeze({ version: 1, ...payload,
      reviewedDigest: digest({ ...payload, options: normalized }) });
    reviews.add(review);
    return review;
  }

  async function start(review) {
    if (active()) fail('presence-session-active');
    if (!review || !reviews.has(review) || consumed.has(review)) fail('presence-review-required');
    if (review.expiresAt <= now()) fail('presence-review-expired');
    if (!locks) fail('presence-account-lock-unavailable');
    const initialContext = context(review.accountId);
    const accountKey = text(initialContext.accountKey);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountKey)) fail('presence-account-lock-unavailable');
    const lockName = `insta-toolbox:account-activity:${accountKey}`;
    return locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock || lock.name !== lockName || lock.mode !== 'exclusive') fail('presence-account-busy');
      context(review.accountId);
      consumed.add(review);
      controller = new AbortController();
      const { signal } = controller;
      const results = [];
      const seen = new Set();
      const empty = new Set();
      const runId = `${now()}:${++runSequence}`;
      let resultSequence = 0;
      let cursor = 0;
      publish({
        status: 'running', reason: null, accountId: review.accountId, current: null,
        completed: 0, skipped: 0, uncertain: 0, maxActions: review.options.maxActions,
        mode: review.options.mode, runId, enabledActions: review.enabledActions,
        results, canPause: true, canResume: false, canStop: true,
      });
      try {
        while (!signal.aborted && state.completed < review.options.maxActions && now() < review.expiresAt) {
          await awaitResume(signal);
          context(review.accountId);
          const action = review.enabledActions[cursor % review.enabledActions.length];
          cursor += 1;
          let candidate;
          try {
            candidate = await nativeActions.find(action, Object.freeze({ accountId: review.accountId,
              seen: new Set(seen), signal }));
          } catch (error) {
            if (signal.aborted) throw error;
            fail(error?.message || 'presence-discovery-failed');
          }
          if (!candidate) {
            empty.add(action);
            if (empty.size === review.enabledActions.length) {
              if (review.options.mode !== 'live') break;
              empty.clear();
              publish({ status: 'quiet', current: null });
              await sleep(review.options.quietMinutes * 60_000, signal);
              await awaitResume(signal);
              if (!signal.aborted && now() < review.expiresAt) publish({ status: 'running' });
            }
            continue;
          }
          if (!text(candidate.id) || candidate.action !== action || seen.has(candidate.id)) {
            fail('presence-target-invalid');
          }
          empty.delete(action);
          const actionId = `${action}:${candidate.id}`;
          publish({ status: 'running', current: { action, id: candidate.id,
            label: text(candidate.label) || PRESENCE_ACTION_LABELS[action] } });
          const assertCurrent = () => {
            if (signal.aborted || state.status === 'paused' || now() >= review.expiresAt) {
              fail('presence-grant-revoked');
            }
            context(review.accountId);
            return true;
          };
          let outcome;
          try {
            assertCurrent();
            outcome = await nativeActions.execute(action, candidate, Object.freeze({ signal, assertCurrent, actionId }));
          } catch (error) {
            if (signal.aborted) throw error;
            outcome = { verified: false, uncertain: true, reason: error?.message || 'presence-outcome-uncertain' };
          }
          seen.add(candidate.id);
          if (outcome?.verified === true) {
            results.unshift({ action, id: candidate.id, label: text(outcome.label) || text(candidate.label),
              status: 'completed', reason: text(outcome.reason), at: now(),
              eventId: `${runId}:${++resultSequence}` });
            publish({ completed: state.completed + 1, current: null, results });
          } else if (outcome?.skipped === true && outcome?.uncertain !== true) {
            results.unshift({ action, id: candidate.id, label: text(candidate.label),
              status: 'skipped', reason: text(outcome.reason) || 'No longer available', at: now(),
              eventId: `${runId}:${++resultSequence}` });
            publish({ skipped: state.skipped + 1, current: null, results });
          } else {
            results.unshift({ action, id: candidate.id, label: text(candidate.label),
              status: 'uncertain', reason: text(outcome?.reason) || 'Check Instagram before continuing',
              at: now(), eventId: `${runId}:${++resultSequence}` });
            publish({ status: 'needs-attention', reason: text(outcome?.reason) || 'presence-outcome-uncertain',
              uncertain: state.uncertain + 1, current: null, results,
              canPause: false, canResume: false, canStop: false });
            return snapshot();
          }
          if (state.completed >= review.options.maxActions) break;
          if (review.options.mode === 'live' && state.completed > 0
            && state.completed % review.options.liveBurstActions === 0) {
            publish({ status: 'quiet', current: null });
            await sleep(review.options.quietMinutes * 60_000, signal);
            await awaitResume(signal);
            if (!signal.aborted) publish({ status: 'running' });
            continue;
          }
          const delay = Math.round(minDelayMs + random() * (maxDelayMs - minDelayMs));
          publish({ status: 'waiting', current: null });
          await sleep(delay, signal);
          if (!signal.aborted && state.status !== 'paused') publish({ status: 'running' });
        }
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const expired = now() >= review.expiresAt;
        publish({ status: expired ? 'expired' : 'completed',
          reason: expired ? 'presence-session-expired' : null, current: null,
          canPause: false, canResume: false, canStop: false });
        return snapshot();
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') {
          publish({ status: 'stopped', reason: 'presence-session-stopped', current: null,
            canPause: false, canResume: false, canStop: false });
          return snapshot();
        }
        publish({ status: 'needs-attention', reason: error?.message || 'presence-session-failed', current: null,
          canPause: false, canResume: false, canStop: false });
        return snapshot();
      } finally {
        controller = null;
        pauseGate = null;
      }
    });
  }

  return Object.freeze({
    createReview,
    start,
    snapshot,
    pause() {
      if (!controller || !['running', 'waiting', 'quiet'].includes(state.status)) return false;
      publish({ status: 'paused', canPause: false, canResume: true, canStop: true });
      return true;
    },
    resume() {
      if (!controller || state.status !== 'paused') return false;
      publish({ status: 'running', canPause: true, canResume: false, canStop: true });
      pauseGate?.();
      return true;
    },
    stop() {
      if (!controller || !active()) return false;
      publish({ status: 'stopping', canPause: false, canResume: false, canStop: false });
      controller.abort('Stopped');
      pauseGate?.();
      return true;
    },
  });
}

return Object.freeze({ PRESENCE_ACTION_LABELS, normalizePresenceSessionOptions, createPresenceSession });
})();
localModules["extension/presence-activity-log.js"] = (() => {

const VERSION = 1;
const DEFAULT_LIMIT = 500;
const OUTCOMES = new Set([
  'started', 'completed', 'skipped', 'uncertain', 'paused', 'resumed',
  'stopped', 'expired', 'needs-attention', 'quiet',
]);

const clean = (value, limit) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

const timestamp = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const at = timestamp(value.at);
  const eventId = clean(value.eventId, 160);
  const outcome = clean(value.outcome, 32);
  if (!at || !eventId || !OUTCOMES.has(outcome)) return null;
  return Object.freeze({
    eventId,
    at,
    kind: value.kind === 'action' ? 'action' : 'session',
    action: clean(value.action, 48),
    target: clean(value.target, 120),
    outcome,
    detail: clean(value.detail, 240),
  });
}

function normalizePresenceActivityLog(value, { limit = DEFAULT_LIMIT } = {}) {
  const safeLimit = Number.isInteger(limit) && limit >= 10 && limit <= 2_000
    ? limit : DEFAULT_LIMIT;
  const rows = Array.isArray(value?.entries) ? value.entries : [];
  const entries = [];
  const seen = new Set();
  for (const candidate of rows) {
    const entry = normalizeEntry(candidate);
    if (!entry || seen.has(entry.eventId)) continue;
    seen.add(entry.eventId);
    entries.push(entry);
    if (entries.length >= safeLimit) break;
  }
  return Object.freeze({ version: VERSION, entries: Object.freeze(entries) });
}

function createPresenceActivityLog({
  read = () => null,
  write = () => {},
  onWriteError = () => {},
  now = Date.now,
  limit = DEFAULT_LIMIT,
} = {}) {
  if (typeof read !== 'function' || typeof write !== 'function'
    || typeof onWriteError !== 'function' || typeof now !== 'function') {
    throw new Error('presence-log-adapter-required');
  }
  let record = normalizePresenceActivityLog(read(), { limit });
  let writeQueue = Promise.resolve();
  let latestWrite = Promise.resolve();
  const listeners = new Set();

  const snapshot = () => structuredClone(record);
  const publish = () => {
    const value = snapshot();
    for (const listener of listeners) listener(value);
    return value;
  };
  const persist = () => {
    const value = snapshot();
    latestWrite = writeQueue.then(() => write(value));
    writeQueue = latestWrite.catch((error) => {
      onWriteError(error);
    });
    return latestWrite;
  };

  function append(value = {}) {
    const at = timestamp(value.at) || timestamp(now());
    const seed = clean(value.eventId, 160)
      || `${at}:${clean(value.kind, 24)}:${clean(value.action, 48)}:${clean(value.outcome, 32)}`;
    const entry = normalizeEntry({ ...value, at, eventId: seed });
    if (!entry) throw new Error('presence-log-entry-invalid');
    if (record.entries.some(row => row.eventId === entry.eventId)) return entry;
    record = normalizePresenceActivityLog({ entries: [entry, ...record.entries] }, { limit });
    publish();
    void persist();
    return entry;
  }

  function clear() {
    record = normalizePresenceActivityLog(null, { limit });
    publish();
    void persist();
  }

  return Object.freeze({
    append,
    clear,
    snapshot,
    settled: () => latestWrite,
    exportRecord() {
      return Object.freeze({
        schemaVersion: VERSION,
        kind: 'insta-toolbox-presence-log',
        generatedAt: new Date(now()).toISOString(),
        entries: snapshot().entries,
      });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new Error('presence-log-listener-required');
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  });
}

return Object.freeze({ normalizePresenceActivityLog, createPresenceActivityLog });
})();
localModules["extension/presence-session-panel.js"] = (() => {
const { PRESENCE_ACTION_LABELS, normalizePresenceSessionOptions } = localModules["extension/presence-session.js"];
const { createPresenceActivityLog } = localModules["extension/presence-activity-log.js"];


const ACTIONS = Object.freeze([
  ['viewStories', 'View stories'],
  ['reactStories', 'React to stories'],
  ['likePosts', 'Like posts'],
  ['followPeople', 'Follow people'],
  ['acceptRequests', 'Accept incoming requests'],
]);

const clean = (value) => String(value ?? '').trim();

function mountPresenceSessionPanel({
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
    .presence-session .presence-live-options{display:grid;grid-column:1/-1;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:12px;border:1px solid var(--insta-toolbox-line);border-radius:10px;background:var(--insta-toolbox-bg-sunken)}
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
  liveOptions.append(durationLabel, burstLabel, quietLabel);
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
      maxActions: mode.value === 'live' ? 200 : maxActions,
      liveDurationMinutes: Number(duration.value),
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
    burst.value = String(saved.liveBurstActions);
    quiet.value = String(saved.quietMinutes);
  }
  function describe(snapshot) {
    const count = Number(snapshot.completed || 0);
    if (snapshot.status === 'idle') return ['Ready', 'Nothing happens until you confirm.'];
    if (snapshot.status === 'running') return [snapshot.current?.label || 'Presence is running', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'waiting') return ['Taking a short pause', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'quiet') return ['Resting', `${count} verified action${count === 1 ? '' : 's'}. Presence will continue in this loaded tab.`];
    if (snapshot.status === 'paused') return ['Paused', `${count} verified action${count === 1 ? '' : 's'}. Resume or stop when ready.`];
    if (snapshot.status === 'stopping') return ['Stopping', 'No new action will begin.'];
    if (snapshot.status === 'stopped') return ['Stopped', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'completed') return ['Presence finished', `${count} verified action${count === 1 ? '' : 's'}.`];
    if (snapshot.status === 'expired') return ['Time limit reached', `${count} verified action${count === 1 ? '' : 's'}. Start again to continue.`];
    return ['Needs attention', clean(snapshot.reason) || 'Check Instagram before starting again.'];
  }
  function render(snapshot = session.snapshot()) {
    if (disposed) return;
    const [title, detail] = describe(snapshot);
    const active = ['running', 'waiting', 'quiet', 'paused', 'stopping'].includes(snapshot.status);
    intro.hidden = active;
    options.hidden = active;
    runGrid.hidden = active;
    limitLabel.hidden = mode.value === 'live';
    liveOptions.hidden = mode.value !== 'live';
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
      if (!entry.eventId) continue;
      appendLog({ eventId: entry.eventId, at: entry.at, kind: 'action', action: entry.action,
        target: entry.label, outcome: entry.status, detail: entry.reason });
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
        { label: 'Maximum', value: String(options.maxActions) },
        ...(options.mode === 'live' ? [
          { label: 'Rhythm', value: `${options.liveBurstActions} actions, then ${options.quietMinutes} minutes quiet` },
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
  for (const input of [mode, duration, burst, quiet]) listen(input, 'change', () => { save(); render(); });
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
    busy: () => ['running', 'waiting', 'quiet', 'paused', 'stopping'].includes(session.snapshot().status),
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

return Object.freeze({ mountPresenceSessionPanel });
})();
globalThis.InstaToolboxInboxDiscovery = Object.freeze({ create: localModules['extension/inbox-userscript-discovery.js'].createUserscriptInboxDiscovery });
globalThis.InstaToolboxInboxPanel = Object.freeze({ mount: localModules['extension/inbox-userscript-panel.js'].mountUserscriptInboxPanel });
globalThis.InstaToolboxInboxCheckpoints = Object.freeze({ create: localModules['extension/inbox-checkpoint-store.js'].createInboxCheckpointStore });
globalThis.InstaToolboxPresenceInputs = Object.freeze({ create: localModules['extension/presence-native-inputs.js'].createPresenceNativeInputs });
globalThis.InstaToolboxPresenceNativeActions = Object.freeze({ create: localModules['extension/presence-native-actions.js'].createPresenceNativeActions });
globalThis.InstaToolboxPresenceSession = Object.freeze({ create: localModules['extension/presence-session.js'].createPresenceSession });
globalThis.InstaToolboxPresenceSessionPanel = Object.freeze({ mount: localModules['extension/presence-session-panel.js'].mountPresenceSessionPanel });
(async () => {
  'use strict';

  const EXTENSION_ROOT_ID = 'insta-toolbox-sidecar-root';
  const ROOT_ID = 'insta-toolbox-userscript-root';
  const STATE_KEY = 'instaToolboxUserscriptStateV2';
  const PREFERENCES_KEY = 'instaToolboxUserscriptPreferencesV1';
  const cleanupSettings = globalThis.InstaToolboxCleanupSettings;
  const LEGACY_QUEUE_KEY = 'instaToolboxManualQueueV1';
  const TAB_RUN_FIELD = 'instaToolboxAccountRunV1';
  const TAB_CHECKER_FIELD = 'instaToolboxCheckerDraftV1';
  const ACTIONABLE_STATUSES = new Set(['pending', 'ready', 'failed', 'paused']);
  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'legal', 'privacy', 'reels', 'settings', 'stories', 'terms', 'web',
  ]);
  const VIEWS = ['checker', 'account', 'messages'];
  const ACCENTS = new Set(['rose', 'violet', 'blue']);
  const BLURS = new Set(['none', 'soft', 'strong']);
  const LAUNCHER_SIZES = new Set(['standard', 'large']);
  const WIDTH_MIN = 320;
  const WIDTH_MAX = 560;
  const HEIGHT_MIN = 320;
  const HEIGHT_MAX = 1_100;
  const INSET = 8;
  const RUN_CAPABILITY_MS = 20 * 60 * 1_000;
  const DM_PLAN_CAPABILITY_MS = 15 * 60 * 1_000;
  const CAPTURE_ACCOUNT_SOURCES = new Set([
    'authenticated-instagram-web',
    'extension-scrolled-dom',
    'extension-visible-dom',
    'tampermonkey-visible-dom',
  ]);

  if (document.getElementById(EXTENSION_ROOT_ID) || document.getElementById(ROOT_ID)) {
    bootstrapClaim.remove();
    return;
  }

  const normalizeUsername = (value) => {
    const username = String(value || '')
      .replace(/^https?:\/\/www\.instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/^\/+/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();
    return /^[a-z0-9._]{1,30}$/i.test(username) && !RESERVED.has(username) ? username : '';
  };

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
  const safeText = (value, fallback = '') => (String(value ?? '').trim() || fallback).slice(0, 500);
  const nowIso = () => new Date().toISOString();
  const formatCount = (value) => Number(value || 0).toLocaleString('en-US');

  function accountCapabilityDigest(action, usernames) {
    const source = JSON.stringify({
      action,
      usernames: (usernames || []).map(normalizeUsername).filter(Boolean),
    });
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function visibleText(element) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return safeText(element.textContent || element.getAttribute?.('aria-label'));
  }

  function normalizeObservedInstagramId(value) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return '';
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const id = String(value).trim();
    return /^[1-9]\d{0,29}$/.test(id) ? id : '';
  }

  function captureIdentityMetadata(candidate, previous) {
    const observed = normalizeObservedInstagramId(candidate?.instagramId);
    const prior = normalizeObservedInstagramId(previous?.instagramId);
    if (candidate?.instagramIdAmbiguous === true || previous?.instagramIdAmbiguous === true
      || (observed && prior && observed !== prior)) return { instagramIdAmbiguous: true };
    return observed || prior ? { instagramId: observed || prior } : {};
  }

  function normalizeAccounts(value) {
    const accounts = new Map();
    for (const candidate of (Array.isArray(value) ? value : []).slice(0, 25_000)) {
      const username = normalizeUsername(candidate?.username || candidate?.profileUrl || candidate);
      if (!username) continue;
      accounts.set(username, {
        username,
        ...captureIdentityMetadata(candidate, accounts.get(username)),
        profileUrl: `https://www.instagram.com/${username}/`,
        displayName: safeText(candidate?.displayName),
        source: CAPTURE_ACCOUNT_SOURCES.has(candidate?.source)
          ? candidate.source
          : 'tampermonkey-visible-dom',
      });
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function normalizeQueue(value) {
    const queue = [];
    for (const [index, item] of (Array.isArray(value?.queue) ? value.queue : []).slice(0, 2_000).entries()) {
      const username = normalizeUsername(item?.account?.username || item?.username);
      if (!username) continue;
      queue.push({
        id: safeText(item?.id, `userscript-${index}-${username}`),
        account: { username, displayName: safeText(item?.account?.displayName) },
        action: ['follow', 'unfollow'].includes(item?.action) ? item.action : 'review',
        status: ACTIONABLE_STATUSES.has(item?.status) ? item.status : safeText(item?.status, 'pending'),
        reason: safeText(item?.reason, 'manual review'),
        companionUpdatedAt: safeText(item?.companionUpdatedAt),
      });
    }
    return { queue, importedAt: safeText(value?.importedAt || value?.exportedAt) || null };
  }

  function stateDefaults() {
    return {
      schemaVersion: 6,
      capture: {
        subjectUsername: '',
        followers: [],
        following: [],
        capturedAt: { followers: null, following: null },
        complete: { followers: false, following: false },
        verified: { followers: false, following: false },
        source: { followers: '', following: '' },
      },
      queue: { queue: [], importedAt: null },
      accountCheck: null,
      messageEvidence: null,
      dmTarget: null,
      dmCheck: null,
      history: [],
      sentDms: [],
      sentDmsComplete: false,
      sentDmsChecked: false,
      limits: {
        minDelayMs: 1_000,
        maxDelayMs: 2_000,
      },
      ledger: { day: null, actions: 0, unsends: 0 },
      run: null,
      introDone: false,
    };
  }

  function preferencesDefaults() {
    return {
      schemaVersion: 3,
      open: true,
      view: 'checker',
      position: null,
      launcherPosition: null,
      width: 390,
      height: 620,
      opacity: 0.88,
      accent: 'rose',
      blur: 'soft',
      launcherSize: 'standard',
      theme: 'auto',
      density: 'comfortable',
    };
  }

  function normalizeResumableAccountRun(value) {
    if (!value || value.kind !== 'account' || value.status !== 'running') return null;
    const capabilityExpiresAt = Math.min(
      Number(value.capabilityExpiresAt) || 0,
      Date.now() + RUN_CAPABILITY_MS,
    );
    const queue = [...new Set((Array.isArray(value.queue) ? value.queue : [])
      .map(normalizeUsername)
      .filter(Boolean))].slice(0, 250);
    if (!queue.length || capabilityExpiresAt <= Date.now()) return null;
    const action = value.action === 'follow' ? 'follow' : value.action === 'unfollow' ? 'unfollow' : '';
    if (!action) return null;
    const approvedTargets = [...new Set((Array.isArray(value.approvedTargets) ? value.approvedTargets : [])
      .map(normalizeUsername)
      .filter(Boolean))].slice(0, 250);
    const capabilityId = safeText(value.capabilityId);
    if (!capabilityId
      || !approvedTargets.length
      || queue.some((username) => !approvedTargets.includes(username))
      || safeText(value.capabilityDigest) !== accountCapabilityDigest(action, approvedTargets)) return null;
    const boundedCount = (candidate) => Math.max(0, Math.min(250, Math.round(Number(candidate) || 0)));
    return {
      status: 'running',
      kind: 'account',
      action,
      queue,
      total: Math.max(queue.length, boundedCount(value.total)),
      completed: boundedCount(value.completed),
      skipped: boundedCount(value.skipped),
      failed: boundedCount(value.failed),
      current: safeText(value.current),
      stopReason: null,
      approvedTargets,
      capabilityDigest: accountCapabilityDigest(action, approvedTargets),
      capabilityExpiresAt,
      capabilityId,
      nextAt: Number(value.nextAt) > Date.now() ? Number(value.nextAt) : null,
      results: (Array.isArray(value.results) ? value.results : []).slice(0, 40).map((item) => ({
        label: safeText(item?.label),
        status: safeText(item?.status),
        reason: safeText(item?.reason),
      })),
    };
  }

  function readManagerTab() {
    if (typeof GM_getTab !== 'function' || typeof GM_saveTab !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(value && typeof value === 'object' ? value : null);
      };
      timer = setTimeout(() => finish(null), 1_000);
      try {
        const pending = GM_getTab(finish);
        if (pending && typeof pending.then === 'function') pending.then(finish, () => finish(null));
      } catch {
        finish(null);
      }
    });
  }

  function loadState(tabState) {
    const source = GM_getValue(STATE_KEY, null);
    const defaults = stateDefaults();
    const legacyQueue = GM_getValue(LEGACY_QUEUE_KEY, null);
    const sharedState = source && typeof source === 'object' ? source : defaults;
    const checkerDraft = tabState?.[TAB_CHECKER_FIELD];
    // A new tab starts empty. The old shared capture remains untouched; it is
    // never imported implicitly into another tab.
    const value = {
      ...sharedState,
      schemaVersion: checkerDraft?.schemaVersion || 6,
      capture: checkerDraft?.capture && typeof checkerDraft.capture === 'object'
        ? checkerDraft.capture : defaults.capture,
    };
    // Schema 4 is the first state whose capture completeness is reconciled
    // against an exact list read. Schema 5 records whether that read used
    // bounded authenticated pagination or the list-dialog fallback. Schema 6
    // requires a fresh DOM scan with an exact total, preserving the saved rows.
    const requiresCountReconciledRescan = Number(value.schemaVersion) < 4;
    return {
      schemaVersion: 6,
      capture: {
        subjectUsername: normalizeUsername(value.capture?.subjectUsername),
        ...(normalizeObservedInstagramId(value.capture?.subjectInstagramId)
          ? { subjectInstagramId: normalizeObservedInstagramId(value.capture.subjectInstagramId) } : {}),
        followers: normalizeAccounts(value.capture?.followers),
        following: normalizeAccounts(value.capture?.following),
        capturedAt: {
          followers: safeText(value.capture?.capturedAt?.followers) || null,
          following: safeText(value.capture?.capturedAt?.following) || null,
        },
        complete: {
          followers: !requiresCountReconciledRescan
            && (Number(value.schemaVersion) >= 6 || value.capture?.source?.followers === 'authenticated-web')
            && value.capture?.verified?.followers === true
            && value.capture?.complete?.followers === true,
          following: !requiresCountReconciledRescan
            && (Number(value.schemaVersion) >= 6 || value.capture?.source?.following === 'authenticated-web')
            && value.capture?.verified?.following === true
            && value.capture?.complete?.following === true,
        },
        verified: {
          followers: !requiresCountReconciledRescan && value.capture?.verified?.followers === true,
          following: !requiresCountReconciledRescan && value.capture?.verified?.following === true,
        },
        source: {
          followers: ['authenticated-web', 'list-dialog'].includes(value.capture?.source?.followers)
            ? value.capture.source.followers
            : '',
          following: ['authenticated-web', 'list-dialog'].includes(value.capture?.source?.following)
            ? value.capture.source.following
            : '',
        },
        ...globalThis.InstaToolboxInstagramInspector.normalizeFollowerDiagnostics(value.capture),
      },
      queue: normalizeQueue(value.queue?.queue?.length ? value.queue : legacyQueue),
      accountCheck: value.accountCheck && typeof value.accountCheck === 'object' ? value.accountCheck : null,
      messageEvidence: value.messageEvidence && typeof value.messageEvidence === 'object' ? value.messageEvidence : null,
      dmTarget: value.dmTarget && typeof value.dmTarget === 'object' ? value.dmTarget : null,
      dmCheck: value.dmCheck && typeof value.dmCheck === 'object' ? value.dmCheck : null,
      history: Array.isArray(value.history) ? value.history.slice(0, 20) : [],
      sentDms: Array.isArray(value.sentDms) ? value.sentDms.slice(0, 500) : [],
      sentDmsComplete: value.sentDmsComplete === true,
      sentDmsChecked: value.sentDmsChecked === true,
      introDone: value.introDone === true,
      limits: { ...defaults.limits, ...(value.limits && typeof value.limits === 'object' ? value.limits : {}) },
      ledger: value.ledger && typeof value.ledger === 'object' ? value.ledger : defaults.ledger,
      // Only an account run survives a reload, because navigating between
      // profiles is how it advances and every target is re-resolved on arrival.
      // A DM run is dropped: it drives one open conversation, so after a reload
      // the thread it was working in is gone.
      run: normalizeResumableAccountRun(tabState?.[TAB_RUN_FIELD]),
    };
  }

  function normalizePreferences(value) {
    const source = value && typeof value === 'object' ? value : {};
    // Version 1 shipped at 94% opacity even though the extension and the
    // documented design system use 88%. Migrate only that old default; every
    // other saved opacity remains an explicit user choice.
    const opacity = source.schemaVersion === 1 && Number(source.opacity) === 0.94
      ? 0.88
      : source.opacity;
    const position = source.position && Number.isFinite(Number(source.position.x))
      && Number.isFinite(Number(source.position.y))
      ? { x: Math.max(0, Math.round(source.position.x)), y: Math.max(0, Math.round(source.position.y)) }
      : null;
    const launcherPosition = source.launcherPosition
      && Number.isFinite(Number(source.launcherPosition.x))
      && Number.isFinite(Number(source.launcherPosition.y))
      ? {
        x: Math.max(0, Math.round(source.launcherPosition.x)),
        y: Math.max(0, Math.round(source.launcherPosition.y)),
      }
      : null;
    return {
      schemaVersion: 3,
      open: typeof source.open === 'boolean' ? source.open : true,
      view: VIEWS.includes(source.view) ? source.view : 'checker',
      position,
      launcherPosition,
      width: Math.round(clamp(source.width || 390, WIDTH_MIN, WIDTH_MAX)),
      height: Math.round(clamp(source.height || 620, HEIGHT_MIN, HEIGHT_MAX)),
      opacity: Math.round(clamp(opacity ?? 0.88, 0.55, 1) * 100) / 100,
      accent: ACCENTS.has(source.accent) ? source.accent : 'rose',
      blur: BLURS.has(source.blur) ? source.blur : 'soft',
      launcherSize: LAUNCHER_SIZES.has(source.launcherSize)
        ? source.launcherSize
        : 'standard',
      ...cleanupSettings.normalizeAppearance({ ...source, opacity }),
    };
  }

  let managerTab = await readManagerTab();
  if (document.getElementById(EXTENSION_ROOT_ID) || document.getElementById(ROOT_ID)) {
    bootstrapClaim.remove();
    return;
  }
  const managerTabStorageAvailable = managerTab !== null;
  let state = loadState(managerTab);
  let preferences = normalizePreferences(GM_getValue(PREFERENCES_KEY, preferencesDefaults()));
  let cleanupPreferences = cleanupSettings.normalize(GM_getValue(cleanupSettings.STORAGE_KEY, null));
  let lastFocusedElement = null;
  const CHECKER_RESULTS_PAGE_SIZE = 25;
  const CHECKER_CATEGORY_KEYS = Object.freeze({
    'not-following-me-back': 'notFollowingMeBack',
    'i-do-not-follow-back': 'iDoNotFollowBack',
    mutuals: 'mutuals',
  });
  let checkerResultLimit = CHECKER_RESULTS_PAGE_SIZE;
  let checkerResultKey = '';
  let checkerResultAnnouncement = '';
  let checkerResultAnnouncementTimer = null;

  function saveState() {
    const { capture, ...sharedState } = state;
    const previous = GM_getValue(STATE_KEY, null);
    // Preserve any legacy shared capture without overwriting it from this tab.
    GM_setValue(STATE_KEY, { ...(previous && typeof previous === 'object' ? previous : {}), ...sharedState, run: null });
    if (!managerTabStorageAvailable) return;
    const resumable = normalizeResumableAccountRun(state.run);
    managerTab = { ...managerTab };
    managerTab[TAB_CHECKER_FIELD] = { schemaVersion: 6, capture };
    if (resumable) managerTab[TAB_RUN_FIELD] = resumable;
    else delete managerTab[TAB_RUN_FIELD];
    try {
      GM_saveTab(managerTab);
    } catch {
      // If the manager cannot persist tab state, the run will stop safely on
      // navigation instead of leaking authority into userscript-wide storage.
    }
  }

  function savePreferences(patch) {
    preferences = normalizePreferences({ ...preferences, ...patch });
    GM_setValue(PREFERENCES_KEY, preferences);
    applyLayout();
    renderShellState();
  }

  function currentQueueItem() {
    return state.queue.queue.find((item) => ACTIONABLE_STATUSES.has(item.status)) || null;
  }

  function verifiedCapture(listType) {
    return state.capture.verified?.[listType] === true ? state.capture[listType] : [];
  }

  function completeCapture(listType) {
    return state.capture.verified?.[listType] === true
      && state.capture.complete?.[listType] === true
      ? state.capture[listType]
      : [];
  }

  function compareCapture({ allowPartial = false } = {}) {
    if (!allowPartial && !comparisonIsReady()) return { mutuals: [], iDoNotFollowBack: [], notFollowingMeBack: [] };
    const followers = allowPartial ? state.capture.followers : verifiedCapture('followers');
    const following = allowPartial ? state.capture.following : verifiedCapture('following');
    const followerNames = new Set(followers.map((account) => account.username));
    const followingNames = new Set(following.map((account) => account.username));
    return {
      mutuals: following.filter((account) => followerNames.has(account.username)),
      iDoNotFollowBack: followers.filter((account) => !followingNames.has(account.username)),
      notFollowingMeBack: following.filter((account) => !followerNames.has(account.username)),
    };
  }

  function comparisonIsReady() {
    return ['followers', 'following'].every((type) => (
      state.capture.verified?.[type] === true && state.capture.complete?.[type] === true
    ));
  }

  function comparisonBrowserSelection(comparison) {
    const categoryControl = query('[data-role="comparison-category"]');
    const searchControl = query('[data-role="result-filter"]');
    const category = Object.hasOwn(CHECKER_CATEGORY_KEYS, categoryControl?.value)
      ? categoryControl.value
      : 'not-following-me-back';
    const search = safeText(searchControl?.value).replace(/^@+/, '').toLocaleLowerCase();
    const source = Array.isArray(comparison?.[CHECKER_CATEGORY_KEYS[category]])
      ? comparison[CHECKER_CATEGORY_KEYS[category]]
      : [];
    const matches = search
      ? source.filter((account) => (
        safeText(account?.username).toLocaleLowerCase().includes(search)
        || safeText(account?.displayName).toLocaleLowerCase().includes(search)
      ))
      : source;
    const viewKey = [
      category,
      search,
      state.capture.capturedAt?.followers || '',
      state.capture.capturedAt?.following || '',
    ].join('|');
    if (checkerResultKey !== viewKey) {
      checkerResultKey = viewKey;
      checkerResultLimit = CHECKER_RESULTS_PAGE_SIZE;
    }
    return {
      accounts: matches.slice(0, checkerResultLimit),
      category,
      total: matches.length,
    };
  }

  function captureVisibleAccounts(expectedListType = '') {
    const listContext = openFollowerListContext();
    if (!listContext || listContext.listType !== expectedListType) return [];
    const roots = [listContext.dialog];
    const accounts = new Map();
    for (const root of roots) {
      for (const anchor of root.querySelectorAll('a[href^="/"]')) {
        const username = normalizeUsername(anchor.getAttribute('href'));
        if (!username) continue;
        accounts.set(username, {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          displayName: visibleText(anchor) === username ? '' : visibleText(anchor),
          source: 'tampermonkey-visible-dom',
        });
      }
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function inspectProfile() {
    const username = normalizeUsername(location.pathname);
    if (!username) return { ok: false, reason: 'Open an Instagram profile first.' };
    const headers = [...document.querySelectorAll('main header')].filter((header) => (
      visibleText(header)
      && [...header.querySelectorAll('a[href], h1, h2, [role="heading"]')].some((element) => (
        normalizeUsername(element.getAttribute?.('href')) === username
        || normalizeUsername(visibleText(element)) === username
      ))
    ));
    if (headers.length !== 1) return { ok: false, username, reason: 'Exact profile header is ambiguous.' };
    const labels = new Map([
      ['follow', 'not-following'],
      ['following', 'following'],
      ['requested', 'requested'],
    ]);
    const controls = [...headers[0].querySelectorAll('button, [role="button"]')]
      .map((element) => ({ element, label: visibleText(element).normalize('NFKC').toLocaleLowerCase() }))
      .filter(({ label }) => labels.has(label));
    if (controls.length !== 1) {
      return { ok: false, username, reason: 'Exact relationship control is unavailable or ambiguous.' };
    }
    return {
      ok: true,
      username,
      relationship: labels.get(controls[0].label),
      observedLabel: controls[0].label,
      checkedAt: nowIso(),
      noClick: true,
    };
  }

  function inspectAccountQueueItem() {
    const item = currentQueueItem();
    const observation = inspectProfile();
    const expectedRelationship = item?.action === 'follow' ? 'not-following' : 'following';
    const exact = item
      ? Boolean(
        observation.ok
        && observation.username === item.account.username
        && observation.relationship === expectedRelationship
      )
      : observation.ok === true;
    state.accountCheck = {
      checkedAt: nowIso(),
      exact,
      noClick: true,
      target: item?.account?.username || observation.username || null,
      action: item?.action || null,
      observation,
      result: item
        ? exact
          ? `Resolved ${item.action} for @${item.account.username} without clicking.`
          : observation.reason || `Open @${item.account.username} on the expected relationship state.`
        : observation.ok
          ? `Observed @${observation.username} as ${observation.relationship.replace('-', ' ')} without clicking.`
          : observation.reason || 'Open an Instagram profile first.',
    };
    state.history.unshift({ kind: 'account-dry-run', ...state.accountCheck });
    state.history = state.history.slice(0, 20);
    saveState();
  }

  function inspectVisibleMessages() {
    const threadId = currentDirectThreadId();
    if (!threadId) {
      return {
        capturedAt: nowIso(),
        threadId: '',
        fragments: [],
        reason: 'Open an Instagram conversation first.',
      };
    }
    const main = document.querySelector('main');
    const nodes = [...(main?.querySelectorAll?.('[role="row"] [dir="auto"]') || [])];
    const candidates = (nodes.length ? nodes : [...(main?.querySelectorAll?.('div[dir="auto"]') || [])])
      .filter((element) => !element.querySelector?.('[dir="auto"]'))
      .filter((element) => !element.closest?.('header, nav, button, [role="button"], a'))
      .map(visibleText)
      .filter(Boolean);
    return {
      capturedAt: nowIso(),
      threadId,
      fragments: [...new Set(candidates)].slice(-30).map((text, index) => ({ index, text })),
      reason: candidates.length ? 'Visible text evidence only; sender ownership is unknown.' : 'No visible message text was resolved.',
    };
  }

  function fnvDigest(value) {
    let hash = 0x811c9dc5;
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function directThreadId(value) {
    const text = String(value || '').replaceAll('\\', '/');
    const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
    if (directMatch) return directMatch[1];
    const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
    const exportMatch = finalSegment.match(/_([0-9]+)$/);
    return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
  }

  function currentDirectThreadId() {
    const pathname = String(location.pathname || '').replaceAll('\\', '/');
    if (/^\/direct\/t\/[^/?#]+\/?$/i.test(pathname)) return directThreadId(pathname);
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rectangle = element.getBoundingClientRect?.();
      return !rectangle || (rectangle.width > 0 && rectangle.height > 0);
    };
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(visible);
    if (roots.length !== 1) return null;
    const links = [...document.querySelectorAll("a[href*='/direct/t/']")].filter(visible);
    if (links.length !== 1) return null;
    return directThreadId(links[0].getAttribute?.('href'));
  }

  function sentMessagesForThread(messages, threadId = currentDirectThreadId()) {
    if (!threadId) return [];
    return (Array.isArray(messages) ? messages : [])
      .filter((message) => directThreadId(message?.conversationId) === threadId);
  }

  function inspectExactDmTarget() {
    const threadId = currentDirectThreadId();
    const item = state.dmTarget;
    if (!item) {
      return {
        exact: false,
        reason: 'Import one reviewed DM job first.',
        noClick: true,
        threadId: threadId || '',
      };
    }
    const expectedThread = directThreadId(item.conversationId);
    if (!threadId || !expectedThread || expectedThread !== threadId) {
      return {
        exact: false,
        reason: 'Wrong or unresolved conversation.',
        noClick: true,
        threadId: threadId || '',
      };
    }
    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]') || document.querySelector('main');
    const candidates = [...(scope?.querySelectorAll?.('[data-message-id], [data-item-id]') || [])]
      .map((identity) => {
        const row = identity.closest?.('[role="row"], [role="listitem"]') || identity;
        const messageId = safeText(identity.getAttribute('data-message-id') || identity.getAttribute('data-item-id'));
        const timestamp = Number(identity.getAttribute('data-timestamp-ms') || row.getAttribute?.('data-timestamp-ms'));
        const content = [...row.querySelectorAll('[data-insta-toolbox-message-content], [dir="auto"]')]
          .filter((element) => !element.querySelector?.('[dir="auto"]'))
          .map(visibleText)
          .find((text) => fnvDigest(text) === item.contentDigest);
        const sentByMe = String(row.getAttribute?.('data-sent-by-me')).toLowerCase() === 'true';
        return { messageId, timestamp, content, sentByMe };
      })
      .filter((candidate) => (
        candidate.messageId === item.messageId
        && candidate.timestamp === Number(item.timestamp)
        && candidate.content
        && candidate.sentByMe
      ));
    return candidates.length === 1
      ? {
        exact: true,
        reason: 'One exact sent-message identity resolved without opening a menu.',
        noClick: true,
        checkedAt: nowIso(),
        threadId,
      }
      : {
        exact: false,
        reason: candidates.length ? 'Exact message identity is ambiguous.' : 'Exact sent-message identity is unavailable.',
        noClick: true,
        checkedAt: nowIso(),
        threadId,
      };
  }

  function downloadJson(filename, payload) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function downloadText(filename, contents) {
    const url = URL.createObjectURL(new Blob([String(contents)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const sharedTokenCss = globalThis.InstaToolboxTokens?.css({ density: 'compact' }) || '';
  const host = document.createElement('div');
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      ${sharedTokenCss}
      :host { all: initial; --insta-toolbox-alpha: 88%; --insta-toolbox-alpha-strong: 96%; --insta-toolbox-width: 390px; --insta-toolbox-height: 620px; --insta-toolbox-backdrop-blur: 10px; --insta-toolbox-launcher-size: 46px; color-scheme: light dark; color: var(--insta-toolbox-text, #1b211c); font-family: var(--insta-toolbox-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      :host([data-accent="violet"]) { --insta-toolbox-accent: var(--insta-toolbox-accent-violet); --insta-toolbox-focus: var(--insta-toolbox-accent-violet); }
      :host([data-accent="blue"]) { --insta-toolbox-accent: var(--insta-toolbox-accent-blue); --insta-toolbox-focus: var(--insta-toolbox-accent-blue); }
      :host([data-blur="none"]) { --insta-toolbox-backdrop-blur: 0px; }
      :host([data-blur="strong"]) { --insta-toolbox-backdrop-blur: 18px; }
      :host([data-launcher-size="large"]) { --insta-toolbox-launcher-size: 54px; }
      :host([data-density="comfortable"]) { --insta-toolbox-pad-y:12px; --insta-toolbox-pad-x:16px; --insta-toolbox-gap:12px; }
      :host([data-density="compact"]) { --insta-toolbox-pad-y:8px; --insta-toolbox-pad-x:12px; --insta-toolbox-gap:8px; }
      :host([data-density="comfortable"]) .card { padding:16px; }
      :host([data-density="compact"]) .card { padding:12px; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, select { font: inherit; }
      button, label, summary { cursor: pointer; }
      [hidden] { display: none !important; }
      .launcher { position: fixed; z-index: 2147482900; right: 16px; bottom: 16px; width: var(--insta-toolbox-launcher-size); height: var(--insta-toolbox-launcher-size); border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: 14px; background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha), transparent); color: var(--insta-toolbox-text, #172018); box-shadow: var(--insta-toolbox-shadow-popover, 0 10px 32px rgba(0,0,0,.2)); font-weight: 850; cursor: grab; touch-action: none; }
      :host([data-launcher-floating="true"]) .launcher { top: var(--insta-toolbox-launcher-top); right: auto; bottom: auto; left: var(--insta-toolbox-launcher-left); }
      :host([data-layout-interaction="launcher"]) .launcher { cursor: grabbing; }
      .panel { animation: insta-toolbox-in var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease) both; position: fixed; z-index: 2147482900; top: 62px; right: 16px; width: min(var(--insta-toolbox-width), calc(100vw - 24px)); height: min(var(--insta-toolbox-height), calc(100dvh - 74px)); display: flex; flex-direction: column; overflow: hidden; container-type: inline-size; border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: var(--insta-toolbox-radius-lg, 14px); background: color-mix(in srgb, var(--insta-toolbox-bg, #f7f8f5) var(--insta-toolbox-alpha), transparent); color: var(--insta-toolbox-text, #1b211c); box-shadow: var(--insta-toolbox-shadow-panel, 0 20px 60px rgba(0,0,0,.24)); backdrop-filter: blur(var(--insta-toolbox-backdrop-blur)) saturate(.95); -webkit-backdrop-filter: blur(var(--insta-toolbox-backdrop-blur)) saturate(.95); font: var(--insta-toolbox-text-md, 14px)/var(--insta-toolbox-leading-md, 20px) var(--insta-toolbox-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      :host([data-floating="true"]) .panel { top: var(--insta-toolbox-top); right: auto; left: var(--insta-toolbox-left); }
      .header { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 4px; align-items: center; height: 52px; min-height: 52px; padding: 4px 6px; border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .handle, .icon { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 9px; background: transparent; color: inherit; }
      .handle { cursor: grab; touch-action: none; font-size: 20px; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; }
      .handle:hover { background: color-mix(in srgb, var(--insta-toolbox-text, #000) 8%, transparent); }
      .handle:active { cursor: grabbing; background: color-mix(in srgb, var(--insta-toolbox-text, #000) 14%, transparent); }
      /* The whole header bar drags, so the grip is a hint rather than the only target. */
      .header { cursor: grab; }
      .header:active { cursor: grabbing; }
      .header button, .header select, .header summary, .header input { cursor: default; }
      .header h1 { margin: 0; min-width: 0; overflow-wrap: normal; word-break: keep-all; font-size: 16px; line-height: 1.15; white-space: nowrap; }
      .tabs { display: grid; grid-template-columns: repeat(3,minmax(44px,1fr)); border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg-sunken, #eef1ec) var(--insta-toolbox-alpha-strong), transparent); }
      .tab { position: relative; transition: background var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease), color var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease); min-height: 48px; border: 0; border-bottom: 3px solid transparent; padding: 6px 3px; background: transparent; color: var(--insta-toolbox-text-muted, #616a61); font-size: 11px; font-weight: 700; }
      .tab[aria-selected="true"] { border-bottom-color: var(--insta-toolbox-accent, #b83d67); color: var(--insta-toolbox-text, #172018); background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) 72%, transparent); }
      .scroll { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
      .view { padding: 16px; }
      .lead { margin: 0 0 12px; color: var(--insta-toolbox-text-muted, #606960); font-size: 12px; }
      .card { margin-bottom: 10px; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .card h2, .card h3 { margin: 0 0 6px; font-size: 15px; }
      .card p { margin: 4px 0 0; color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; overflow-wrap: break-word; word-break: normal; }
      .card > strong, .card > span { display: block; }
      .card > strong + span { margin-top: 4px; }
      .metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 10px 0; }
      .metric { border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 9px; padding: 10px; background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .metric span, .metric strong { display: block; }
      .metric span { color: var(--insta-toolbox-text-muted, #687068); font-size: 11px; }
      .metric strong { margin-top: 2px; font-size: 21px; }
      .field { display: grid; gap: 8px; margin: 16px 0; }
      .field label { color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; }
      select, input[type="range"] { width: 100%; }
      select { min-height: 44px; border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: 8px; padding: 8px; background: var(--insta-toolbox-bg, #fff); color: var(--insta-toolbox-text, #1b211c); }
      select option { background: var(--insta-toolbox-bg, #fff); color: var(--insta-toolbox-text, #1b211c); }
      input, textarea { background: var(--insta-toolbox-bg, #fff); color: var(--insta-toolbox-text, #1b211c); border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: 8px; padding: 8px; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
      .button, .file { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--insta-toolbox-line, #243027); border-radius: 8px; padding: 8px 11px; background: var(--insta-toolbox-bg-sunken, #26362a); color: var(--insta-toolbox-text, #1b211c); font-weight: 720; text-decoration: none; }
      .button.quiet, .file.quiet { border-color: var(--insta-toolbox-line, #cfd5cc); background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) 72%, transparent); color: var(--insta-toolbox-text, #1b211c); }
      .file { position: relative; overflow: hidden; }
      .file input { position: absolute; inset: 0; opacity: 0; }
      .list { margin: 10px 0 0; padding: 0; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); list-style: none; }
      .list li { padding: 8px 0; border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); overflow-wrap: break-word; word-break: normal; font-size: 12px; }
      .list small { display: block; margin-top: 2px; color: var(--insta-toolbox-text-muted, #687068); }
      .comparison-browser[hidden] { display: none; }
      .comparison-controls { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
      .comparison-controls .field { margin: 0; }
      .comparison-count { margin: 10px 0 0; color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; }
      .comparison-list strong { display: block; }
      .comparison-more { width: 100%; margin-top: 10px; }
      .notice { padding: 10px; border-left: 4px solid var(--insta-toolbox-warning, #ad7823); background: var(--insta-toolbox-bg-sunken, #fff4d6); color: var(--insta-toolbox-text, #62490f); font-size: 12px; }
      .range-row { display:grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items:center; }
      .footer { height: 28px; min-height: 28px; display: flex; align-items: center; justify-content: center; padding: 3px 52px; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha-strong), transparent); color: var(--insta-toolbox-text-muted, #687068); font-size: 10px; line-height: 1; }
      .footer a { color: inherit; text-decoration: none; }
      .footer a:hover, .footer a:focus-visible { color: var(--insta-toolbox-text, #1b211c); text-decoration: underline; text-underline-offset: 2px; }
      .resize { position: absolute; bottom: 0; display: block; width: 44px; height: 44px; z-index: 5; border: 0; padding: 0; background: transparent; color: var(--insta-toolbox-text-muted, #687068); touch-action: none; }
      .resize.end { right: 0; border-radius: 10px 0 12px 0; cursor: nwse-resize; }
      .resize.start { left: 0; border-radius: 0 10px 0 12px; cursor: nesw-resize; }
      .resize::before { content:""; position:absolute; right:9px; bottom:9px; width:12px; height:12px; border-right:2px solid currentColor; border-bottom:2px solid currentColor; opacity:.9; }
      .resize.start::before { right:auto; left:9px; border-right:0; border-left:2px solid currentColor; }
      .resize:hover { background: color-mix(in srgb, var(--insta-toolbox-accent, #b83d67) 12%, transparent); color: var(--insta-toolbox-text, #1b211c); }
      button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible, .file:focus-within { outline: 3px solid var(--insta-toolbox-focus, #b83d67); outline-offset: 2px; }
      .tab:focus-visible { outline: 0; outline-offset: 0; box-shadow: inset 0 -3px 0 var(--insta-toolbox-focus, #b83d67); }
      @media (max-width: 600px) { .panel { top:auto; right:0; bottom:0; left:0; width:100%; height:min(78dvh,720px); border-radius:14px 14px 0 0; } .handle,.resize { display:none; } .header { grid-template-columns:minmax(0,1fr) auto; } }
      @container (max-width: 420px) { .comparison-controls { grid-template-columns: minmax(0,1fr); } }
      @container (max-width: 330px) { .header h1 { font-size:14px; } }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior:auto !important; } }
      .step, .context, .review, .card { transition: border-color var(--insta-toolbox-motion-base, 180ms) var(--insta-toolbox-ease, ease); }
      .scan-progress .run-bar span { transition: width var(--insta-toolbox-motion-base, 180ms) var(--insta-toolbox-ease, ease); }
      .scan-progress .run-bar[data-indeterminate="true"] span { width: 100% !important; background: repeating-linear-gradient(135deg, var(--insta-toolbox-accent, #b83d67) 0 8px, transparent 8px 14px); opacity: .72; }
      /* A finished run should register without stealing attention. */
      .run-panel[data-finished="true"] .run-bar span { transition: width var(--insta-toolbox-motion-slow, 240ms) var(--insta-toolbox-ease, ease); }
      @media (prefers-reduced-motion: reduce) {
        .step, .context, .review, .card, .settings-inline > summary::after, .scan-progress .run-bar span, .run-panel[data-finished="true"] .run-bar span { transition: none; }
      }
      .review { margin-bottom: 12px; padding: 10px; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 10px; }
      .review strong { display: block; margin-bottom: 6px; font-size: 13px; }
      .list--compact { max-height: 132px; overflow-y: auto; }
      .steps { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
      .step { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 10px; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 10px; }
      .step[data-state="done"] { border-color: var(--insta-toolbox-success, #0a7d3f); }
      .step[data-state="partial"] { border-color: var(--insta-toolbox-warning, #b26a00); }
      .step-num { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; background: var(--insta-toolbox-bg-sunken, #eef1ec); font-size: 12px; font-weight: 600; }
      .step[data-state="done"] .step-num { background: var(--insta-toolbox-success, #0a7d3f); color: #fff; }
      .step-body strong { display: block; font-size: 13px; }
      .step-body span { display: block; color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; }
      .scan-progress { margin-bottom: 12px; }
      .settings-inline { margin-top: 16px; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); }
      .view > .settings-inline { margin-bottom: 16px; }
      .settings-inline > summary { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--insta-toolbox-text, #1b211c); -webkit-text-fill-color: currentColor; cursor: pointer; list-style: none; }
      .settings-inline > summary::-webkit-details-marker { display: none; }
      .settings-inline > summary::after { content: ""; flex: 0 0 auto; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid currentColor; color: var(--insta-toolbox-text-muted, #687068); transition: transform var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease); }
      .settings-inline[open] > summary::after { transform: rotate(90deg); }
      .header, .context, .tabs, .run-panel, .footer { flex: 0 0 auto; }
      .header, .footer { position: relative; z-index: 1; }
      input:not([type="range"]):not([type="checkbox"]), select, textarea { min-height: 44px; box-sizing: border-box; }
      .field input[type="range"] { min-height: 24px; }
      .field input[type="checkbox"] { min-width: 20px; min-height: 20px; }
      .field label { display: block; line-height: 20px; }
      .field input:not([type="checkbox"]):not([type="range"]) { min-height: 44px; }
      .context { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 8px; min-height: 44px; max-height: 52px; align-items: center; overflow: hidden; padding: 5px 10px; border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); background: var(--insta-toolbox-bg-sunken, #eef1ec); color: var(--insta-toolbox-text, #1b211c); }
      .context-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--insta-toolbox-text-muted, #687068); }
      .context[data-tone="ready"] .context-dot { background: var(--insta-toolbox-success, #0a7d3f); }
      .context[data-tone="warning"] .context-dot { background: var(--insta-toolbox-warning, #b26a00); }
      .context[data-tone="blocked"] .context-dot { background: var(--insta-toolbox-danger, #8c1d1d); }
      .context-copy { min-width: 0; }
      .context-copy strong { display: block; overflow: hidden; color: var(--insta-toolbox-text, #1b211c) !important; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .context-copy span { display: -webkit-box; overflow: hidden; color: var(--insta-toolbox-text-muted, #687068) !important; font-size: 11px; overflow-wrap: break-word; word-break: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .context-cta { white-space: nowrap; }
      .run-panel { padding: 10px 12px; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .run-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .run-head strong { font-size: 12px; overflow-wrap: break-word; word-break: normal; }
      .run-bar { overflow: hidden; height: 5px; margin: 8px 0 6px; border-radius: 999px; background: var(--insta-toolbox-line, #d8ddd4); }
      .run-bar span { display: block; width: 0%; height: 100%; border-radius: 999px; background: var(--insta-toolbox-accent, #b83d67); transition: width var(--insta-toolbox-motion-base, 180ms) var(--insta-toolbox-ease, ease); }
      .run-panel .list { max-height: 118px; overflow-y: auto; }
      .button.danger { background: var(--insta-toolbox-danger, #b42318); color: var(--insta-toolbox-on-danger, #fff); }
      .button.primary { background: var(--insta-toolbox-accent, #b83d67); color: var(--insta-toolbox-on-accent, #fff); border: 0; font-weight: 600; }
      .button.primary:hover { filter: brightness(1.08); }
      .button.big { width: 100%; padding: 10px 12px; font-size: var(--system-14-font-size, 14px); line-height: var(--system-14-line-height, 18px); border-radius: 8px; }
      .button:disabled { cursor: not-allowed; filter: none; opacity: .48; }
      .confirm-dialog { width: min(420px, calc(100vw - 28px)); max-height: min(620px, calc(100vh - 28px)); box-sizing: border-box; overflow: auto; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 14px; padding: 0; background: var(--insta-toolbox-bg-raised, #fff); color: var(--insta-toolbox-text, #1b211c); box-shadow: var(--insta-toolbox-shadow-panel); }
      .confirm-dialog::backdrop { background: rgba(0, 0, 0, .62); }
      .confirm-dialog form { display: grid; gap: 12px; margin: 0; padding: 18px; }
      .confirm-dialog h2 { margin: 0; font-size: 18px; line-height: 24px; overflow-wrap: break-word; }
      .confirm-dialog p { margin: 0; color: var(--insta-toolbox-text-muted, #687068); font-size: 13px; line-height: 19px; overflow-wrap: anywhere; white-space: pre-line; }
      .confirm-dialog dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 10px; margin: 0; font-size: 13px; line-height: 19px; }
      .confirm-dialog dt { color: var(--insta-toolbox-text-muted, #687068); font-weight: 600; }
      .confirm-dialog dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
      .confirm-dialog ul { max-height: 160px; margin: 0; padding: 8px 8px 8px 30px; overflow-y: auto; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 8px; font-size: 13px; line-height: 19px; }
      .confirm-dialog .toolbar { justify-content: flex-end; }
      [data-role="inbox-cleanup"] { display:grid; gap:12px; margin-top:12px; }
      [data-role="inbox-cleanup"] > .field { margin:0; gap:6px; }
      [data-role="inbox-cleanup"] > .lead { margin:0; }
      [data-role="inbox-cleanup"] select { width:100%; padding-right:34px; }
      .inbox-selection { display:grid; gap:4px; max-height:240px; overflow:auto; }
      .inbox-choice { position:relative; display:flex; flex:none; align-items:center; gap:12px; width:100%; min-height:44px; padding:4px 8px; line-height:20px; scroll-margin-block:12px; }
      .inbox-choice > input[type="checkbox"] { flex:0 0 auto; min-width:20px; min-height:20px; }
      .inbox-choice > span { display:grid; gap:4px; min-width:0; }
      .inbox-choice small { color:var(--insta-toolbox-text-muted, #687068); overflow-wrap:anywhere; }
      .settings-dialog { width: min(440px, calc(100vw - 28px)); max-height: min(720px, calc(100dvh - 28px)); box-sizing: border-box; overflow: auto; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 14px; padding: 0; background: var(--insta-toolbox-bg-raised, #fff); color: var(--insta-toolbox-text, #1b211c); box-shadow: var(--insta-toolbox-shadow-panel); font-family: var(--insta-toolbox-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      .settings-dialog::backdrop { background: rgba(12,14,12,.44); backdrop-filter: grayscale(.65) blur(1px); }
      .settings-dialog form { display: grid; gap: 16px; margin: 0; padding: 16px; }
      .settings-heading { position:sticky; top:0; z-index:1; display:flex; align-items:center; justify-content:space-between; gap:12px; background:var(--insta-toolbox-bg-raised, #fff); }
      .settings-heading h2 { margin:0; font:600 18px/24px var(--insta-toolbox-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      .settings-dialog .lead { margin:0; }
      .settings-dialog .toolbar { margin:0; }
      .settings-section { display:grid; gap:12px; padding:12px 0 0; border-top:1px solid var(--insta-toolbox-line); }
      .settings-section h3 { margin:0; font:600 14px/20px var(--insta-toolbox-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      .settings-section .field { min-width:0; margin:0; gap:8px; }
      .settings-section .field label { min-height:0; line-height:20px; }
      .settings-section select, .settings-section input:not([type="checkbox"]), .settings-section button { min-height:44px; box-sizing:border-box; }
      .settings-section select, .settings-section input { max-width:100%; }
      .settings-section > label, .setting-option > label { display:flex; align-items:center; gap:8px; min-height:44px; font-size:13px; }
      .setting-option { display:grid; gap:4px; }
      .settings-section .settings-inline { margin:0; padding:0; }
      .settings-section.settings-inline { margin:0; padding:0; row-gap:0; }
      .settings-section.settings-inline[open] { padding-bottom:12px; }
      .settings-section.settings-inline > :not(summary), .settings-section .settings-inline > :not(summary) { margin-top:12px; }
      .settings-appearance-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr)); gap:16px 12px; }
      .settings-appearance-wide { grid-column:1 / -1; }
      .setting-note { margin:0; font-size:12px; line-height:18px; color:var(--insta-toolbox-text-muted); }
      @keyframes insta-toolbox-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .run-bar span, .tab, .button { transition: none; } .panel { animation: none; } }
      @media (forced-colors: active) { .panel,.card,.tool,.metric,.header,.footer,.run-panel,.confirm-dialog,.settings-dialog { background:Canvas; } .panel,.card,.tool,.metric,.confirm-dialog,.settings-dialog { border:2px solid CanvasText; } .tab:focus-visible { outline:2px solid Highlight; outline-offset:-3px; box-shadow:none; } }
      @media (forced-colors: active) { .settings-inline > summary { color: CanvasText; } }
    </style>
    <button class="launcher" type="button" data-action="open" aria-label="Open Insta Toolbox; drag or use arrow keys to move" aria-expanded="false" title="Drag to move · Click to open">IT</button>
    <aside class="panel" aria-label="Insta Toolbox" hidden>
      <header class="header">
        <button class="handle" type="button" data-role="move" aria-label="Move toolbox; use arrow keys for precise movement" title="Drag to move">✥</button>
        <h1>Insta Toolbox</h1>
        <div style="display:flex">
          <button class="icon" type="button" data-action="open-settings" data-role="settings-button" aria-label="Customize Insta Toolbox" aria-haspopup="dialog" aria-expanded="false">⚙</button>
          <button class="icon" type="button" data-action="close" aria-label="Collapse Insta Toolbox">×</button>
        </div>
      </header>
      <div class="context" data-role="context">
        <span class="context-dot" data-role="context-dot"></span>
        <div class="context-copy" role="status" aria-live="polite" aria-atomic="true"><strong data-role="context-title">Checking this page…</strong> <span data-role="context-detail"></span></div>
        <button class="button quiet context-cta" type="button" data-action="context-cta" data-role="context-cta" hidden></button>
      </div>
      <nav class="tabs" role="tablist" aria-label="Insta Toolbox tools">
        <button id="insta-toolbox-tab-checker" class="tab" type="button" role="tab" data-view="checker" aria-controls="insta-toolbox-panel-checker" aria-selected="true" tabindex="0">Mutual Checker</button>
        <button id="insta-toolbox-tab-account" class="tab" type="button" role="tab" data-view="account" aria-controls="insta-toolbox-panel-account" aria-selected="false" tabindex="-1">Presence</button>
        <button id="insta-toolbox-tab-messages" class="tab" type="button" role="tab" data-view="messages" aria-controls="insta-toolbox-panel-messages" aria-selected="false" tabindex="-1">DM Unsend</button>
      </nav>
      <div class="scroll">
        <section id="insta-toolbox-panel-checker" class="view" role="tabpanel" aria-labelledby="insta-toolbox-tab-checker" data-panel="checker" hidden><section class="card" aria-labelledby="insta-toolbox-checker-account-title"><h2 id="insta-toolbox-checker-account-title">Check mutuals</h2><p>Read-only. Uses the Instagram session in this tab.</p><div class="field"><label for="insta-toolbox-checker-username">Instagram username</label><input id="insta-toolbox-checker-username" type="text" inputmode="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="your_username" data-role="checker-username"></div><div class="toolbar"><button class="button primary" type="button" data-action="check-account-relationships" data-role="checker-run">Check mutuals</button></div></section>
          <div class="scan-progress" data-role="scan-progress" hidden><div class="run-bar" data-role="scan-bar" role="progressbar" aria-label="Mutual check progress" aria-describedby="insta-toolbox-scan-detail" aria-valuemin="0" aria-valuemax="100"><span data-role="scan-fill"></span></div><p id="insta-toolbox-scan-detail" class="lead" data-role="scan-detail"></p></div>
          <div class="card" data-role="comparison"></div>
          <section class="card comparison-browser" data-role="comparison-browser" aria-labelledby="insta-toolbox-comparison-browser-title" hidden><h2 id="insta-toolbox-comparison-browser-title">Comparison list</h2><div class="comparison-controls"><div class="field"><label for="insta-toolbox-comparison-category">Show accounts</label><select id="insta-toolbox-comparison-category" data-role="comparison-category" aria-controls="insta-toolbox-comparison-list"><option value="not-following-me-back">Don't follow you back</option><option value="i-do-not-follow-back">You don't follow back</option><option value="mutuals">Mutuals</option></select></div><div class="field"><label for="insta-toolbox-filter">Find a username</label><input id="insta-toolbox-filter" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search usernames" data-role="result-filter" aria-controls="insta-toolbox-comparison-list"></div></div><p id="insta-toolbox-comparison-count" class="comparison-count" data-role="comparison-count" tabindex="-1"></p><ul id="insta-toolbox-comparison-list" class="list comparison-list" data-role="comparison-list" aria-describedby="insta-toolbox-comparison-count"></ul><button class="button quiet comparison-more" type="button" data-action="show-more-comparison" data-role="comparison-more" hidden>Show more</button></section>
          <details class="settings-inline"><summary>Capture lists and export</summary><p class="lead">If the account check fails, open Followers or Following and scan that list.</p><ol class="steps" data-role="checker-steps"><li class="step" data-step="following"><span class="step-num">1</span><div class="step-body"><strong>Scan Following</strong><span data-role="step-following">Not scanned yet</span></div><button class="button quiet" type="button" data-action="scan-following">Scan Following</button></li><li class="step" data-step="followers"><span class="step-num">2</span><div class="step-body"><strong>Scan Followers</strong><span data-role="step-followers">Not scanned yet</span></div><button class="button quiet" type="button" data-action="scan-followers">Scan Followers</button></li><li class="step" data-step="compare"><span class="step-num">3</span><div class="step-body"><strong>Compare</strong><span data-role="step-compare">Scan both lists first</span></div></li></ol><ul class="list" data-role="capture-list"></ul><div class="toolbar"><button class="button quiet" type="button" data-action="capture">Capture visible rows</button><button class="button quiet" type="button" data-action="download-list">Download raw list</button><button class="button quiet" type="button" data-action="download-comparison-json">Download JSON</button><button class="button quiet" type="button" data-action="clear-capture">Clear checker</button></div><div class="field"><label for="insta-toolbox-list-type">Raw list</label><select id="insta-toolbox-list-type" data-role="list-type"><option value="following">Following</option><option value="followers">Followers</option></select></div></details></section>
        <section id="insta-toolbox-panel-account" class="view" role="tabpanel" aria-labelledby="insta-toolbox-tab-account" data-panel="account" hidden><div class="card" data-role="presence-routine"></div></section>
        <section id="insta-toolbox-panel-messages" class="view" role="tabpanel" aria-labelledby="insta-toolbox-tab-messages" data-panel="messages" hidden><p class="lead">Remove messages you sent in this conversation.</p><div class="toolbar"><button class="button danger big" type="button" data-action="run-unsend" data-role="unsend-primary">Unsend DMs</button></div>
          <div class="card" data-role="dm-summary" hidden><strong data-role="dm-summary-title"></strong><span data-role="dm-summary-detail"></span></div>
          <div class="setting-option" data-role="unsend-reactions-option" hidden><label><input type="checkbox" data-role="unsend-reactions"> Remove my reactions afterward</label></div>
          <details class="settings-inline"><summary>Message options</summary><div data-role="unsend-plan"><div class="field"><select id="insta-toolbox-unsend-scope" data-role="unsend-scope" aria-label="Messages to unsend"><option value="all">All messages you sent</option><option value="newest">Newest messages</option><option value="oldest">Oldest messages</option></select></div><div class="field" data-role="unsend-count-field"><label for="insta-toolbox-unsend-count">Number of messages</label><input id="insta-toolbox-unsend-count" type="number" min="1" max="250" value="1" data-role="unsend-count"></div></div><div class="toolbar"><button class="button quiet" type="button" data-action="scan-sent">Check conversation</button><button class="button quiet" type="button" data-action="read-messages">Read visible thread</button><label class="file quiet">Import reviewed DM job<input type="file" accept=".json,application/json" data-file="dm"></label><button class="button quiet" type="button" data-action="dm-dry-run">Check exact message</button></div></details><div class="card" data-role="dm-result" hidden></div><ul class="list" data-role="message-list" hidden></ul><details class="settings-inline"><summary>Ghost mode</summary><div data-role="inbox-cleanup"></div></details></section>
      </div>
      <div class="run-panel" data-role="run-panel" hidden><div class="run-head"><strong data-role="run-title"></strong><button class="button danger" type="button" data-action="stop-run" data-role="stop-run">Stop</button></div><div class="run-bar"><span data-role="run-fill"></span></div><p class="lead" data-role="run-detail"></p><ul class="list" data-role="run-results"></ul></div>
      <footer class="footer"><a href="https://github.com/slaveofsolace" target="_blank" rel="noopener noreferrer">created by @slaveofsolace</a></footer>
      <button class="resize start" type="button" data-role="resize-start" aria-label="Resize Insta Toolbox from the lower-left corner; use arrow keys for precise sizing" title="Drag to resize · Arrow keys resize"></button>
      <button class="resize end" type="button" data-role="resize-end" aria-label="Resize Insta Toolbox from the lower-right corner; use arrow keys for precise sizing" title="Drag to resize · Arrow keys resize"></button>
    </aside>
    <dialog class="settings-dialog" data-role="settings-dialog" aria-labelledby="insta-toolbox-settings-title" aria-describedby="insta-toolbox-settings-note">
      <form>
        <div class="settings-heading"><h2 id="insta-toolbox-settings-title">Settings</h2><button class="icon" type="button" data-action="close-settings" aria-label="Close settings">×</button></div>
        <p class="lead" id="insta-toolbox-settings-note">Saved in this browser.</p>
        <section class="settings-section" aria-labelledby="insta-toolbox-appearance-title"><h3 id="insta-toolbox-appearance-title">Appearance</h3>
        <div class="settings-appearance-grid">
        <div class="field"><label for="insta-toolbox-theme">Theme</label><select id="insta-toolbox-theme" data-preference="theme"><option value="auto">Match Instagram</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
        <div class="field"><label for="insta-toolbox-density">Density</label><select id="insta-toolbox-density" data-preference="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
        <div class="field settings-appearance-wide"><label for="insta-toolbox-opacity">Opacity</label><div class="range-row"><input id="insta-toolbox-opacity" type="range" min="55" max="100" value="88" data-preference="opacity"><output data-role="opacity-output">88%</output></div></div>
        <div class="field"><label for="insta-toolbox-blur">Blur</label><select id="insta-toolbox-blur" data-preference="blur"><option value="none">Off</option><option value="soft">Soft</option><option value="strong">Strong</option></select></div>
        <div class="field"><label for="insta-toolbox-launcher-size">Launcher size</label><select id="insta-toolbox-launcher-size" data-preference="launcherSize"><option value="standard">Standard</option><option value="large">Large</option></select></div>
        </div><button class="button quiet" type="button" data-action="reset-layout">Reset layout</button>
        <details class="settings-inline"><summary>More appearance options</summary>
        <div class="field"><label for="insta-toolbox-accent">Accent</label><select id="insta-toolbox-accent" data-preference="accent"><option value="rose">Rose</option><option value="violet">Violet</option><option value="blue">Blue</option></select></div>
        <div class="field"><label>Size presets</label><div class="toolbar"><button class="button quiet" type="button" data-action="layout-compact">Compact</button><button class="button quiet" type="button" data-action="layout-tall">Tall</button><button class="button quiet" type="button" data-action="layout-wide">Wide</button></div></div>
        <button class="button quiet" type="button" data-action="reset-appearance">Reset appearance</button></details></section>
        <details class="settings-inline settings-section"><summary>Cleanup defaults</summary>
        <div class="field"><label for="insta-toolbox-default-scope">Messages</label><select id="insta-toolbox-default-scope" data-cleanup-preference="messageScope"><option value="all">All my messages</option><option value="newest">Newest messages</option><option value="oldest">Oldest messages</option></select></div>
        <div class="field"><label for="insta-toolbox-default-limit">Message count</label><input id="insta-toolbox-default-limit" type="number" min="1" max="250" data-cleanup-preference="messageLimit"></div>
        <div class="setting-option"><label><input type="checkbox" data-cleanup-preference="removeOwnReactions" aria-describedby="insta-toolbox-reactions-note"> Remove my reactions afterward</label><p class="setting-note" id="insta-toolbox-reactions-note" hidden></p></div>
        <label><input type="checkbox" data-cleanup-preference="showSummary"> Show completed run details</label></details>
        <details class="settings-inline settings-section"><summary>Execution</summary>
        <div class="field"><label for="insta-toolbox-execution-mode">Worker tabs</label><select id="insta-toolbox-execution-mode" data-cleanup-preference="execution"><option value="foreground">Keep in front</option><option value="background">Open in background</option></select><p class="setting-note">Tabs must stay open and loaded. Sleep, tab discard, or closing Chrome pauses the job.</p></div>
        <div class="field"><label for="insta-toolbox-workers">Tabs to prepare</label><select id="insta-toolbox-workers" data-cleanup-preference="workerCount"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select><p class="setting-note">Ghost mode prepares tabs together, then removes messages one conversation at a time.</p></div>
        <div class="setting-option"><label><input type="checkbox" data-cleanup-preference="notifications" disabled> Completion notifications</label><p class="setting-note">Not available yet</p></div></details>
        <details class="settings-inline settings-section"><summary>Data and troubleshooting</summary><p class="setting-note" data-role="settings-version"></p><p class="setting-note" data-role="storage-usage"></p>
        <div class="toolbar"><button class="button quiet" type="button" data-action="backup-local">Export local data</button><button class="button quiet" type="button" data-action="export-diagnostics">Export diagnostics</button></div>
        <p class="setting-note">Local exports may contain your saved lists. Diagnostics omit accounts, threads and messages.</p>
        <details class="settings-inline"><summary>Follow / Unfollow pacing</summary><div class="field"><label for="insta-toolbox-limit-min">Min delay (seconds)</label><input id="insta-toolbox-limit-min" type="number" min="1" max="600" data-role="limit-min"></div><div class="field"><label for="insta-toolbox-limit-max">Max delay (seconds)</label><input id="insta-toolbox-limit-max" type="number" min="1" max="900" data-role="limit-max"></div><button class="button quiet" type="button" data-action="save-limits">Save pacing</button></details></details>
      </form>
    </dialog>
    <dialog class="confirm-dialog" data-role="action-confirmation" aria-labelledby="insta-toolbox-confirm-title" aria-describedby="insta-toolbox-confirm-message insta-toolbox-confirm-detail">
      <form>
        <h2 id="insta-toolbox-confirm-title" data-role="confirm-title">Confirm action</h2>
        <p id="insta-toolbox-confirm-message" data-role="confirm-message"></p>
        <dl data-role="confirm-facts" hidden></dl>
        <ul data-role="confirm-items" aria-label="Reviewed targets" hidden></ul>
        <p id="insta-toolbox-confirm-detail" data-role="confirm-detail"></p>
        <div class="toolbar"><button class="button quiet" type="button" data-action="confirm-cancel" data-role="confirm-cancel">Cancel</button><button class="button danger" type="button" data-action="confirm-accept" data-role="confirm-accept">Confirm</button></div>
      </form>
    </dialog>`;

  const query = (selector) => shadow.querySelector(selector);
  const queryAll = (selector) => [...shadow.querySelectorAll(selector)];
  const setText = (role, value) => {
    const element = query(`[data-role="${role}"]`);
    if (element) element.textContent = String(value ?? '');
  };
  let contextStatus = null;
  let contextStatusTimer = null;
  const statusTone = (message) => {
    const text = safeText(message).toLocaleLowerCase();
    if (/blocked|could not|disabled|error|expired|failed|rate limit|security check|signed out|unclear|unavailable|wrong thread/.test(text)) return 'blocked';
    if (/captured|checked|complete|detected|done|finished|imported|loaded|marked|ready|reviewed|saved|scanned|unsent/.test(text)) return 'ready';
    return 'warning';
  };
  const status = (message, tone = '') => {
    const text = safeText(message);
    contextStatus = text ? { message: text, tone: tone || statusTone(text) } : null;
    clearTimeout(contextStatusTimer);
    contextStatusTimer = null;
    if (contextStatus) {
      contextStatusTimer = setTimeout(() => {
        contextStatus = null;
        contextStatusTimer = null;
        renderContext();
      }, 10_000);
    }
    renderContext();
  };

  function announceComparisonCount() {
    const message = safeText(query('[data-role="comparison-count"]')?.textContent);
    clearTimeout(checkerResultAnnouncementTimer);
    checkerResultAnnouncementTimer = null;
    if (!message || message === checkerResultAnnouncement) return;
    checkerResultAnnouncementTimer = setTimeout(() => {
      checkerResultAnnouncement = message;
      checkerResultAnnouncementTimer = null;
      status(message, 'neutral');
    }, 250);
  }

  const confirmationController = globalThis.InstaToolboxActionConfirmation?.createController({
    root: shadow,
    attribute: 'data-role',
    status,
    unavailableTone: 'blocked',
  });
  const confirmRun = (request) => confirmationController?.confirm(request) ?? Promise.resolve(null);

  function panelSize() {
    return {
      width: Math.min(preferences.width, Math.max(WIDTH_MIN, innerWidth - (INSET * 2))),
      height: Math.min(preferences.height, Math.max(HEIGHT_MIN, innerHeight - (INSET * 2))),
    };
  }

  function constrainedPosition(position, size = panelSize()) {
    return {
      x: Math.round(clamp(position.x, INSET, Math.max(INSET, innerWidth - size.width - INSET))),
      y: Math.round(clamp(position.y, INSET, Math.max(INSET, innerHeight - size.height - INSET))),
    };
  }

  function launcherDimensions() {
    const side = preferences.launcherSize === 'large' ? 54 : 46;
    return { width: side, height: side };
  }

  function applyLayout() {
    const size = panelSize();
    host.style.setProperty('--insta-toolbox-width', `${size.width}px`);
    host.style.setProperty('--insta-toolbox-height', `${size.height}px`);
    const percent = Math.round(preferences.opacity * 100);
    host.style.setProperty('--insta-toolbox-alpha', `${percent}%`);
    host.style.setProperty('--insta-toolbox-alpha-strong', `${Math.min(100, percent + 8)}%`);
    host.dataset.accent = preferences.accent;
    host.dataset.blur = preferences.blur;
    host.dataset.launcherSize = preferences.launcherSize;
    host.dataset.theme = preferences.theme;
    host.dataset.themePreference = preferences.theme;
    host.dataset.density = preferences.density;
    if (preferences.launcherPosition) {
      const launcherPosition = constrainedPosition(
        preferences.launcherPosition,
        launcherDimensions(),
      );
      host.dataset.launcherFloating = 'true';
      host.style.setProperty('--insta-toolbox-launcher-left', `${launcherPosition.x}px`);
      host.style.setProperty('--insta-toolbox-launcher-top', `${launcherPosition.y}px`);
    } else {
      host.dataset.launcherFloating = 'false';
      host.style.removeProperty('--insta-toolbox-launcher-left');
      host.style.removeProperty('--insta-toolbox-launcher-top');
    }
    if (preferences.position && innerWidth > 600) {
      const position = constrainedPosition(preferences.position, size);
      host.dataset.floating = 'true';
      host.style.setProperty('--insta-toolbox-left', `${position.x}px`);
      host.style.setProperty('--insta-toolbox-top', `${position.y}px`);
    } else {
      host.dataset.floating = 'false';
      host.style.removeProperty('--insta-toolbox-left');
      host.style.removeProperty('--insta-toolbox-top');
    }
    const opacity = query('[data-preference="opacity"]');
    if (opacity && shadow.activeElement !== opacity) opacity.value = String(percent);
    for (const control of queryAll('[data-preference]')) {
      const preference = control.dataset.preference;
      if (preference !== 'opacity' && preferences[preference] !== undefined && shadow.activeElement !== control) {
        control.value = preferences[preference];
      }
    }
    setText('opacity-output', `${percent}%`);
  }

  function renderShellState() {
    const panel = query('.panel');
    const launcher = query('.launcher');
    const opening = preferences.open && panel.hidden;
    const closing = !preferences.open && !panel.hidden;
    if (opening) lastFocusedElement = shadow.activeElement || document.activeElement;
    panel.hidden = !preferences.open;
    launcher.hidden = preferences.open;
    launcher.setAttribute('aria-expanded', String(preferences.open));
    if (!preferences.open) setSettingsOpen(false);
    for (const tab of queryAll('[data-view]')) {
      const selected = tab.dataset.view === preferences.view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const view of queryAll('[data-panel]')) view.hidden = view.dataset.panel !== preferences.view;
    if (opening) {
      requestAnimationFrame(() => {
        if (!preferences.open) return;
        query(`[data-view="${preferences.view}"]`)?.focus({ preventScroll: true });
      });
    } else if (closing) {
      setTimeout(() => {
        if (preferences.open) return;
        const restoreTarget = (
          lastFocusedElement
          && typeof lastFocusedElement.focus === 'function'
          && lastFocusedElement.isConnected
          && lastFocusedElement !== document.body
          && lastFocusedElement !== document.documentElement
        ) ? lastFocusedElement : launcher;
        restoreTarget.focus({ preventScroll: true });
        lastFocusedElement = null;
      }, 0);
    }
  }

  function setSettingsOpen(open) {
    const dialog = query('[data-role="settings-dialog"]');
    const button = query('[data-role="settings-button"]');
    if (!dialog || !button) return;
    const shouldOpen = Boolean(open);
    button.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen && !dialog.open) {
      renderCleanupSettings();
      const bytes = new Blob([JSON.stringify({ state, preferences, cleanupPreferences })]).size;
      setText('storage-usage', `${bytes.toLocaleString()} bytes in current local data`);
      setText('settings-version', `Version ${typeof GM_info !== 'undefined' ? GM_info.script.version : 'development'}`);
      dialog.showModal();
      requestAnimationFrame(() => query('#insta-toolbox-theme')?.focus({ preventScroll: true }));
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  }

  function renderCleanupSettings({ initializeDraft = false } = {}) {
    const effective = cleanupSettings.effective(cleanupPreferences, 'userscript');
    const reactionsSupported = cleanupSettings.capabilities('userscript').reactions;
    query('[data-role="unsend-reactions-option"]').hidden = !reactionsSupported;
    query('[data-role="unsend-reactions"]').disabled = !reactionsSupported;
    query('[data-cleanup-preference="removeOwnReactions"]').disabled = !reactionsSupported;
    query('#insta-toolbox-reactions-note').hidden = reactionsSupported;
    for (const control of queryAll('[data-cleanup-preference]')) {
      const value = effective[control.dataset.cleanupPreference];
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
    }
    if (initializeDraft) {
      query('[data-role="unsend-scope"]').value = effective.messageScope;
      query('[data-role="unsend-count"]').value = String(effective.messageLimit);
      query('[data-role="unsend-reactions"]').checked = effective.removeOwnReactions;
    }
  }

  function onSettingsDialogClick(event) {
    if (event.target === event.currentTarget) setSettingsOpen(false);
  }

  function onSettingsDialogClose() {
    query('[data-role="settings-button"]')?.setAttribute('aria-expanded', 'false');
  }

  function renderChecker() {
    const verifiedFollowers = verifiedCapture('followers');
    const verifiedFollowing = verifiedCapture('following');
    const summary = engine.followerComparisonSummary(state.capture);
    const comparisonReady = summary.available;
    const authenticatedCheck = state.capture.source?.followers === 'authenticated-web'
      && state.capture.source?.following === 'authenticated-web';
    const usernameInput = query('[data-role="checker-username"]');
    if (usernameInput && document.activeElement !== usernameInput && !usernameInput.value) {
      usernameInput.value = state.capture.subjectUsername
        || engine?.detectAuthenticatedUsername?.()
        || '';
    }
    const runButton = query('[data-role="checker-run"]');
    if (runButton) {
      runButton.textContent = relationshipController
        ? 'Stop mutual check'
        : 'Check Followers + Following';
      runButton.classList.toggle('danger', Boolean(relationshipController));
      runButton.classList.toggle('primary', !relationshipController);
    }
    setText('followers-count', formatCount(verifiedFollowers.length));
    setText('following-count', formatCount(verifiedFollowing.length));
    const comparison = compareCapture({ allowPartial: true });
    const result = query('[data-role="comparison"]');
    result.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = comparisonReady
      ? !summary.complete ? 'Partial comparison' : authenticatedCheck ? `Account comparison${state.capture.subjectUsername ? ` · @${state.capture.subjectUsername}` : ''}` : 'Scanned-list comparison'
      : 'No comparison loaded';
    const detail = document.createElement('p');
    detail.textContent = comparisonReady
      ? `${formatCount(state.capture.followers.length)} followers · ${formatCount(state.capture.following.length)} following · ${formatCount(comparison.mutuals.length)} mutual · ${formatCount(comparison.notFollowingMeBack.length)} ${summary.labels.notFollowingMeBack.toLowerCase()} · ${formatCount(comparison.iDoNotFollowBack.length)} ${summary.labels.iDoNotFollowBack.toLowerCase()}.`
      : 'Run Check mutuals to load a comparison.';
    result.append(title, detail);

    if (comparisonReady && !summary.complete) {
      const warning = document.createElement('p');
      warning.className = 'notice';
      warning.textContent = summary.warning;
      result.append(warning);
      for (const text of summary.details || []) {
        const diagnostic = document.createElement('p');
        diagnostic.textContent = text;
        result.append(diagnostic);
      }
      if (summary.ageFilterGuidance) {
        const guidance = document.createElement('p');
        guidance.className = 'notice';
        guidance.append(document.createTextNode(`${summary.ageFilterGuidance} `));
        const link = document.createElement('a');
        link.href = summary.accountsCenterUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open Accounts Center';
        guidance.append(link);
        result.append(guidance);
      }
    }

    const unverified = ['followers', 'following']
      .filter((type) => state.capture[type].length && state.capture.verified?.[type] !== true);
    if (unverified.length) {
      const warning = document.createElement('p');
      warning.className = 'notice';
      warning.textContent = `Saved ${unverified.join(' and ')} rows need a fresh scan before they can be used for runs.`;
      result.append(warning);
    }

    if (comparisonReady) {
      const actions = document.createElement('div');
      actions.className = 'toolbar';
      const button = document.createElement('button');
      button.className = 'button quiet';
      button.type = 'button';
      button.dataset.role = 'comparison-report-download';
      button.textContent = 'Download comparison report';
      button.addEventListener('click', () => {
        const generatedAt = nowIso();
        downloadText(
          `insta-toolbox-mutual-comparison-${generatedAt.replace(/[:.]/g, '-')}.txt`,
          engine.followerComparisonReport(state.capture, comparison, generatedAt),
        );
      });
      actions.append(button);
      result.append(actions);
    }

    const browser = query('[data-role="comparison-browser"]');
    const category = query('[data-role="comparison-category"]');
    if (category) for (const option of category.options) {
      option.textContent = summary.labels[CHECKER_CATEGORY_KEYS[option.value]] || option.textContent;
    }
    const comparisonList = query('[data-role="comparison-list"]');
    const comparisonCount = query('[data-role="comparison-count"]');
    const showMore = query('[data-role="comparison-more"]');
    if (browser && comparisonList && comparisonCount && showMore) {
      browser.hidden = !comparisonReady;
      comparisonList.replaceChildren();
      if (comparisonReady) {
        const selection = comparisonBrowserSelection(comparison);
        comparisonCount.textContent = selection.total
          ? `Showing ${formatCount(selection.accounts.length)} of ${formatCount(selection.total)} ${selection.total === 1 ? 'account' : 'accounts'}.`
          : '0 accounts.';
        for (const account of selection.accounts) {
          const row = document.createElement('li');
          const username = document.createElement('strong');
          username.textContent = `@${account.username}`;
          row.append(username);
          if (account.displayName && account.displayName !== account.username) {
            const displayName = document.createElement('small');
            displayName.textContent = account.displayName;
            row.append(displayName);
          }
          comparisonList.append(row);
        }
        if (!selection.total) {
          const empty = document.createElement('li');
          empty.textContent = safeText(query('[data-role="result-filter"]')?.value)
            ? 'No captured account matches this search.'
            : 'No accounts are in this comparison group.';
          comparisonList.append(empty);
        }
        const remaining = Math.max(0, selection.total - selection.accounts.length);
        showMore.hidden = remaining === 0;
        showMore.textContent = remaining
          ? `Show ${formatCount(Math.min(CHECKER_RESULTS_PAGE_SIZE, remaining))} more`
          : 'Show more';
      } else {
        comparisonCount.textContent = '';
        showMore.hidden = true;
      }
    }

    const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
    const list = query('[data-role="capture-list"]');
    list.replaceChildren();
    for (const account of state.capture[listType].slice(0, 12)) {
      const row = document.createElement('li');
      row.textContent = `@${account.username}`;
      list.append(row);
    }
    if (!state.capture[listType].length) {
      const row = document.createElement('li');
      row.textContent = `No ${listType} rows captured yet.`;
      list.append(row);
    }
  }

  function renderAccount() {
    const item = currentQueueItem();
    const current = query('[data-role="queue-current"]');
    const result = query('[data-role="account-result"]');
    if (!current || !result) return;
    current.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = item ? `@${item.account.username}` : 'No queue item loaded';
    const detail = document.createElement('p');
    detail.textContent = item
      ? `${item.action} · ${item.status} · ${item.reason}`
      : 'Import an insta-toolbox-manual-queue JSON file.';
    current.append(title, detail);
    result.replaceChildren();
    const resultTitle = document.createElement('h3');
    resultTitle.textContent = 'Profile status';
    const resultDetail = document.createElement('p');
    resultDetail.textContent = state.accountCheck?.result
      || (item
        ? 'Open the queued profile, then refresh.'
        : 'Open an Instagram profile, then refresh.');
    result.append(resultTitle, resultDetail);
    syncAccountComposer();
    renderAccountRunPrimary();
  }

  function renderMessages() {
    const activeThreadId = currentDirectThreadId();
    const target = activeThreadId
      && directThreadId(state.dmTarget?.conversationId) === activeThreadId
      ? state.dmTarget
      : null;
    const check = activeThreadId && state.dmCheck?.threadId === activeThreadId
      ? state.dmCheck
      : null;
    const evidence = activeThreadId && state.messageEvidence?.threadId === activeThreadId
      ? state.messageEvidence
      : null;
    const result = query('[data-role="dm-result"]');
    result.replaceChildren();
    const hasEvidence = Boolean(check || target || evidence);
    result.hidden = !hasEvidence;
    const list = query('[data-role="message-list"]');
    list.replaceChildren();
    const fragments = evidence?.fragments || [];
    list.hidden = fragments.length === 0;
    if (!hasEvidence) return;
    const title = document.createElement('h2');
    title.textContent = check?.exact
      ? 'Exact sent message resolved'
      : target
        ? 'Reviewed message ' + target.messageId
        : activeThreadId
          ? 'No reviewed DM target for this conversation'
          : 'Open an Instagram conversation';
    const detail = document.createElement('p');
    detail.textContent = check?.reason
      || evidence?.reason
      || (activeThreadId
        ? 'Read visible evidence or import one reviewed DM job for this conversation.'
        : 'Open an Instagram conversation first.');
    result.append(title, detail);
    for (const fragment of fragments) {
      const row = document.createElement('li');
      row.textContent = fragment.text;
      const meta = document.createElement('small');
      meta.textContent = 'Visible fragment · ownership unknown';
      row.append(meta);
      list.append(row);
    }
  }

  function renderAll() {
    applyLayout();
    renderShellState();
    renderChecker();
    renderAccount();
    renderMessages();
    syncTabs(preferences.view);
    renderCheckerSteps();
    renderDmSummary();
    renderContext();
    renderRun();
    renderLimits();
  }

  function renderLimits() {
    const bounds = limits();
    const set = (role, value) => {
      const field = query(`[data-role="${role}"]`);
      if (field && shadow.activeElement !== field) field.value = String(value);
    };
    set('limit-min', Math.round(bounds.minDelayMs / 1000));
    set('limit-max', Math.round(bounds.maxDelayMs / 1000));
  }

  function renderRun() {
    const panel = query('[data-role="run-panel"]');
    if (!panel) return;
    const run = state.run;
    panel.hidden = !run;
    if (!run) return;

    const done = (run.completed || 0) + (run.skipped || 0) + (run.failed || 0);
    const total = run.total || 0;
    const title = query('[data-role="run-title"]');
    if (title) {
      if (run.status === 'running') {
        title.textContent = run.current ? `Running · ${run.current}` : 'Running';
      } else if (run.status === 'completed') {
        title.textContent = 'Run finished';
      } else if (run.status === 'aborted') {
        title.textContent = 'Run stopped';
      } else {
        title.textContent = `Stopped · ${run.stopReason || 'safe stop'}`;
      }
    }
    const detail = query('[data-role="run-detail"]');
    if (detail) {
      const parts = [`${done}/${total} processed`, `${run.completed || 0} done`];
      if (run.skipped) parts.push(`${run.skipped} skipped`);
      if (run.failed) parts.push(`${run.failed} failed`);
      detail.textContent = parts.join(' · ');
    }
    const fill = query('[data-role="run-fill"]');
    if (fill) fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    const stop = query('[data-role="stop-run"]');
    if (stop) stop.hidden = run.status !== 'running';

    const list = query('[data-role="run-results"]');
    if (list) {
      list.replaceChildren();
      for (const entry of (run.results || []).slice(0, 12)) {
        const row = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = entry.label;
        const small = document.createElement('small');
        small.textContent = entry.reason ? `${entry.status} · ${entry.reason}` : entry.status;
        row.append(strong, small);
        list.append(row);
      }
    }
  }

  async function readJsonFile(file) {
    if (!file || file.size > 5_000_000) throw new Error('JSON imports are limited to five megabytes.');
    return JSON.parse(await file.text());
  }

  async function importQueue(file) {
    const parsed = await readJsonFile(file);
    if (parsed?.kind !== 'insta-toolbox-manual-queue' || !Array.isArray(parsed.queue)) {
      throw new Error('Select an Insta Toolbox queue export.');
    }
    state.queue = normalizeQueue({ queue: parsed.queue, importedAt: nowIso() });
    saveState();
    status(`Imported ${state.queue.queue.length} local queue items.`);
  }

  async function importDmJob(file) {
    const parsed = await readJsonFile(file);
    if (parsed?.kind !== 'insta-toolbox-reviewed-dm-job' || parsed.items?.length !== 1) {
      throw new Error('Select one reviewed Insta Toolbox DM job with exactly one message.');
    }
    const item = parsed.items[0];
    if (
      item.sentByMe !== true
      || !safeText(item.conversationId)
      || !safeText(item.messageId)
      || !safeText(item.contentDigest)
      || !Number.isFinite(Number(item.timestamp))
    ) throw new Error('The reviewed DM item is incomplete or is not proven sent by you.');
    state.dmTarget = {
      conversationId: safeText(item.conversationId),
      messageId: safeText(item.messageId),
      contentDigest: safeText(item.contentDigest),
      timestamp: Number(item.timestamp),
      sentByMe: true,
    };
    state.dmCheck = null;
    saveState();
    status(`Loaded reviewed message ${state.dmTarget.messageId} for a no-click identity check.`);
  }

  function updateQueue(statusValue) {
    const item = currentQueueItem();
    if (!item) return;
    state.queue.queue = state.queue.queue.map((candidate) => candidate.id === item.id
      ? { ...candidate, status: statusValue, companionUpdatedAt: nowIso() }
      : candidate);
    saveState();
    status(`Saved @${item.account.username} as ${statusValue}.`);
  }

  // --- Finite confirmed actions ------------------------------------------
  //
  // The engine bundled above is the same one the extension runs. It still mints
  // a one-use resolution token during inspection and refuses to act unless the
  // token matches the element it resolved, so a live run here gets exactly the
  // same exact-target checks the extension gets.

  let batchAbort = false;
  let accountRunDraft = null;
  let relationshipController = null;
  let relationshipProgress = null;
  let dmThreadPreview = null;
  let dmRunnerSnapshot = null;
  let dmCleanupController = null;
  let reactionCleanup = null;
  let reactionSnapshot = null;
  let inboxPanel = null;
  let presencePanel = null;
  let presenceSession = null;
  let presenceCapture = null;

  const engine = globalThis.InstaToolboxInstagramInspector;
  const presenceInputs = globalThis.InstaToolboxPresenceInputs?.create({
    fetchFollowerComparison: options => engine.fetchFollowerComparison(options),
    inspectViewer: () => globalThis.InstaToolboxInstagramViewer.inspect({ document, location }),
  });
  const invalidatePresence = () => {
    presenceCapture = null;
    presenceInputs?.invalidate();
  };
  const inspectPresenceAccount = () => {
    const session = engine.inspectSession?.() || {};
    const accountId = engine.detectAuthenticatedUsername?.() || '';
    const restricted = Boolean(session.sessionExpired || session.challenge
      || session.actionBlocked || session.rateLimited);
    return {
      ...session,
      accountVerified: Boolean(accountId) && !restricted,
      usable: location.origin === 'https://www.instagram.com' && Boolean(accountId) && !restricted,
      accountId,
      accountKey: globalThis.InstaToolboxInstagramViewer?.accountKey?.(accountId) || null,
      restriction: restricted,
      frozen: document.visibilityState === 'hidden' && document.wasDiscarded === true,
      discarded: document.wasDiscarded === true,
    };
  };
  const stopPresenceSession = () => {
    presenceSession?.stop();
  };
  const dmRunner = globalThis.InstaToolboxDmThreadUnsender;
  if (dmRunner) {
    dmRunnerSnapshot = dmRunner.snapshot();
    dmRunner.subscribe((next) => {
      dmRunnerSnapshot = next;
      renderDmSummary();
      renderShellState();
      if (['preparing', 'running', 'waiting', 'stopping', 'completed', 'stopped', 'error'].includes(next.status)) {
        status(next.message);
      }
    });
  }
  if (dmRunner?.createMessageWalker && globalThis.InstaToolboxReactionCleanup
    && globalThis.InstaToolboxInstagramViewer) {
    reactionCleanup = globalThis.InstaToolboxReactionCleanup.create({
      inspectContext: () => globalThis.InstaToolboxInstagramViewer.inspect(),
    });
    reactionCleanup.subscribe((next) => {
      reactionSnapshot = next;
      renderDmSummary();
      if (next.status !== 'idle') status(next.message);
    });
  }

  const LIMIT_BOUNDS = {
    minDelayMs: [1_000, 600_000],
    maxDelayMs: [1_000, 900_000],
  };
  const REST_EVERY = 20;
  const REST_MS = 90_000;

  function runCapabilityValid(run = state.run) {
    return Boolean(
      run?.status === 'running'
      && safeText(run.capabilityId)
      && Number(run.capabilityExpiresAt) > Date.now()
      && Array.isArray(run.approvedTargets)
      && run.capabilityDigest === accountCapabilityDigest(run.action, run.approvedTargets)
      && (run.queue || []).every((username) => run.approvedTargets.includes(username)),
    );
  }

  function stopForExpiredCapability() {
    batchAbort = true;
    setRun({
      status: 'stopped',
      stopReason: 'finite run capability expired',
      current: '',
      nextAt: null,
      queue: [],
    });
    status('This run expired. No further Instagram action was made.');
  }

  function clampNumber(value, [minimum, maximum], fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function limits() {
    const stored = state.limits || {};
    return {
      minDelayMs: clampNumber(stored.minDelayMs, LIMIT_BOUNDS.minDelayMs, 1_000),
      maxDelayMs: clampNumber(stored.maxDelayMs, LIMIT_BOUNDS.maxDelayMs, 2_000),
    };
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function recordAction(kind) {
    const ledger = state.ledger?.day === today()
      ? state.ledger
      : { day: today(), actions: 0, unsends: 0 };
    ledger[kind] = Number(ledger[kind] || 0) + 1;
    state.ledger = ledger;
    saveState();
  }

  let activeUnsendCapability = null;

  function reserveUnsendPlan(plan) {
    const finite = plan?.scope !== 'all';
    const count = Number(plan?.limit);
    const reviewedDigest = String(plan?.reviewedDigest || '');
    if (
      ![2, 3].includes(plan?.version)
      || (plan?.version === 3 && plan.speed !== 'standard')
      || (plan?.version === 2 && plan?.speed != null && plan.speed !== 'standard')
      || (finite && (!Number.isInteger(count) || count < 1))
      || !/^[0-9a-f]{8}$/.test(reviewedDigest)
      || Number(plan?.expiresAt) <= Date.now()
    ) return { ok: false, reason: 'The reviewed thread plan expired.' };
    if (activeUnsendCapability?.reviewedDigest === reviewedDigest) {
      return { ok: false, reason: 'This reviewed Unsend plan was already reserved.' };
    }
    activeUnsendCapability = {
      expiresAt: Number(plan.expiresAt),
      reviewedDigest,
      threadId: String(plan.threadId || ''),
      recordedProcessed: 0,
    };
    return {
      ok: true,
      minDelayMs: 1_000,
      maxDelayMs: 2_000,
    };
  }

  function recordVerifiedUnsend(plan, outcome) {
    const removed = Math.max(0, Math.floor(Number(outcome?.processed) || 0));
    const recorded = Math.max(0, Math.floor(Number(activeUnsendCapability?.recordedProcessed) || 0));
    const increment = Math.max(0, removed - recorded);
    if (!increment) return;
    const current = state.ledger?.day === today()
      ? state.ledger
      : { day: today(), actions: 0, unsends: 0 };
    current.unsends = Number(current.unsends || 0) + increment;
    current.lastUnsendPlanDigest = String(plan?.reviewedDigest || current.lastUnsendPlanDigest || '');
    current.lastUnsendPlanResult = safeText(outcome?.status, 'running');
    current.lastUnsendPlanProcessed = removed;
    state.ledger = current;
    if (activeUnsendCapability) activeUnsendCapability.recordedProcessed = removed;
    saveState();
  }

  function finalizeUnsendOutcome(plan, outcome) {
    recordVerifiedUnsend(plan, outcome);
    if (!Math.max(0, Math.floor(Number(outcome?.processed) || 0))) return;
    state.ledger.lastUnsendPlanResult = safeText(outcome?.status, 'stopped');
    saveState();
  }

  function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  function sessionStop(observation) {
    if (observation?.sessionExpired) return 'session expired';
    if (observation?.challenge) return 'Instagram asked for a security check';
    if (observation?.actionBlocked) return 'Instagram blocked the action';
    if (observation?.rateLimited) return 'Instagram rate limited this account';
    return null;
  }

  function setRun(patch) {
    state.run = { ...(state.run || {}), ...patch };
    saveState();
    renderAll();
  }

  async function runOneAccount(username, action) {
    const observation = engine.inspectProfile(username);
    const stop = sessionStop(observation);
    if (stop) return { status: 'stopped', reason: stop, fatal: true };
    const expected = action === 'follow' ? 'not-following' : 'following';
    if (
      observation?.username !== username
      || observation?.relationship !== expected
      || observation?.ambiguous
      || observation?.unexpectedUi
      || !observation?.resolutionToken
    ) {
      return {
        status: 'skipped',
        reason: observation?.username !== username
          ? 'a different profile is open'
          : observation?.reason || `not ${expected}`,
        fatal: false,
      };
    }
    const result = await engine.performReviewedProfileAction({
      action,
      expectedRelationship: expected,
      resolutionToken: observation.resolutionToken,
      username,
    });
    const resultStop = sessionStop(result);
    if (resultStop) return { status: 'stopped', reason: resultStop, fatal: true };
    if (!result?.result || result.ambiguous || result.unexpectedUi) {
      return { status: 'failed', reason: result?.reason || 'not confirmed', fatal: false };
    }
    recordAction('actions');
    return { status: 'completed', reason: String(result.result), fatal: false };
  }

  // An account run has to visit each target's profile, and navigating tears this
  // script down and reloads it. So an account run is persisted with its
  // remaining queue and picked up again on the next page load: one profile per
  // load. That is safe because every item is independently re-resolved on
  // arrival and still has to pass the exact-target checks before anything
  // happens — resuming never inherits trust from the previous page.
  function resumableAccountRun() {
    const run = state.run;
    if (!run || run.kind !== 'account' || run.status !== 'running') return null;
    return Array.isArray(run.queue) && run.queue.length ? run : null;
  }

  async function continueAccountRun() {
    const run = resumableAccountRun();
    if (!run) return;
    if (!runCapabilityValid(run)) {
      stopForExpiredCapability();
      return;
    }
    const username = run.queue[0];
    const onTarget = engine.normalizeUsername(location.pathname) === username;

    if (!onTarget) {
      setRun({ current: `@${username}` });
      status(`Opening @${username} to continue the run.`);
      location.href = `https://www.instagram.com/${encodeURIComponent(username)}/`;
      return;
    }

    setRun({ current: `@${username}` });
    let outcome;
    try {
      outcome = await runOneAccount(username, run.action);
    } catch (error) {
      outcome = { status: 'failed', reason: error.message, fatal: false };
    }

    const current = state.run || {};
    const patch = {
      queue: (current.queue || []).slice(1),
      results: [{ label: `@${username}`, status: outcome.status, reason: outcome.reason },
        ...(current.results || [])].slice(0, 40),
    };
    if (outcome.status === 'completed') patch.completed = (current.completed || 0) + 1;
    else if (outcome.status === 'skipped') patch.skipped = (current.skipped || 0) + 1;
    else patch.failed = (current.failed || 0) + 1;
    setRun(patch);

    if (outcome.fatal) {
      setRun({ status: 'stopped', stopReason: outcome.reason, current: '', queue: [] });
      status(`Stopped: ${outcome.reason}. Nothing further was attempted.`);
      return;
    }
    if (!(state.run?.queue || []).length) {
      const done = state.run || {};
      setRun({ status: 'completed', current: '', nextAt: null });
      status(`Run finished: ${done.completed || 0} done, ${done.skipped || 0} skipped, ${done.failed || 0} failed.`);
      return;
    }

    const bounds = limits();
    const processed = (state.run.total || 0) - state.run.queue.length;
    let wait = bounds.minDelayMs
      + Math.floor(Math.random() * (Math.max(bounds.maxDelayMs, bounds.minDelayMs) - bounds.minDelayMs + 1));
    if (processed % REST_EVERY === 0) wait += REST_MS;
    setRun({ nextAt: Date.now() + wait });
    await sleep(wait);
    if (batchAbort || state.run?.status !== 'running') return;
    await continueAccountRun();
  }

  async function startAccountRun({ action, usernames }) {
    if (!managerTabStorageAvailable) {
      status('This userscript manager cannot keep a run active while opening profiles. Account batches are unavailable; scans and no-click checks still work.');
      return;
    }
    if (state.run?.status === 'running') {
      status('A run is already going. Stop it first.');
      return;
    }
    const queue = [...usernames];
    const capabilityId = globalThis.crypto?.randomUUID?.()
      || `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    batchAbort = false;
    setRun({
      status: 'running',
      kind: 'account',
      action,
      queue,
      total: queue.length,
      completed: 0,
      skipped: 0,
      failed: 0,
      current: '',
      stopReason: null,
      approvedTargets: [...queue],
      capabilityDigest: accountCapabilityDigest(action, queue),
      capabilityExpiresAt: Date.now() + RUN_CAPABILITY_MS,
      capabilityId,
      results: [],
    });
    await continueAccountRun();
  }

  // --- Section 2: current Instagram context -------------------------------
  //
  // A first-time user cannot tell why a button is inert. Reading the route and
  // session on every render, and naming exactly one useful next action, removes
  // the guesswork. This only describes state; it never unlocks anything.

  function followerListTypeFromText(value) {
    const label = String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();
    if (/^followers(?:\s|$)/.test(label)) return 'followers';
    if (/^following(?:\s|$)/.test(label)) return 'following';
    return '';
  }

  function openFollowerListContext() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const heading = [...dialog.querySelectorAll('[role="heading"], h1, h2')]
        .map(visibleText)
        .find(Boolean);
      const firstLine = visibleText(dialog).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      const observedTypes = new Set(
        [dialog.getAttribute('aria-label'), heading, firstLine]
          .map(followerListTypeFromText)
          .filter(Boolean),
      );
      if (observedTypes.size !== 1) continue;
      const [observed] = observedTypes;
      if (observed === 'followers') return { dialog, listType: 'followers', label: 'Followers' };
      if (observed === 'following') return { dialog, listType: 'following', label: 'Following' };
    }
    return null;
  }

  function currentContext() {
    const session = engine.inspectSession?.() || {};
    if (session.sessionExpired) {
      return { tone: 'blocked', title: 'Signed out', detail: 'Sign in to Instagram again, then reopen this panel.' };
    }
    if (session.challenge) {
      return { tone: 'blocked', title: 'Instagram wants a security check', detail: 'Finish the check on the page. Runs stay stopped until it clears.' };
    }
    if (session.actionBlocked) {
      return { tone: 'blocked', title: 'Action blocked', detail: 'Instagram is refusing actions on this account right now. Wait before trying again.' };
    }
    if (session.rateLimited) {
      return { tone: 'blocked', title: 'Rate limited', detail: 'Instagram is throttling this account. Runs stop until it passes.' };
    }

    const path = location.pathname.toLowerCase();
    if (path.startsWith('/direct/t/')) {
      return {
        tone: 'ready',
        title: 'Conversation open',
        detail: 'DM Unsend is ready for this conversation.',
        view: 'messages',
      };
    }
    if (path.startsWith('/direct')) {
      return { tone: 'warning', title: 'Inbox open', detail: 'Open a single conversation to use Unsend.' };
    }
    const followerList = openFollowerListContext();
    if (followerList) {
      return {
        tone: 'ready',
        title: `${followerList.label} list open`,
        detail: 'Manual capture is optional.',
        view: 'checker',
      };
    }
    const username = engine.normalizeUsername?.(location.pathname) || '';
    if (username) {
      return {
        tone: 'ready',
        title: `Profile: @${username}`,
        detail: 'Check both lists without opening them.',
        view: 'checker',
      };
    }
    return {
      tone: 'warning',
      title: 'Nothing to work on here',
      detail: 'Open your profile, a follower list, or a conversation.',
    };
  }

  function renderContext() {
    const context = currentContext();
    const strip = query('[data-role="context"]');
    if (!strip) return;
    const blockedContext = context.tone === 'blocked';
    strip.dataset.tone = blockedContext ? 'blocked' : contextStatus?.tone || context.tone;
    setText('context-title', context.title);
    setText('context-detail', blockedContext ? context.detail : contextStatus?.message || context.detail);
    const cta = query('[data-role="context-cta"]');
    if (cta) {
      const show = Boolean(context.cta) && state.run?.status !== 'running';
      cta.hidden = !show;
      if (show) {
        cta.textContent = context.cta.label;
        cta.dataset.ctaAction = context.cta.action;
        cta.dataset.ctaView = context.view || '';
      } else {
        delete cta.dataset.ctaAction;
        delete cta.dataset.ctaView;
      }
    }
  }

  // --- Section 3: guided scan sequence ------------------------------------

  function scanState(listType) {
    const count = state.capture[listType].length;
    if (state.capture.verified?.[listType] !== true) return count ? 'partial' : 'todo';
    return state.capture.complete?.[listType] === true ? 'done' : 'partial';
  }

  function renderCheckerSteps() {
    const comparison = compareCapture({ allowPartial: true });
    const summary = engine.followerComparisonSummary(state.capture);
    for (const listType of ['following', 'followers']) {
      const step = query(`.step[data-step="${listType}"]`);
      const status = scanState(listType);
      const verified = state.capture.verified?.[listType] === true;
      if (step) step.dataset.state = status;
      const count = state.capture[listType].length;
      setText(`step-${listType}`,
        status === 'todo' ? 'Not scanned yet'
          : !verified ? `${formatCount(count)} stored — rescan required`
          : status === 'done' ? `${formatCount(count)} found — complete`
            : `${formatCount(count)} accessible accounts found — partial`);
      const button = query(`[data-action="scan-${listType}"]`);
      const listLabel = listType === 'following' ? 'Following' : 'Followers';
      if (button) button.textContent = `${status === 'todo' ? 'Scan' : 'Rescan'} ${listLabel}`;
    }
    const compareStep = query('.step[data-step="compare"]');
    const both = state.capture.verified?.following === true
      && state.capture.verified?.followers === true;
    const complete = scanState('following') === 'done' && scanState('followers') === 'done';
    if (compareStep) compareStep.dataset.state = both ? (complete ? 'done' : 'partial') : 'todo';
    setText('step-compare', summary.available
      ? `${formatCount(comparison.mutuals.length)} mutual · ${formatCount(comparison.notFollowingMeBack.length)} ${summary.labels.notFollowingMeBack.toLowerCase()}`
      : 'Scan both lists to compare');
  }

  function resetRelationshipProgress() {
    relationshipProgress = {
      expectedCounts: { followers: null, following: null },
      found: { followers: 0, following: 0 },
    };
  }

  function scanProgressPercent(found, expectedCounts, complete = false) {
    const types = ['followers', 'following'];
    const knownTypes = types.filter((type) => Number.isSafeInteger(expectedCounts?.[type]));
    if (!knownTypes.length) return complete ? 100 : null;
    const total = knownTypes.reduce((sum, type) => sum + expectedCounts[type], 0);
    if (total === 0) return complete ? 100 : 0;
    const loaded = knownTypes.reduce(
      (sum, type) => sum + Math.min(expectedCounts[type], Math.max(0, Number(found?.[type]) || 0)),
      0,
    );
    const percent = Math.floor((loaded / total) * 100);
    return complete ? 100 : Math.min(99, Math.max(0, percent));
  }

  function showScanProgress(
    listType,
    found,
    complete,
    settled = false,
    expectedCount = null,
    expectedCounts = null,
  ) {
    const panel = query('[data-role="scan-progress"]');
    if (!panel) return;
    if (!relationshipProgress) resetRelationshipProgress();
    if (expectedCounts && typeof expectedCounts === 'object') {
      for (const type of ['followers', 'following']) {
        if (Number.isSafeInteger(expectedCounts[type])) {
          relationshipProgress.expectedCounts[type] = expectedCounts[type];
        }
      }
    }
    if (listType === 'followers' || listType === 'following') {
      relationshipProgress.found[listType] = Math.max(
        relationshipProgress.found[listType],
        Math.max(0, Number(found) || 0),
      );
      if (Number.isSafeInteger(expectedCount)) {
        relationshipProgress.expectedCounts[listType] = expectedCount;
      }
    }
    panel.hidden = false;
    const fill = query('[data-role="scan-fill"]');
    const bar = query('[data-role="scan-bar"]');
    const percent = scanProgressPercent(
      relationshipProgress.found,
      relationshipProgress.expectedCounts,
      complete,
    );
    if (fill) fill.style.width = percent === null ? '100%' : `${percent}%`;
    if (bar) {
      bar.dataset.indeterminate = String(percent === null);
      if (percent === null) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(percent));
      bar.setAttribute(
        'aria-valuetext',
        settled
          ? complete ? 'Mutual check complete' : 'Mutual check finished with a partial result'
          : percent === null
            ? `Scanning ${listType || 'accounts'}; total unknown`
            : `${percent}% of the expected accounts read`,
      );
    }
    setText('scan-detail', complete
      ? `Scanned ${found} ${listType} — complete.`
      : settled
        ? `Scanned ${found} ${listType} — incomplete.`
        : `Scanning ${listType}… ${formatCount(found)} found so far.`);
  }

  function completedRelationshipScanDetail(result) {
    const complete = result?.complete?.followers === true && result?.complete?.following === true;
    return `Checked ${formatCount(result?.followers?.length)} followers and ${formatCount(result?.following?.length)} following — ${complete ? 'complete' : 'partial'}.`;
  }

  function failedRelationshipScanDetail(error) {
    if (error?.code === 'stopped') return 'Mutual check stopped. Saved comparison unchanged.';
    const message = safeText(error?.message, 'Instagram did not return readable relationship data.');
    return `Mutual check failed: ${message} Saved comparison unchanged.`;
  }

  function settleFailedRelationshipProgress(error) {
    const bar = query('[data-role="scan-bar"]');
    const fill = query('[data-role="scan-fill"]');
    if (fill) fill.style.width = '0%';
    if (!bar) return;
    bar.dataset.indeterminate = 'false';
    bar.removeAttribute('aria-valuenow');
    bar.setAttribute(
      'aria-valuetext',
      error?.code === 'stopped' ? 'Mutual check stopped' : 'Mutual check failed',
    );
  }

  async function scanInto(listType) {
    if (inboxPanel?.busy()) throw new Error('Stop inbox cleanup before scanning a list.');
    const select = query('[data-role="list-type"]');
    if (select) select.value = listType;
    resetRelationshipProgress();
    showScanProgress(listType, 0, false);
    const outcome = await actions['scan-list']();
    if (!outcome?.applied) {
      const detail = safeText(outcome?.detail, `The ${listType} scan did not start.`);
      const bar = query('[data-role="scan-bar"]');
      const fill = query('[data-role="scan-fill"]');
      if (bar) {
        bar.dataset.indeterminate = 'false';
        bar.removeAttribute('aria-valuenow');
        bar.setAttribute('aria-valuetext', detail);
      }
      if (fill) fill.style.width = '0%';
      setText('scan-detail', detail);
      renderAll();
      return;
    }
    showScanProgress(
      listType,
      outcome.found,
      outcome.complete,
      true,
      outcome.expectedCount,
    );
    renderAll();
  }

  async function checkAccountRelationships() {
    if (inboxPanel?.busy()) { status('Stop inbox cleanup before checking mutuals.'); return; }
    if (presencePanel?.busy()) { status('Pause or stop Presence before checking mutuals.'); return; }
    if (relationshipController) {
      relationshipController.abort();
      status('Stopping the mutual check. Saved comparison data was not changed.');
      return;
    }
    if (typeof engine?.fetchFollowerComparison !== 'function') {
      status('Reload Instagram to activate Mutual Checker.');
      return;
    }
    const input = query('[data-role="checker-username"]');
    const username = engine.normalizeUsername(input?.value)
      || engine.detectAuthenticatedUsername?.()
      || '';
    if (!username) {
      status('Enter the Instagram username whose Followers and Following should be checked.');
      input?.focus();
      return;
    }
    if (input) input.value = username;
    const controller = new AbortController();
    relationshipController = controller;
    invalidatePresence();
    resetRelationshipProgress();
    renderAll();
    showScanProgress(null, 0, false);
    setText('scan-detail', `Finding the exact @${username} account…`);
    try {
      const result = await (presenceInputs
        ? options => presenceInputs.captureComparison(options)
        : options => engine.fetchFollowerComparison(options))({
        username,
        retryRateLimits: true,
        signal: controller.signal,
        onProgress(progress) {
          if (relationshipController !== controller) return;
          if (progress.phase === 'cooldown') {
            const seconds = Math.ceil(progress.remainingMs / 1000);
            const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
            setText('scan-detail', `Instagram rate limit. Retrying in ${clock}. ${progress.cooldownSource === 'server' ? 'Wait supplied by Instagram.' : 'Automatic backoff; Instagram gave no reset time.'} Stop cancels the retry.`);
            return;
          }
          if (progress.phase === 'resolving') {
            setText('scan-detail', `Finding the exact @${username} account…`);
            return;
          }
          if (progress.phase === 'verifying-profile') {
            setText('scan-detail', `Reading the exact @${username} profile totals…`);
            return;
          }
          if (progress.phase === 'counts-ready') {
            showScanProgress(null, 0, false, false, null, progress.expectedCounts);
            setText(
              'scan-detail',
              `Instagram reports ${formatCount(progress.expectedCounts?.followers)} followers and ${formatCount(progress.expectedCounts?.following)} following.`,
            );
            return;
          }
          if (progress.phase === 'revalidating-profile') {
            setText('scan-detail', `Confirming @${username}'s profile totals did not change…`);
            return;
          }
          if (progress.phase === 'retrying') {
            const label = progress.listType || 'account lookup';
            if (progress.listType) {
              showScanProgress(
                progress.listType,
                progress.found,
                false,
                false,
                progress.expectedCount,
              );
            }
            setText(
              'scan-detail',
              `Retrying ${label}: attempt ${progress.attempt} of ${progress.maxAttempts} in ${(progress.retryDelayMs / 1_000).toFixed(1)}s. ${progress.found} accounts from ${progress.pages} completed pages are preserved.`,
            );
            return;
          }
          if (progress.listType) {
            showScanProgress(
              progress.listType,
              progress.found,
              false,
              false,
              progress.expectedCount,
            );
          }
        },
      });
      const previousCapture = state.capture;
      const nextCapture = {
        ...stateDefaults().capture,
        subjectUsername: result.username,
        ...(normalizeObservedInstagramId(result.subjectInstagramId)
          ? { subjectInstagramId: normalizeObservedInstagramId(result.subjectInstagramId) } : {}),
        followers: normalizeAccounts(result.followers),
        following: normalizeAccounts(result.following),
        capturedAt: { followers: result.capturedAt, following: result.capturedAt },
        complete: { ...result.complete },
        verified: { followers: true, following: true },
        source: { followers: 'authenticated-web', following: 'authenticated-web' },
        ...engine.normalizeFollowerDiagnostics(result),
      };
      state.capture = nextCapture;
      try {
        saveState();
      } catch (error) {
        state.capture = previousCapture;
        throw error;
      }
      if (!controller.signal.aborted) presenceCapture = result;
      const partialDetails = [];
      for (const [listType, accounts] of [
        ['followers', result.followers],
        ['following', result.following],
      ]) {
        const label = listType === 'followers' ? 'Followers' : 'Following';
        const reason = result.reasons[listType];
        const expected = result.expectedCounts[listType];
        if (reason === 'instagram-limited-list' && Number.isSafeInteger(expected)) {
          partialDetails.push(`${label}: Instagram limited this list to ${accounts.length.toLocaleString('en-US')} of ${expected.toLocaleString('en-US')} accounts.`);
        } else if (reason === 'cursor-missing') {
          partialDetails.push(`${label}: Instagram ended pagination without returning the next page.`);
        } else if (reason === 'count-mismatch' && Number.isSafeInteger(expected)) {
          const difference = expected - accounts.length;
          partialDetails.push(difference > 0
            ? `${label}: Instagram returned ${accounts.length.toLocaleString('en-US')} of ${expected.toLocaleString('en-US')}; ${difference.toLocaleString('en-US')} were not returned.`
            : `${label}: the API returned ${accounts.length.toLocaleString('en-US')} unique accounts while the profile shows ${expected.toLocaleString('en-US')}.`);
        } else if (reason === 'count-changed') {
          partialDetails.push(`${label}: the profile total changed during the check.`);
        } else if (reason === 'profile-count-disagreement') {
          partialDetails.push(`${label}: Instagram's profile counters disagreed.`);
        }
      }
      const mismatch = ` ${partialDetails.join(' ') || 'A bounded read limit was reached.'}`;
      status(
        `Checked @${result.username}: ${result.followers.length.toLocaleString('en-US')} followers and ${result.following.length.toLocaleString('en-US')} following.${result.complete.followers && result.complete.following ? '' : mismatch}`,
      );
      relationshipProgress.found.followers = result.followers.length;
      relationshipProgress.found.following = result.following.length;
      showScanProgress(
        null,
        result.followers.length + result.following.length,
        result.complete.followers && result.complete.following,
        true,
        null,
        result.expectedCounts,
      );
      setText('scan-detail', completedRelationshipScanDetail(result));
    } catch (error) {
      const detail = failedRelationshipScanDetail(error);
      settleFailedRelationshipProgress(error);
      setText('scan-detail', detail);
      status(detail);
    } finally {
      if (relationshipController === controller) relationshipController = null;
      renderAll();
    }
  }


  // --- Sections 4 and 5: show the targets before anything runs ------------

  function renderRunReview(items, { omitted = 0, removed = 0, skippedReasons = [], partial = false } = {}) {
    const panel = query('[data-role="run-review"]');
    if (!panel) return;
    panel.hidden = !items.length;
    if (!items.length) return;
    setText('review-title', `${items.length} account${items.length === 1 ? '' : 's'} queued`);
    const list = query('[data-role="review-list"]');
    if (list) {
      list.replaceChildren();
      for (const item of items) {
        const row = document.createElement('li');
        row.textContent = `@${item.username}`;
        list.append(row);
      }
      for (const entry of skippedReasons) {
        const skipped = document.createElement('li');
        skipped.textContent = `${entry.count} skipped — ${entry.reason}`;
        list.append(skipped);
      }
    }
    // Naming why targets were dropped is the difference between a trustworthy
    // count and a surprising one.
    setText(
      'review-skips',
      `${partial ? 'Partial comparison: some targets may still be mutuals. ' : ''}Duplicates or already-correct targets removed: ${removed}. Outside this run: ${omitted}. Protected or incompatible targets skipped: ${skippedReasons.reduce((total, entry) => total + entry.count, 0)}. Every profile is rechecked before action.`,
    );
  }

  function compatibleAccountSources(action) {
    return action === 'follow'
      ? [
        ['current-profile', 'Current profile'],
        ['i-do-not-follow-back', 'Followers you do not follow'],
        ['scanned-followers', 'Scanned Followers'],
        ['queue', 'Queue items'],
      ]
      : [
        ['current-profile', 'Current profile'],
        ['not-following-me-back', "People who don't follow you back"],
        ['scanned-following', 'Scanned Following'],
        ['queue', 'Queue items'],
      ];
  }

  function syncAccountComposer() {
    const action = query('[data-role="bot-action"]')?.value === 'unfollow' ? 'unfollow' : 'follow';
    const source = query('[data-role="bot-source"]');
    if (!source) return;
    const previous = source.value;
    const options = compatibleAccountSources(action);
    source.replaceChildren();
    for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      source.append(option);
    }
    source.value = options.some(([value]) => value === previous) ? previous : options[0][0];
    const currentProfile = source.value === 'current-profile';
    const countField = query('[data-role="bot-count-field"]');
    if (countField) countField.hidden = currentProfile;
    const count = query('[data-role="bot-count"]');
    if (currentProfile && count) count.value = '1';
  }

  function accountRunPlan() {
    const action = query('[data-role="bot-action"]')?.value === 'follow' ? 'follow' : 'unfollow';
    const source = query('[data-role="bot-source"]')?.value || 'current-profile';
    const requestedCount = clampNumber(query('[data-role="bot-count"]')?.value, [1, 250], 20);
    const count = source === 'current-profile' ? 1 : requestedCount;
    const comparison = compareCapture({ allowPartial: true });
    const names = (list) => (list || []).map((entry) => entry.username || entry).filter(Boolean);
    const skippedReasons = [];
    const requiredLists = source === 'scanned-followers'
      ? ['followers']
      : source === 'scanned-following'
        ? ['following']
        : ['i-do-not-follow-back', 'not-following-me-back'].includes(source)
          ? ['followers', 'following']
          : [];
    const authenticatedUsername = engine.normalizeUsername?.(
      engine.detectAuthenticatedUsername?.(),
    ) || '';
    const captureSubject = engine.normalizeUsername?.(state.capture.subjectUsername) || '';
    const captureBoundToAccount = Boolean(
      captureSubject && authenticatedUsername && captureSubject === authenticatedUsername,
    );
    const captureReady = requiredLists.length === 0 || (
      captureBoundToAccount
      && requiredLists.every((listType) => (
        state.capture.verified?.[listType] === true
      ))
    );
    const capturePool = (list) => {
      if (captureReady) return names(list);
      const reason = captureBoundToAccount
        ? 'Scan the required lists in Mutual Checker before creating account actions.'
        : 'Run Mutual Checker for your signed-in account before creating account actions.';
      if (!skippedReasons.some((entry) => entry.reason === reason)) {
        skippedReasons.push({
          count: 0,
          reason,
        });
      }
      return [];
    };
    const pools = {
      'current-profile': () => {
        const username = engine.normalizeUsername?.(location.pathname) || '';
        if (!username) return [];
        const observation = engine.inspectProfile?.(username) || {};
        const alreadyCorrect = action === 'follow'
          ? ['following', 'requested'].includes(observation.relationship)
          : observation.relationship === 'not-following';
        if (alreadyCorrect) {
          skippedReasons.push({ count: 1, reason: `@${username} already has the requested relationship.` });
          return [];
        }
        return [username];
      },
      queue: () => {
        const queue = state.queue.queue || [];
        const protectedCount = queue.filter((entry) => entry.status === 'protected').length;
        const incompatibleCount = queue.filter((entry) => (
          ACTIONABLE_STATUSES.has(entry.status) && entry.action !== action
        )).length;
        if (protectedCount) skippedReasons.push({ count: protectedCount, reason: 'Protected queue items stay excluded.' });
        if (incompatibleCount) skippedReasons.push({ count: incompatibleCount, reason: 'Queue items for the opposite action were excluded.' });
        return queue
          .filter((entry) => ACTIONABLE_STATUSES.has(entry.status) && entry.action === action)
          .map((entry) => entry.account?.username)
          .filter(Boolean);
      },
      'i-do-not-follow-back': () => capturePool(comparison.iDoNotFollowBack),
      'not-following-me-back': () => capturePool(comparison.notFollowingMeBack),
      'scanned-followers': () => capturePool(verifiedCapture('followers')),
      'scanned-following': () => capturePool(verifiedCapture('following')),
    };
    const pool = (pools[source] || pools['current-profile'])();
    let eligible = pool;
    const verifiedFollowing = completeCapture('following');
    if (source !== 'current-profile' && action === 'follow' && verifiedFollowing.length) {
      const already = new Set(names(verifiedFollowing));
      eligible = eligible.filter((username) => !already.has(username));
    }
    const unique = [...new Set(eligible)];
    const items = unique.slice(0, count).map((username) => ({ username }));
    const partial = captureReady && requiredLists.some((listType) => state.capture.complete?.[listType] !== true);
    return Object.freeze({
      action,
      items: Object.freeze(items),
      omitted: Math.max(0, unique.length - items.length),
      removed: Math.max(0, pool.length - unique.length),
      requested: count,
      partial,
      skippedReasons: Object.freeze(skippedReasons),
      signature: JSON.stringify({ action, count, source, usernames: items.map((item) => item.username), partial }),
      source,
    });
  }

  function renderAccountRunPrimary() {
    const button = query('[data-role="account-run-primary"]');
    if (!button) return;
    if (accountRunDraft) {
      button.dataset.action = 'run-accounts';
      const label = accountRunDraft.action === 'follow' ? 'Follow' : 'Unfollow';
      button.textContent = `Start ${label} on ${accountRunDraft.items.length} account${accountRunDraft.items.length === 1 ? '' : 's'}`;
      button.classList.add('danger');
      button.classList.remove('primary');
      const preview = accountRunDraft.items.slice(0, 3).map((item) => `@${item.username}`).join(', ');
      setText('account-run-summary', `Reviewed: ${preview}${accountRunDraft.items.length > 3 ? `, +${accountRunDraft.items.length - 3} more` : ''}. Every profile is rechecked before action.`);
    } else {
      button.dataset.action = 'review-accounts';
      button.disabled = false;
      const plan = accountRunPlan();
      const label = plan.action === 'follow' ? 'Follow' : 'Unfollow';
      button.textContent = `Review ${plan.requested} ${label} target${plan.requested === 1 ? '' : 's'}`;
      button.classList.add('primary');
      button.classList.remove('danger');
      setText('account-run-summary', 'Choose a source, then review the accounts.');
    }
  }

  function clearAccountRunDraft() {
    accountRunDraft = null;
    syncAccountComposer();
    renderRunReview([]);
    renderAccountRunPrimary();
  }

  function reviewAccountRun() {
    const plan = accountRunPlan();
    if (!plan.items.length) {
      clearAccountRunDraft();
      status(
        plan.skippedReasons[0]?.reason
          || (plan.source === 'current-profile'
          ? 'Open one Instagram profile first. No target was reviewed.'
          : plan.source.startsWith('scanned')
          ? 'That list is empty. Open the list you want and scan it in the checker first.'
          : 'No targets. Scan both lists in the checker first, or import a queue.'),
      );
      return;
    }
    accountRunDraft = plan;
    renderRunReview(plan.items, plan);
    renderAccountRunPrimary();
    renderShellState();
    const start = query('[data-role="account-run-primary"]');
    const scroll = start?.closest('.scroll');
    const startRect = start?.getBoundingClientRect?.();
    const scrollRect = scroll?.getBoundingClientRect?.();
    if (startRect && scrollRect && startRect.bottom > scrollRect.bottom - 12) {
      scroll.scrollTop += startRect.bottom - scrollRect.bottom + 12;
    }
    start?.focus?.({ preventScroll: true });
    status(`Reviewed ${plan.items.length} ${plan.action} target${plan.items.length === 1 ? '' : 's'}. Nothing has run.`);
  }

  function renderDmSummary() {
    const summary = query('[data-role="dm-summary"]');
    const primary = query('[data-role="unsend-primary"]');
    const found = Number(dmThreadPreview?.detectedCount ?? dmThreadPreview?.eligibleCount) || 0;
    const checked = dmThreadPreview?.ready === true
      && dmThreadPreview.threadId === currentDirectThreadId();
    const active = Boolean(dmCleanupController)
      || ['preparing', 'running', 'waiting', 'stopping'].includes(dmRunnerSnapshot?.status);
    if (summary) {
      const finished = dmRunnerSnapshot?.status === 'completed';
      const needsAttention = dmRunnerSnapshot?.status === 'needs-attention';
      const failed = dmRunnerSnapshot?.status === 'error';
      const stopped = dmRunnerSnapshot?.status === 'stopped';
      summary.hidden = !checked && !finished && !needsAttention && !failed && !stopped;
      setText('dm-summary-title', found
        ? `At least ${found} sent message${found === 1 ? '' : 's'} detected`
        : 'No sent messages found');
      setText('dm-summary-detail', !found
        ? 'No messages in this thread were identified as yours.'
        : 'Read-only estimate. Instagram may load more while Unsend runs.');
      if (finished) {
        setText('dm-summary-title', `${Number(dmRunnerSnapshot.processed) || 0} unsent`);
        setText('dm-summary-detail', cleanupPreferences.showSummary ? dmRunnerSnapshot.message : '');
      } else if (needsAttention || failed || stopped) {
        const uncertain = Math.max(0, Number(dmRunnerSnapshot.uncertain) || 0);
        const outcome = needsAttention || uncertain ? 'Needs attention' : failed ? 'Stopped with an error' : 'Stopped';
        setText('dm-summary-title', `${Number(dmRunnerSnapshot.processed) || 0} unsent · ${outcome}`);
        setText('dm-summary-detail', [dmRunnerSnapshot.message, uncertain ? `${uncertain} outcome uncertain.` : ''].filter(Boolean).join(' '));
      }
      if (reactionSnapshot && reactionSnapshot.status !== 'idle') {
        summary.hidden = false;
        const count = Number(reactionSnapshot.removed) || 0;
        setText('dm-summary-title', `${Number(dmRunnerSnapshot?.processed) || 0} unsent · ${count} reaction${count === 1 ? '' : 's'} removed`);
        setText('dm-summary-detail', reactionSnapshot.message);
      }
    }
    // Never hidden. Progressive disclosure applies to secondary controls, not
    // to the action the tool exists for.
    if (primary) {
      primary.hidden = false;
      primary.textContent = active ? (reactionSnapshot?.canStop ? 'Stop reaction cleanup' : 'Stop DM Unsend') : 'Unsend DMs';
      primary.disabled = active
        ? (dmCleanupController ? dmCleanupController.signal.aborted : dmRunnerSnapshot?.canStop !== true)
        : !currentDirectThreadId();
    }
    const scope = query('[data-role="unsend-scope"]')?.value || 'all';
    const countField = query('[data-role="unsend-count-field"]');
    if (countField) countField.hidden = scope === 'all';
  }

  async function scanSentConversation() {
    if (inboxPanel?.busy()) throw new Error('Stop inbox cleanup before checking the conversation.');
    if (dmCleanupController) throw new Error('Stop cleanup before checking the conversation.');
    if (!dmRunner) throw new Error('Reload Instagram to load the DM Unsend runner.');
    status('Checking this conversation for messages you sent. Nothing will be removed.');
    const outcome = await dmRunner.inspectAll();
    dmThreadPreview = outcome?.ready ? outcome : null;
    renderAll();
    const detected = Number(outcome?.detectedCount ?? outcome?.eligibleCount) || 0;
    status(outcome?.ready
      ? detected > 0
        ? `Detected at least ${detected} sent message${detected === 1 ? '' : 's'}. No menus opened.`
        : 'No sent messages found. No menus opened.'
      : outcome?.reason || 'Could not check this conversation.');
    return outcome;
  }

  async function runDmUnsend() {
    if (inboxPanel?.busy()) { inboxPanel.stop(); return; }
    if (typeof presencePanel !== 'undefined' && presencePanel?.busy()) {
      status('Pause or stop Presence before using DM Unsend.');
      return;
    }
    if (!dmRunner) throw new Error('Reload Instagram to load the DM Unsend runner.');
    if (stopDmCleanup()) return;
    if (confirmationController?.isPending()) return;
    const snapshot = dmRunner.snapshot();
    if (snapshot.canStop || ['preparing', 'running', 'waiting', 'stopping'].includes(snapshot.status)) {
      dmRunner.stop();
      return;
    }
    const inspection = dmRunner.inspect();
    if (!inspection?.ready) throw new Error(inspection?.reason || 'Open a conversation first.');
    const scope = query('[data-role="unsend-scope"]')?.value || 'all';
    const requested = Math.floor(Number(query('[data-role="unsend-count"]')?.value) || 1);
    const speed = 'standard';
    const removeReactions = cleanupSettings.capabilities('userscript').reactions
      && query('[data-role="unsend-reactions"]')?.checked === true;
    const viewer = removeReactions ? globalThis.InstaToolboxInstagramViewer?.inspect() : null;
    if (removeReactions && (!reactionCleanup || viewer?.accountVerified !== true
      || viewer.usable !== true || viewer.threadId !== inspection.threadId)) {
      throw new Error('Your account could not be verified for reaction cleanup.');
    }
    const limit = scope === 'all' ? null : Math.max(1, requested);
    const plan = dmRunner.createPlan({
      threadId: inspection.threadId,
      speed,
      scope,
      limit,
      detectedCount: Number(dmThreadPreview?.detectedCount ?? dmThreadPreview?.eligibleCount) || null,
      expiresAt: Date.now() + DM_PLAN_CAPABILITY_MS,
    });
    if (!plan) throw new Error('The Unsend plan could not be created. Keep this conversation open and try again.');
    const reactionPlan = removeReactions ? globalThis.InstaToolboxOwnReactions.createPlan({
      threadId: plan.threadId, accountUsername: viewer.accountId, expiresAt: plan.expiresAt,
    }) : null;
    if (removeReactions && !reactionPlan) throw new Error('Reaction cleanup could not be prepared.');
    const scopeLabel = scope === 'all'
      ? 'every message you sent'
      : `the ${scope} ${limit} message${limit === 1 ? '' : 's'} you sent`;
    const confirmation = await confirmRun({
      title: 'Unsend DMs?',
      message: `Permanently unsend ${scopeLabel} in this conversation?`,
      detail: removeReactions
        ? 'Then remove your reactions from messages left in this conversation. This cannot be undone. Stop stays available.'
        : 'This cannot be undone. Stop stays available while it runs.',
      confirmLabel: scope === 'all' ? 'Unsend all my messages' : `Unsend ${limit} message${limit === 1 ? '' : 's'}`,
      facts: [
        { label: 'Action', value: 'Permanently unsend messages' },
        { label: 'Conversation', value: `Thread ${plan.threadId}` },
        { label: 'Messages', value: scope === 'all' ? 'All messages you sent' : `${scope} ${limit}` },
        ...(removeReactions ? [{ label: 'Reactions', value: `Remove reactions added by @${viewer.accountId}` }] : []),
      ],
      binding: {
        action: 'unsend',
        speed: plan.speed,
        expiresAt: plan.expiresAt,
        limit: plan.limit,
        reviewedDigest: plan.reviewedDigest,
        scope: plan.scope,
        threadId: plan.threadId,
        removeReactions,
        reactionAccount: viewer?.accountId || null,
      },
    });
    if (!confirmation) {
      status('Canceled. Nothing was removed.');
      return;
    }
    const confirmedInspection = dmRunner.inspect();
    const confirmedScope = query('[data-role="unsend-scope"]')?.value || 'all';
    const confirmedRequested = Math.floor(Number(query('[data-role="unsend-count"]')?.value) || 1);
    const confirmedLimit = confirmedScope === 'all' ? null : Math.max(1, confirmedRequested);
    const confirmedViewer = removeReactions ? globalThis.InstaToolboxInstagramViewer.inspect() : null;
    if (
      !confirmedInspection?.ready
      || confirmedInspection.threadId !== plan.threadId
      || confirmation.action !== 'unsend'
      || confirmation.threadId !== plan.threadId
      || confirmation.scope !== plan.scope
      || confirmation.speed !== plan.speed
      || plan.speed !== 'standard'
      || confirmation.limit !== plan.limit
      || confirmation.reviewedDigest !== plan.reviewedDigest
      || Number(confirmation.expiresAt) !== plan.expiresAt
      || plan.expiresAt <= Date.now()
      || confirmedScope !== plan.scope
      || confirmedLimit !== plan.limit
      || confirmation.removeReactions !== removeReactions
      || (cleanupSettings.capabilities('userscript').reactions
        && query('[data-role="unsend-reactions"]')?.checked === true) !== removeReactions
      || (removeReactions && (confirmation.reactionAccount !== viewer.accountId
        || confirmedViewer.accountId !== viewer.accountId
        || confirmedViewer.accountVerified !== true || confirmedViewer.usable !== true
        || confirmedViewer.threadId !== plan.threadId || confirmedViewer.restriction))
    ) {
      status('The conversation or message selection changed after review. Nothing was removed.', 'blocked');
      return;
    }
    const reservation = reserveUnsendPlan(plan);
    if (!reservation.ok) {
      status(reservation.reason);
      return;
    }
    dmThreadPreview = null;
    reactionSnapshot = null;
    const controller = new AbortController();
    dmCleanupController = controller;
    renderDmSummary();
    try {
      const outcome = await dmRunner.start({
        plan,
        minDelayMs: reservation.minDelayMs,
        maxDelayMs: reservation.maxDelayMs,
        onVerifiedRemoval: (progress) => recordVerifiedUnsend(plan, {
          ...progress,
          status: 'running',
        }),
      });
      finalizeUnsendOutcome(plan, outcome);
      if (reactionPlan && outcome.status === 'completed' && !controller.signal.aborted) {
        let recordedReactions = 0;
        await reactionCleanup.start({ plan: reactionPlan, signal: controller.signal,
          onVerifiedRemoval: async ({ removed }) => {
            const increment = Math.max(0, removed - recordedReactions);
            if (!increment) return;
            const ledger = state.ledger?.day === today()
              ? state.ledger : { day: today(), actions: 0, unsends: 0 };
            ledger.reactions = Number(ledger.reactions || 0) + increment;
            state.ledger = ledger;
            recordedReactions = removed;
            await saveState();
          },
        });
      }
    } finally {
      activeUnsendCapability = null;
      if (dmCleanupController === controller) dmCleanupController = null;
      renderDmSummary();
    }
  }

  function stopDmCleanup() {
    if (!dmCleanupController) return false;
    dmCleanupController.abort('Stopped');
    dmRunner?.stop?.();
    reactionCleanup?.stop?.();
    renderDmSummary();
    return true;
  }


  // --- Section 7: keyboard and screen-reader behaviour --------------------

  function syncTabs(active) {
    const tabs = [...queryAll('[data-view]')];
    for (const tab of tabs) {
      const selected = tab.dataset.view === active;
      tab.setAttribute('aria-selected', String(selected));
      // Roving tabindex: exactly one tab is reachable by Tab, and the arrow
      // keys move between them, which is what a tablist is expected to do.
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of queryAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== active;
    }
  }

  function onTabKeydown(event) {
    const tabs = [...queryAll('[data-view]')];
    const index = tabs.indexOf(event.target.closest('[data-view]'));
    if (index < 0) return;
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    const move = keys[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = move === 'first' ? tabs[0]
      : move === 'last' ? tabs[tabs.length - 1]
        : tabs[(index + move + tabs.length) % tabs.length];
    savePreferences({ view: next.dataset.view });
    syncTabs(next.dataset.view);
    next.focus();
  }

  function currentProfileCaptureSubject() {
    return engine.normalizeUsername?.(location.pathname) || '';
  }

  function prepareCaptureWorkspace(subjectUsername) {
    const currentSubject = engine.normalizeUsername?.(state.capture.subjectUsername) || '';
    const hasAuthenticatedData = state.capture.source?.followers === 'authenticated-web'
      || state.capture.source?.following === 'authenticated-web';
    if (hasAuthenticatedData || currentSubject !== subjectUsername) {
      state.capture = stateDefaults().capture;
    }
  }

  function reconciledRelationshipAccounts(existing, incoming, complete) {
    const merged = new Map(
      (complete === true ? [] : normalizeAccounts(existing))
        .map((account) => [account.username, account]),
    );
    for (const account of normalizeAccounts(incoming)) merged.set(account.username, account);
    return [...merged.values()];
  }

  const actions = {
    'confirm-cancel': () => confirmationController?.cancel(),
    'close-settings': () => setSettingsOpen(false),
    'check-account-relationships': () => checkAccountRelationships(),
    'scan-following': () => scanInto('following'),
    'scan-followers': () => scanInto('followers'),
    'context-cta': () => {
      const cta = query('[data-role="context-cta"]');
      const target = cta?.dataset.ctaAction;
      const view = cta?.dataset.ctaView;
      if (view) savePreferences({ view });
      if (target && actions[target]) actions[target]();
    },
    'open-settings': () => setSettingsOpen(true),
    'review-accounts': () => reviewAccountRun(),
    open: () => savePreferences({ open: true }),
    close: () => {
      confirmationController?.cancel();
      savePreferences({ open: false });
    },
    'stop-run': () => {
      if (presenceSession?.stop()) {
        status('Stopping Presence after the current step.');
        return;
      }
      if (stopDmCleanup()) return;
      if (dmRunner?.stop?.()) {
        status('Stopping DM Unsend after the current step.');
        return;
      }
      batchAbort = true;
      // Clearing the queue is what actually stops a resumable account run; the
      // in-memory flag alone would not survive the next page load.
      setRun({
        status: 'aborted', stopReason: 'stopped by you', nextAt: null, current: '', queue: [],
      });
      status('Run stopped. It will not resume.');
    },
    'scan-list': async () => {
      if (inboxPanel?.busy()) throw new Error('Stop inbox cleanup before scanning a list.');
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      status(`Scanning the open ${listType} list. Keep the dialog open.`);
      const outcome = await engine.collectAccountList({ listType });
      const stopReason = sessionStop(outcome);
      if (stopReason) {
        const detail = `Stopped: ${stopReason}.`;
        status(detail);
        return { applied: false, detail };
      }
      const accounts = outcome?.accounts || [];
      if (outcome?.listType !== listType) {
        const detail = `No verified ${listType} dialog was open. Open that exact list and scan again.`;
        status(detail);
        return { applied: false, detail };
      }
      if (!accounts.length) {
        const detail = `No rows were readable. Open your ${listType} list first.`;
        status(detail);
        return { applied: false, detail };
      }
      const subjectUsername = currentProfileCaptureSubject();
      prepareCaptureWorkspace(subjectUsername);
      state.capture[listType] = reconciledRelationshipAccounts(
        verifiedCapture(listType),
        accounts,
        outcome.complete === true,
      );
      state.capture.capturedAt[listType] = nowIso();
      state.capture.complete = { ...(state.capture.complete || {}), [listType]: outcome.complete === true };
      state.capture.verified = { ...(state.capture.verified || {}), [listType]: true };
      state.capture.source = { ...(state.capture.source || {}), [listType]: 'list-dialog' };
      state.capture.subjectUsername = subjectUsername;
      saveState();
      renderAll();
      const mismatch = outcome?.reason === 'list-count-mismatch'
        && Number.isSafeInteger(outcome.expectedCount);
      status(
        `Scanned ${accounts.length} ${listType} rows.${outcome.complete
          ? ''
          : mismatch
            ? ` Instagram reports ${outcome.expectedCount}, so this capture stays incomplete.`
            : outcome?.reason === 'list-count-changed'
              ? ' The profile count changed during the scan, so this capture stays incomplete.'
              : ' The list did not reach its end, so some may be missing.'}`,
      );
      return {
        applied: true,
        complete: outcome.complete === true,
        expectedCount: outcome.expectedCount,
        found: state.capture[listType].length,
      };
    },
    'scan-sent': () => scanSentConversation(),
    'run-accounts': async () => {
      if (inboxPanel?.busy()) { status('Inbox cleanup is active. Use Stop all to end it.'); return; }
      if (presencePanel?.busy()) { status('Pause or stop Presence before starting Follow / Unfollow.'); return; }
      if (confirmationController?.isPending()) return;
      const current = accountRunPlan();
      if (!accountRunDraft || accountRunDraft.signature !== current.signature) {
        clearAccountRunDraft();
        status('Targets changed. Review the run again before starting.');
        return;
      }
      const reviewed = accountRunDraft;
      const actionLabel = reviewed.action === 'follow' ? 'Follow' : 'Unfollow';
      const expiresAt = Date.now() + RUN_CAPABILITY_MS;
      const confirmation = await confirmRun({
        title: `${actionLabel} ${reviewed.items.length} reviewed account${reviewed.items.length === 1 ? '' : 's'}?`,
        message: 'Review the exact accounts before starting.',
        detail: `${reviewed.partial ? 'Partial comparison: some targets may still be mutuals. ' : ''}This tab will move between these exact profiles. Each account is revalidated before the action.`,
        confirmLabel: `Start ${actionLabel}`,
        items: reviewed.items.map((item) => `@${item.username}`),
        facts: [
          { label: 'Action', value: actionLabel },
          { label: 'Accounts', value: String(reviewed.items.length) },
        ],
        binding: {
          action: reviewed.action,
          count: reviewed.items.length,
          expiresAt,
          targetDigest: reviewed.signature,
        },
      });
      if (!confirmation) {
        status('Canceled. The reviewed targets were kept. Nothing was changed.');
        return;
      }
      const refreshed = accountRunPlan();
      if (
        !accountRunDraft
        || accountRunDraft.signature !== reviewed.signature
        || refreshed.signature !== reviewed.signature
        || confirmation.action !== reviewed.action
        || confirmation.count !== reviewed.items.length
        || confirmation.targetDigest !== reviewed.signature
        || Number(confirmation.expiresAt) !== expiresAt
        || expiresAt <= Date.now()
      ) {
        clearAccountRunDraft();
        status('Targets changed after review. Review the run again. Nothing was changed.');
        return;
      }
      const approved = reviewed;
      clearAccountRunDraft();
      await startAccountRun({ action: approved.action, usernames: approved.items.map((item) => item.username) });
    },
    'run-unsend': () => runDmUnsend(),
    'save-limits': () => {
      state.limits = {
        ...(state.limits || {}),
        minDelayMs: clampNumber(Number(query('[data-role="limit-min"]')?.value) * 1000, LIMIT_BOUNDS.minDelayMs, 1_000),
        maxDelayMs: clampNumber(Number(query('[data-role="limit-max"]')?.value) * 1000, LIMIT_BOUNDS.maxDelayMs, 2_000),
      };
      saveState();
      status('Pacing saved.');
    },
    'layout-compact': () => savePreferences({ width: 380, height: 520, open: true }),
    'layout-tall': () => savePreferences({
      width: 460,
      height: Math.min(820, Math.max(HEIGHT_MIN, innerHeight - (INSET * 2))),
      open: true,
    }),
    'layout-wide': () => savePreferences({ width: 560, height: 680, open: true }),
    'reset-layout': () => savePreferences({
      width: preferencesDefaults().width,
      height: preferencesDefaults().height,
      position: null,
      launcherPosition: null,
      open: true,
    }),
    'reset-appearance': () => savePreferences(cleanupSettings.normalizeAppearance({})),
    'backup-local': () => downloadJson('insta-toolbox-local-data.json', {
      kind: 'insta-toolbox-local-data', schemaVersion: 1, surface: 'userscript', exportedAt: nowIso(),
      preferences, cleanupPreferences, capture: state.capture, queue: state.queue,
    }),
    'export-diagnostics': () => downloadJson('insta-toolbox-diagnostics.json', {
      kind: 'insta-toolbox-diagnostics', schemaVersion: 1, surface: 'userscript',
      version: typeof GM_info !== 'undefined' ? GM_info.script.version : 'development',
      preferences: cleanupSettings.effective(cleanupPreferences, 'userscript'),
      capabilities: cleanupSettings.capabilities('userscript'),
    }),
    capture: () => {
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      const visible = captureVisibleAccounts(listType);
      if (!visible.length) {
        status(`No verified ${listType} rows were readable. Open that exact list first.`);
        return;
      }
      const subjectUsername = currentProfileCaptureSubject();
      prepareCaptureWorkspace(subjectUsername);
      const before = verifiedCapture(listType).length;
      state.capture[listType] = reconciledRelationshipAccounts(
        verifiedCapture(listType),
        visible,
        false,
      );
      state.capture.capturedAt[listType] = nowIso();
      state.capture.complete = { ...(state.capture.complete || {}), [listType]: false };
      state.capture.verified = { ...(state.capture.verified || {}), [listType]: true };
      state.capture.source = { ...(state.capture.source || {}), [listType]: 'list-dialog' };
      state.capture.subjectUsername = subjectUsername;
      saveState();
      status(`Captured ${visible.length} rendered ${listType} rows; ${state.capture[listType].length - before} were new.`);
    },
    'clear-capture': () => {
      invalidatePresence();
      state.capture = stateDefaults().capture;
      checkerResultKey = '';
      checkerResultLimit = CHECKER_RESULTS_PAGE_SIZE;
      checkerResultAnnouncement = '';
      clearTimeout(checkerResultAnnouncementTimer);
      checkerResultAnnouncementTimer = null;
      relationshipProgress = null;
      const progressPanel = query('[data-role="scan-progress"]');
      const progressBar = query('[data-role="scan-bar"]');
      const progressFill = query('[data-role="scan-fill"]');
      if (progressPanel) progressPanel.hidden = true;
      if (progressFill) progressFill.style.width = '0%';
      if (progressBar) {
        progressBar.dataset.indeterminate = 'false';
        progressBar.removeAttribute('aria-valuenow');
        progressBar.removeAttribute('aria-valuetext');
      }
      saveState();
      status('Mutual Checker cleared.');
    },
    'show-more-comparison': () => {
      const showMore = query('[data-role="comparison-more"]');
      const shouldRestoreFocus = shadow.activeElement === showMore;
      checkerResultLimit += CHECKER_RESULTS_PAGE_SIZE;
      renderChecker();
      if (shouldRestoreFocus && showMore?.hidden) {
        query('[data-role="comparison-count"]')?.focus({ preventScroll: true });
      }
    },
    'download-list': () => {
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      const method = state.capture.source?.[listType] || '';
      downloadJson(`insta-toolbox-visible-${listType}-${Date.now()}.json`, {
        schemaVersion: 1,
        kind: 'insta-toolbox-visible-list',
        listType,
        capturedAt: state.capture.capturedAt[listType] || nowIso(),
        subjectUsername: state.capture.subjectUsername || '',
        verificationMethod: method,
        complete: state.capture.complete?.[listType] === true,
        verifiedDialog: state.capture.verified?.[listType] === true && method !== 'authenticated-web',
        [listType]: state.capture[listType],
        note: method === 'authenticated-web'
          ? 'Read from bounded authenticated Instagram pagination. No follow, unfollow, message, or click action was performed.'
          : 'Only rows rendered in Instagram were captured. Scroll manually and capture again to merge more rows.',
      });
    },
    'download-comparison-json': () => {
      const comparisonReady = engine.followerComparisonSummary(state.capture).available;
      if (!comparisonReady) {
        status('Run Check mutuals to load a comparison.');
        return;
      }
      const generatedAt = nowIso();
      downloadJson(
        `insta-toolbox-mutual-comparison-${generatedAt.replace(/[:.]/g, '-')}.json`,
        engine.followerComparisonRecord(state.capture, compareCapture({ allowPartial: true }), generatedAt),
      );
    },
    'export-queue': () => downloadJson(`insta-toolbox-companion-state-${Date.now()}.json`, {
      schemaVersion: 2,
      kind: 'insta-toolbox-companion-state',
      exportedAt: nowIso(),
      ...state.queue,
    }),
    'open-profile': () => {
      const item = currentQueueItem();
      if (!item) throw new Error('Import a queue before opening a target profile.');
      location.href = `https://www.instagram.com/${encodeURIComponent(item.account.username)}/`;
    },
    'account-dry-run': () => {
      inspectAccountQueueItem();
      status(state.accountCheck.result);
    },
    'queue-complete': () => updateQueue('completed'),
    'queue-skip': () => updateQueue('skipped'),
    'read-messages': () => {
      state.messageEvidence = inspectVisibleMessages();
      saveState();
      status(state.messageEvidence.reason);
    },
    'dm-dry-run': () => {
      state.dmCheck = inspectExactDmTarget();
      state.history.unshift({ kind: 'dm-dry-run', ...state.dmCheck, messageId: state.dmTarget?.messageId || null });
      state.history = state.history.slice(0, 20);
      saveState();
      status(state.dmCheck.reason);
    },
  };

  shadow.addEventListener('click', async (event) => {
    const goView = event.target.closest?.('[data-go-view]');
    if (goView) {
      savePreferences({ view: goView.dataset.goView, open: true });
      return;
    }
    const tab = event.target.closest?.('[data-view]');
    if (tab) {
      savePreferences({ view: tab.dataset.view });
      return;
    }
    const target = event.target.closest?.('[data-action]');
    if (!target) return;
    try {
      await actions[target.dataset.action]?.();
      renderAll();
    } catch (error) {
      status(`Stopped: ${error.message}`);
    }
  });

  shadow.addEventListener('change', async (event) => {
    try {
      if (event.target.matches('[data-role="bot-source"], [data-role="bot-action"], [data-role="bot-count"]')) {
        clearAccountRunDraft();
        status('Run choices changed. Review the targets again.');
        return;
      }
      if (event.target.matches('[data-role="list-type"]')) {
        renderChecker();
        return;
      }
      if (event.target.matches('[data-role="comparison-category"]')) {
        checkerResultKey = '';
        renderChecker();
        announceComparisonCount();
        return;
      }
      if (event.target.matches('[data-role="unsend-scope"], [data-role="unsend-count"]')) {
        renderDmSummary();
        return;
      }
      if (event.target.matches('[data-cleanup-preference]') && !event.target.disabled) {
        const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        const next = cleanupSettings.normalize({ ...cleanupPreferences, [event.target.dataset.cleanupPreference]: raw });
        await GM_setValue(cleanupSettings.STORAGE_KEY, next);
        cleanupPreferences = next;
        status('Cleanup defaults saved. Current review unchanged.');
        return;
      }
      if (event.target.matches('[data-preference]')) {
        const preference = event.target.dataset.preference;
        savePreferences({
          [preference]: preference === 'opacity'
            ? Number(event.target.value) / 100
            : event.target.value,
        });
        return;
      }
      if (!event.target.matches('input[type="file"][data-file="queue"], input[type="file"][data-file="dm"]')) return;
      const file = event.target.files?.[0];
      if (event.target.dataset.file === 'queue') await importQueue(file);
      if (event.target.dataset.file === 'dm') await importDmJob(file);
      event.target.value = '';
      renderAll();
    } catch (error) {
      status(`Stopped: ${error.message}`);
    }
  });

  shadow.addEventListener('input', (event) => {
    if (event.target.matches('[data-role="result-filter"]')) {
      checkerResultKey = '';
      renderChecker();
      announceComparisonCount();
      return;
    }
    if (!event.target.matches('[data-preference="opacity"]')) return;
    const percent = Number(event.target.value);
    host.style.setProperty('--insta-toolbox-alpha', `${percent}%`);
    host.style.setProperty('--insta-toolbox-alpha-strong', `${Math.min(100, percent + 8)}%`);
    setText('opacity-output', `${percent}%`);
  });

  shadow.addEventListener('keydown', onTabKeydown);
  shadow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && query('[data-role="settings-dialog"]')?.open) {
      setSettingsOpen(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const tab = event.target.closest?.('[data-view]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = queryAll('[data-view]');
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      savePreferences({ view: tabs[next].dataset.view });
      tabs[next].focus();
      event.preventDefault();
    }
  });

  query('[data-role="settings-dialog"]')?.addEventListener('click', onSettingsDialogClick);
  query('[data-role="settings-dialog"]')?.addEventListener('close', onSettingsDialogClose);

  let interaction = null;
  let suppressLauncherClick = false;
  const panel = query('.panel');
  const launcher = query('.launcher');
  const moveHandle = query('[data-role="move"]');
  const resizeStartHandle = query('[data-role="resize-start"]');
  const resizeEndHandle = query('[data-role="resize-end"]');

  function beginInteraction(event, kind) {
    if (event.button !== 0 || (kind !== 'launcher' && innerWidth <= 600)) return;
    const rectangle = (kind === 'launcher' ? launcher : panel).getBoundingClientRect();
    interaction = {
      kind,
      moved: false,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rectangle,
    };
    host.dataset.layoutInteraction = kind;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function interactionPatch(event) {
    const deltaX = event.clientX - interaction.x;
    const deltaY = event.clientY - interaction.y;
    interaction.moved ||= Math.hypot(deltaX, deltaY) >= 4;
    if (interaction.kind === 'launcher') {
      return { launcherPosition: constrainedPosition({
        x: interaction.rectangle.left + deltaX,
        y: interaction.rectangle.top + deltaY,
      }, launcherDimensions()) };
    }
    if (interaction.kind === 'move') {
      return { position: constrainedPosition({ x: interaction.rectangle.left + deltaX, y: interaction.rectangle.top + deltaY }) };
    }
    const maxWidth = Math.min(WIDTH_MAX, innerWidth - (INSET * 2));
    const maxHeight = Math.min(HEIGHT_MAX, innerHeight - (INSET * 2));
    const fromStart = interaction.kind === 'resize-start';
    const size = {
      width: Math.round(clamp(
        interaction.rectangle.width + (fromStart ? -deltaX : deltaX),
        WIDTH_MIN,
        maxWidth,
      )),
      height: Math.round(clamp(interaction.rectangle.height + deltaY, HEIGHT_MIN, maxHeight)),
    };
    const patch = { ...size };
    if (fromStart) {
      patch.position = constrainedPosition({
        x: interaction.rectangle.right - size.width,
        y: interaction.rectangle.top,
      }, size);
    }
    return patch;
  }

  function moveInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    preferences = normalizePreferences({ ...preferences, ...interactionPatch(event) });
    applyLayout();
    event.preventDefault();
  }

  function endInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const patch = interactionPatch(event);
    const finished = interaction;
    interaction = null;
    delete host.dataset.layoutInteraction;
    if (finished.kind === 'launcher' && !finished.moved) return;
    if (finished.kind === 'launcher') suppressLauncherClick = true;
    savePreferences(patch);
  }

  function keyboardLayout(event, kind) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const step = event.shiftKey ? 40 : 12;
    const rectangle = (kind === 'launcher' ? launcher : panel).getBoundingClientRect();
    if (kind === 'launcher') {
      const size = launcherDimensions();
      savePreferences({ launcherPosition: constrainedPosition({
        x: (preferences.launcherPosition?.x ?? rectangle.left)
          + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: (preferences.launcherPosition?.y ?? rectangle.top)
          + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      }, size) });
    } else if (kind === 'move') {
      savePreferences({ position: constrainedPosition({
        x: (preferences.position?.x ?? rectangle.left) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: (preferences.position?.y ?? rectangle.top) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      }) });
    } else if (kind === 'resize-end') {
      savePreferences({
        width: preferences.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        height: preferences.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      });
    } else {
      const next = panelSize();
      next.width = Math.round(clamp(
        next.width + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        WIDTH_MIN,
        Math.min(WIDTH_MAX, innerWidth - (INSET * 2)),
      ));
      next.height = Math.round(clamp(
        next.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
        HEIGHT_MIN,
        Math.min(HEIGHT_MAX, innerHeight - (INSET * 2)),
      ));
      savePreferences({
        width: next.width,
        height: next.height,
        position: constrainedPosition({ x: rectangle.right - next.width, y: rectangle.top }, next),
      });
    }
    event.preventDefault();
  }

  launcher.addEventListener('pointerdown', (event) => beginInteraction(event, 'launcher'));
  launcher.addEventListener('keydown', (event) => keyboardLayout(event, 'launcher'));
  launcher.addEventListener('click', (event) => {
    if (!suppressLauncherClick) return;
    suppressLauncherClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  moveHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'move'));
  // Dragging anywhere on the header is far easier to hit than the grip alone,
  // as long as the real controls in it still behave like controls.
  query('.header')?.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, select, summary, input, a, label, [data-view], [data-action]')) return;
    beginInteraction(event, 'move');
  });
  resizeStartHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'resize-start'));
  resizeEndHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'resize-end'));
  moveHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'move'));
  resizeStartHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'resize-start'));
  resizeEndHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'resize-end'));
  window.addEventListener('pointermove', moveInteraction, { passive: false });
  window.addEventListener('pointerup', endInteraction);
  window.addEventListener('pointercancel', endInteraction);
  function clampLayoutToViewport() {
    const patch = {};
    if (preferences.position) patch.position = constrainedPosition(preferences.position);
    if (preferences.launcherPosition) {
      patch.launcherPosition = constrainedPosition(
        preferences.launcherPosition,
        launcherDimensions(),
      );
    }
    if (Object.keys(patch).length) savePreferences(patch);
    else applyLayout();
  }
  window.addEventListener('resize', clampLayoutToViewport);
  globalThis.visualViewport?.addEventListener?.('resize', clampLayoutToViewport);

  function toggleToolboxShortcut(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'i') return;
    if (preferences.open) confirmationController?.cancel();
    savePreferences({ open: !preferences.open });
    event.preventDefault();
  }
  window.addEventListener('keydown', toggleToolboxShortcut, true);

  let lastLocationHref = location.href;
  const duplicateObserver = new MutationObserver((records) => {
    const currentHref = location.href;
    if (currentHref !== lastLocationHref) {
      lastLocationHref = currentHref;
      confirmationController?.cancel();
      contextStatus = null;
      dmThreadPreview = null;
      state.messageEvidence = null;
      state.dmCheck = null;
      state.sentDms = [];
      state.sentDmsComplete = false;
      state.sentDmsChecked = false;
      invalidatePresence();
      saveState();
      renderAll();
    } else if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => (
      node.nodeType === Node.ELEMENT_NODE
      && (node.matches?.('[role="dialog"]') || node.querySelector?.('[role="dialog"]'))
    )))) {
      renderContext();
    }
    if (!document.getElementById(EXTENSION_ROOT_ID)) return;
    duplicateObserver.disconnect();
    window.removeEventListener('keydown', toggleToolboxShortcut, true);
    window.removeEventListener('resize', clampLayoutToViewport);
    globalThis.visualViewport?.removeEventListener?.('resize', clampLayoutToViewport);
    confirmationController?.destroy();
    inboxPanel?.dispose();
    presencePanel?.dispose();
    presenceSession?.stop();
    invalidatePresence();
    window.removeEventListener('pagehide', stopPresenceSession);
    document.removeEventListener('freeze', stopPresenceSession);
    host.remove();
  });
  duplicateObserver.observe(document.documentElement, { childList: true, subtree: true });

  document.documentElement.append(host);
  bootstrapClaim.remove();
  saveState();
  savePreferences(preferences);
  renderCleanupSettings({ initializeDraft: true });
  if (globalThis.InstaToolboxPresenceNativeActions
    && globalThis.InstaToolboxPresenceSession
    && globalThis.InstaToolboxPresenceSessionPanel) {
    const nativeActions = globalThis.InstaToolboxPresenceNativeActions.create({
      document, location, inspectViewer: inspectPresenceAccount,
    });
    presenceSession = globalThis.InstaToolboxPresenceSession.create({
      nativeActions,
      locks: globalThis.navigator?.locks || null,
      onUpdate: next => presencePanel?.render(next),
    });
    presencePanel = globalThis.InstaToolboxPresenceSessionPanel.mount({
      container: query('[data-role="presence-routine"]'), document, window,
      session: presenceSession,
      inspectAccount: inspectPresenceAccount,
      confirmAction: confirmRun,
      readPreferences: () => GM_getValue('instaToolboxPresenceSessionV1', null),
      writePreferences: value => GM_setValue('instaToolboxPresenceSessionV1', value),
      readLog: () => {
        const account = inspectPresenceAccount();
        return account.accountKey
          ? GM_getValue(`instaToolboxPresenceActivityLogV1:${account.accountKey}`, null)
          : null;
      },
      writeLog: value => {
        const account = inspectPresenceAccount();
        if (!account.accountKey) throw new Error('presence-log-account-unverified');
        return GM_setValue(`instaToolboxPresenceActivityLogV1:${account.accountKey}`, value);
      },
      busy: () => Boolean(dmCleanupController || dmRunner?.snapshot().canStop
        || relationshipController || state.run?.status === 'running' || inboxPanel?.busy()),
      onStatus: status,
    });
    window.addEventListener('pagehide', stopPresenceSession);
    document.addEventListener('freeze', stopPresenceSession);
  }
  if (globalThis.InstaToolboxInboxPanel) {
    const inspectInboxAccount = () => {
      const value = globalThis.InstaToolboxInstagramViewer.inspect({ document, location });
      return { ...value, accountId: value.accountKey };
    };
    const inboxStorageKey = () => {
      const account = inspectInboxAccount();
      if (!account.accountVerified || !account.accountId) throw new Error('inbox-viewer-unverified');
      return `instaToolboxInboxHistoryV1:${account.accountId}`;
    };
    const inboxCheckpoints = globalThis.InstaToolboxInboxCheckpoints.create({
      inspectAccount: inspectInboxAccount,
      read: () => GM_getValue(inboxStorageKey(), GM_getValue('instaToolboxInboxCheckpointV1', null)),
      write: value => GM_setValue(inboxStorageKey(), value),
    });
    inboxPanel = globalThis.InstaToolboxInboxPanel.mount({
      container: query('[data-role="inbox-cleanup"]'), document, window,
      viewer: globalThis.InstaToolboxInstagramViewer, runner: dmRunner,
      confirmAction: confirmRun,
      cancelConfirmation: () => confirmationController?.cancel(),
      load: () => inspectInboxAccount().accountVerified ? inboxCheckpoints.load() : null,
      save: checkpoint => inboxCheckpoints.save(checkpoint),
      workerTransport: typeof GM_openInTab === 'function'
        && typeof GM_addValueChangeListener === 'function'
        && typeof GM_removeValueChangeListener === 'function' ? {
          storage: {
            get: key => GM_getValue(key, null),
            set: (key, value) => GM_setValue(key, value),
            listen: (key, listener) => GM_addValueChangeListener(
              key,
              (_name, _before, value) => listener(value),
            ),
            unlisten: id => GM_removeValueChangeListener(id),
          },
          openTab: (url, options) => GM_openInTab(url, options),
        } : null,
      defaultWorkerCount: cleanupSettings.effective(cleanupPreferences, 'userscript').workerCount,
      openWorkersInBackground: cleanupSettings.effective(cleanupPreferences, 'userscript').execution === 'background',
      busy: () => Boolean(dmCleanupController || dmRunner?.snapshot().canStop
        || relationshipController || state.run?.status === 'running' || presencePanel?.busy()),
      onStatus: status,
    });
  }
  renderAll();

  // Presence replaces the old persisted manual account runner. Never resume a
  // hidden legacy queue after an update or navigation.
  if (resumableAccountRun()) {
    setRun({ status: 'stopped', stopReason: 'legacy account run retired', current: '', queue: [] });
    status('An older manual account run was stopped. Presence does not resume past approvals.');
  }
})();

})();
