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
      workerCount: Number(source.workerCount) === 2 ? 2 : 1,
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
    return Object.freeze({
      singleConversation: inPage,
      fast: false,
      reactions: false,
      background: false,
      managedWorkers: false,
      notifications: false,
      reasons: Object.freeze({
        fast: 'Unsend uses one pacing mode.',
        reactions: 'Own-reaction removal has not been verified on Instagram.',
        background: inPage ? 'Background execution is awaiting suspension and resume checks.' : 'This app does not control an authenticated Instagram tab.',
        managedWorkers: 'Managed tabs are awaiting browser integration and collision checks.',
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
