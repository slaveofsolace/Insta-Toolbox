const viewports = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  laptop: Object.freeze({ width: 1280, height: 720 }),
  tablet: Object.freeze({ width: 820, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
  landscape: Object.freeze({ width: 844, height: 390 }),
});

function semantic(selector, options = {}) {
  return Object.freeze({
    ...options,
    ...(Array.isArray(options.includes) ? { includes: Object.freeze([...options.includes]) } : {}),
    ...(Array.isArray(options.excludes) ? { excludes: Object.freeze([...options.excludes]) } : {}),
    ...(options.attributes ? { attributes: Object.freeze({ ...options.attributes }) } : {}),
    selector,
  });
}

function scenario(id, options = {}) {
  const { semantics = [], ...overrides } = options;
  return Object.freeze({
    after: null,
    captureListType: null,
    density: 'comfortable',
    dock: 'right',
    forcedColors: false,
    firstRun: true,
    layout: 'docked',
    mode: 'qa-profile-following-queue',
    opacity: null,
    open: true,
    pairing: 'action',
    panelHeight: null,
    panelWidth: null,
    position: null,
    presentation: 'panel',
    queue: 'loaded',
    section: 'now',
    targetSelector: '.profile button',
    theme: 'light',
    viewport: 'desktop',
    width: 'standard',
    zoom: 1,
    ...overrides,
    id,
    semantics: Object.freeze([...semantics]),
  });
}

const requiredStates = [
  scenario('first-run-walkthrough', {
    firstRun: false,
    semantics: [
      semantic('[data-ia-role="first-run"]', {
        hidden: false,
        includes: ['Mutual Checker', 'Follow / Unfollow', 'DM Unsend', 'confirm once'],
      }),
      semantic('[data-ia-action="first-run-start"]', {
        attributes: { type: 'button' },
        equals: 'Open Mutual Checker',
      }),
      semantic('[data-ia-action="first-run-dismiss"]', {
        attributes: { type: 'button' },
        equals: 'Not now',
      }),
    ],
    targetSelector: null,
  }),
  scenario('toolbox-floating-translucent', {
    layout: 'floating',
    opacity: 0.62,
    panelHeight: 700,
    panelWidth: 440,
    position: { x: 470, y: 72 },
    semantics: [
      semantic('[data-ia-role="now-content"] .ia-tool-grid', {
        includes: ['Mutual Checker', 'Follow / Unfollow', 'DM Unsend'],
      }),
      semantic('[data-ia-role="move-handle"]', {
        attributes: { 'aria-label': 'Move Insta Toolbox; use arrow keys for precise movement', type: 'button' },
      }),
      semantic('[data-ia-role="resize-handle"]', {
        attributes: { 'aria-label': 'Resize Insta Toolbox; use arrow keys for precise sizing', type: 'button' },
      }),
      semantic('[data-ia-preference="opacity"]', {
        attributes: { max: '100', min: '55', type: 'range' },
      }),
    ],
    targetSelector: null,
  }),
  scenario('profile-not-following-no-match', {
    mode: 'qa-profile-not-following',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['@demo_creator', 'not-following', 'Next: @someone_else', 'Inspection is no-click'],
      }),
    ],
  }),
  scenario('profile-following-queue-match', {
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['@demo_creator', 'following', 'Matches unfollow', 'Inspection is no-click'],
      }),
    ],
  }),
  scenario('profile-ambiguous-safe-stop', {
    mode: 'qa-profile-ambiguous',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['@demo_creator', 'Ambiguous — safe stop', 'Refresh no-click inspection'],
      }),
    ],
  }),
  scenario('followers-first-capture', {
    after: 'capture-visible',
    captureListType: 'followers',
    mode: 'qa-followers-first',
    section: 'capture',
    semantics: [
      semantic('[data-ia-role="capture-count"]', { numberEquals: 3 }),
      semantic('[data-ia-role="capture-detail"]', { includes: ['followers · updated'] }),
      semantic('[data-ia-role="capture-state-title"]', { equals: '3 unique followers accounts captured' }),
      semantic('[data-ia-role="capture-state-detail"]', {
        includes: ['Rendered 3', 'Added 3', 'Duplicates ignored 0'],
      }),
    ],
    targetSelector: '.fixture-dialog',
  }),
  scenario('following-repeated-capture', {
    after: 'capture-visible',
    captureListType: 'following',
    mode: 'qa-following-repeat',
    section: 'capture',
    semantics: [
      semantic('[data-ia-role="capture-count"]', { numberEquals: 4 }),
      semantic('[data-ia-role="capture-detail"]', { includes: ['following · updated'] }),
      semantic('[data-ia-role="capture-state-title"]', { equals: '4 unique following accounts captured' }),
      semantic('[data-ia-role="capture-state-detail"]', {
        includes: ['Rendered 3', 'Added 2', 'Duplicates ignored 1'],
      }),
    ],
    targetSelector: '.fixture-dialog',
  }),
  scenario('checker-filtered-results', {
    after: 'filter-checker-results',
    mode: 'qa-checker-results',
    section: 'capture',
    semantics: [
      semantic('[data-ia-role="capture-state-title"]', { equals: 'Mutual comparison complete' }),
      semantic('[data-ia-role="checker-browser"]', { hidden: false, visible: true }),
      semantic('[data-ia-role="checker-filter-count"]', { numberEquals: 1 }),
      semantic('[data-ia-role="checker-filtered-list"]', {
        includes: ['@beta_account', 'Beta Account'],
        excludes: ['@alpha.friend'],
      }),
    ],
    targetSelector: null,
  }),
  scenario('checker-authenticated-read', {
    after: 'check-account-relationships',
    mode: 'qa-checker-api',
    section: 'capture',
    semantics: [
      semantic('[data-ia-role="checker-run"]', {
        attributes: { type: 'button' },
        equals: 'Check Followers + Following',
      }),
      semantic('[data-ia-role="capture-state-title"]', {
        equals: 'Mutual comparison complete for @demo_creator',
      }),
      semantic('[data-ia-role="followers-count"]', { numberEquals: 2 }),
      semantic('[data-ia-role="following-count"]', { numberEquals: 2 }),
      semantic('[data-ia-role="checker-result"]', {
        includes: ['Authenticated account comparison', 'Mutuals', 'Not following me back'],
      }),
      semantic('[data-ia-role="checker-filtered-list"]', {
        includes: ['@following_only', 'Following Only'],
      }),
      semantic('[data-ia-role="status"]', {
        includes: ['Checked @demo_creator', '2 followers', '2 following'],
        tone: 'good',
      }),
    ],
    targetSelector: null,
  }),
  scenario('queue-action-first', {
    mode: 'qa-queue-locked',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="bot-action"]', { includes: ['Follow people', 'Unfollow people'] }),
      semantic('[data-ia-role="bot-source"]', { includes: ['Current exact profile', 'People who follow you that you do not follow'] }),
      semantic('[data-ia-action="bot-review"]', { includes: ['Review', 'Follow target'] }),
      semantic('[data-ia-role="bot-start"]', { exists: false }),
    ],
    targetSelector: null,
  }),
  scenario('queue-exact-target-review', {
    mode: 'qa-queue-locked',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="bot-disclosure"]', { hidden: false, visible: true, includes: ['Follow or unfollow people', 'Choose an action, then review the accounts'] }),
      semantic('[data-ia-role="bot-source"]', { includes: ['Current exact profile'] }),
      semantic('[data-ia-role="bot-count-field"]', { hidden: true }),
      semantic('[data-ia-action="bot-review"]', { disabled: false, includes: ['Review 1'] }),
    ],
  }),
  scenario('queue-confirmation-collision', {
    mode: 'qa-account-armed',
    presentation: 'strip',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="collision-target"]', { includes: ['@demo_creator'] }),
      semantic('[data-ia-role="collision-state"]', {
        equals: 'Exact confirmation active · page controls remain untouched',
      }),
    ],
  }),
  scenario('queue-compatible-source-options', {
    mode: 'qa-queue-locked',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="bot-action"]', { includes: ['Follow people', 'Unfollow people'] }),
      semantic('[data-ia-role="bot-source"]', { includes: ['Scanned Followers', 'Compatible queue items'] }),
      semantic('[data-ia-role="bot-disclosure"]', { includes: ['Follow or unfollow people', 'Each target is opened', 'rate limit'] }),
    ],
  }),
  scenario('messages-evidence-only', {
    after: 'inspect-messages',
    mode: 'messages',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="message-count"]', { numberEquals: 3 }),
      semantic('[data-ia-role="message-state-title"]', { equals: 'Conversation ready' }),
      semantic('[data-ia-role="message-state-detail"]', {
        includes: ['asks once', 'messages sent by this account'],
      }),
      semantic('[data-ia-action="mass-unsend"]', { disabled: false, equals: 'Unsend DMs' }),
    ],
    targetSelector: '.fixture-thread [role="row"]',
  }),
  scenario('messages-permanent-primary', {
    mode: 'messages-exact',
    section: 'messages',
    semantics: [
      semantic('[data-ia-action="mass-unsend"]', { disabled: false, equals: 'Unsend DMs' }),
      semantic('[data-ia-role="unsend-scope"]', { includes: ['All messages you sent', 'Newest N', 'Oldest N'] }),
      semantic('[data-ia-action="scan-sent-dms"]', { equals: 'Check conversation' }),
    ],
    targetSelector: '[data-message-id="sent-1"]',
  }),
  scenario('messages-thread-bound-primary', {
    mode: 'messages-exact',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="message-state-title"]', { equals: 'Conversation ready' }),
      semantic('[data-ia-action="mass-unsend"]', { disabled: false, equals: 'Unsend DMs' }),
      semantic('[data-ia-role="unsend-detail"]', { equals: 'Confirm the open conversation to begin.' }),
    ],
    targetSelector: '[data-message-id="sent-1"]',
  }),
  scenario('messages-confirmation-collision', {
    mode: 'qa-messages-armed',
    presentation: 'strip',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="collision-target"]', { equals: 'message sent-1' }),
      semantic('[data-ia-role="collision-state"]', {
        equals: 'Exact confirmation active · page controls remain untouched',
      }),
    ],
    targetSelector: '[data-message-id="sent-1"]',
  }),
  scenario('workspace-unpaired', {
    mode: 'qa-workspace',
    pairing: 'none',
    section: 'workspace',
    semantics: [
      semantic('[data-ia-role="bridge-title"]', { equals: 'Workspace not paired' }),
      semantic('[data-ia-role="bridge-detail"]', { includes: ['pair the exact PWA tab'] }),
      semantic('[data-ia-role="bridge-facts"] div:nth-child(2) dd', { equals: 'None' }),
      semantic('[data-ia-role="workspace-link"]', { attributes: { 'aria-disabled': 'true' } }),
    ],
    targetSelector: null,
  }),
  scenario('workspace-read-only', {
    mode: 'qa-workspace',
    pairing: 'read',
    section: 'workspace',
    semantics: [
      semantic('[data-ia-role="bridge-title"]', { equals: 'Workspace paired' }),
      semantic('[data-ia-role="bridge-facts"] div:nth-child(2) dd', { equals: 'read' }),
      semantic('[data-ia-role="workspace-link"]', { attributes: { 'aria-disabled': null } }),
    ],
    targetSelector: null,
  }),
  scenario('workspace-action-permission', {
    mode: 'qa-workspace',
    pairing: 'action',
    section: 'workspace',
    semantics: [
      semantic('[data-ia-role="bridge-title"]', { equals: 'Workspace paired' }),
      semantic('[data-ia-role="bridge-facts"] div:nth-child(2) dd', { equals: 'read + action' }),
      semantic('[data-ia-role="workspace-link"]', { attributes: { 'aria-disabled': null } }),
    ],
    targetSelector: null,
  }),
  scenario('native-dialog-coexistence', {
    mode: 'qa-native-dialog',
    presentation: 'strip',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="live-badge"]', { exists: false }),
      semantic('[data-ia-role="collision-target"]', { equals: '@demo_creator' }),
      semantic('[data-ia-role="collision-state"]', {
        equals: 'Instagram action surface visible · overlay controls suspended',
      }),
    ],
    targetSelector: '.fixture-native-surface',
  }),
  scenario('session-expired', {
    mode: 'qa-session-expired',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['Login required', 'Sign in manually before inspecting again'],
      }),
    ],
    targetSelector: null,
  }),
  scenario('session-challenge', {
    mode: 'qa-session-challenge',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['Challenge detected', 'Resolve Instagram’s challenge manually'],
      }),
    ],
    targetSelector: null,
  }),
  scenario('session-rate-limited', {
    mode: 'qa-session-rate-limit',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['Rate limit detected', 'Wait before doing more work in this session'],
      }),
    ],
    targetSelector: null,
  }),
];

const matrixStates = [
  scenario('profile-dark-desktop', { theme: 'dark' }),
  scenario('queue-dark-desktop', { section: 'queue', theme: 'dark' }),
  scenario('profile-short-laptop', { viewport: 'laptop' }),
  scenario('queue-short-laptop-dark', { section: 'queue', theme: 'dark', viewport: 'laptop' }),
  scenario('profile-narrow-tablet', { viewport: 'tablet' }),
  scenario('messages-narrow-tablet-dark', {
    after: 'inspect-messages',
    mode: 'messages',
    section: 'messages',
    targetSelector: '.fixture-thread [role="row"]',
    theme: 'dark',
    viewport: 'tablet',
  }),
  scenario('messages-confirmation-open-narrow', {
    after: 'open-dm-confirmation',
    confirmationOpen: true,
    mode: 'messages-exact',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="action-confirmation"]', {
        attributes: {
          'aria-describedby': 'ia-confirm-message ia-confirm-detail',
          'aria-labelledby': 'ia-confirm-title',
        },
        visible: true,
      }),
      semantic('[data-ia-role="confirm-title"]', { equals: 'Unsend DMs?' }),
      semantic('[data-ia-role="confirm-message"]', {
        equals: 'Permanently unsend every message you sent in this conversation?',
      }),
      semantic('[data-ia-role="confirm-facts"]', {
        includes: [
          'Action',
          'Permanently unsend messages',
          'Conversation',
          'Thread 123',
          'Scope',
          'All messages you sent',
        ],
      }),
      semantic('[data-ia-role="confirm-cancel"]', {
        attributes: { type: 'button' },
        equals: 'Cancel',
      }),
      semantic('[data-ia-role="confirm-accept"]', {
        attributes: { type: 'button' },
        equals: 'Unsend all my messages',
      }),
    ],
    targetSelector: '[data-message-id="sent-1"]',
    theme: 'dark',
    viewport: 'tablet',
  }),
  scenario('profile-mobile-portrait', { viewport: 'mobile' }),
  scenario('queue-mobile-portrait-dark', { section: 'queue', theme: 'dark', viewport: 'mobile' }),
  scenario('profile-mobile-landscape', { viewport: 'landscape' }),
  scenario('queue-mobile-landscape-dark', { section: 'queue', theme: 'dark', viewport: 'landscape' }),
  scenario('profile-zoom-200-light', { zoom: 2 }),
  scenario('profile-zoom-200-dark', { theme: 'dark', zoom: 2 }),
  scenario('queue-zoom-200-light', { section: 'queue', zoom: 2 }),
  scenario('queue-zoom-200-dark', {
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="queue-open"]', {
        equals: 'Open profile',
        minContrast: 4.5,
        visible: true,
      }),
    ],
    theme: 'dark',
    zoom: 2,
  }),
  scenario('messages-confirmation-open-zoom-200', {
    after: 'open-dm-confirmation',
    confirmationOpen: true,
    mode: 'messages-exact',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="action-confirmation"]', {
        attributes: {
          'aria-describedby': 'ia-confirm-message ia-confirm-detail',
          'aria-labelledby': 'ia-confirm-title',
        },
        visible: true,
      }),
      semantic('[data-ia-role="confirm-title"]', { equals: 'Unsend DMs?' }),
      semantic('[data-ia-role="confirm-message"]', {
        equals: 'Permanently unsend every message you sent in this conversation?',
      }),
      semantic('[data-ia-role="confirm-facts"]', {
        includes: [
          'Action',
          'Permanently unsend messages',
          'Conversation',
          'Thread 123',
          'Scope',
          'All messages you sent',
        ],
      }),
      semantic('[data-ia-role="confirm-cancel"]', {
        attributes: { type: 'button' },
        equals: 'Cancel',
      }),
      semantic('[data-ia-role="confirm-accept"]', {
        attributes: { type: 'button' },
        equals: 'Unsend all my messages',
      }),
    ],
    targetSelector: null,
    theme: 'dark',
    zoom: 2,
  }),
  scenario('profile-forced-colors', { forcedColors: true }),
  scenario('queue-forced-colors', { forcedColors: true, section: 'queue' }),
  scenario('collapsed-desktop', {
    open: false,
    presentation: 'launcher',
    targetSelector: '.profile button',
  }),
  scenario('collapsed-mobile', {
    open: false,
    presentation: 'launcher',
    targetSelector: '.profile button',
    viewport: 'mobile',
  }),
  scenario('queue-run-review', {
    after: 'bot-review',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="bot-badge"]', { equals: '1 reviewed', tone: 'warning' }),
      semantic('[data-ia-role="bot-review-title"]', { equals: '1 target ready to confirm' }),
      semantic('[data-ia-role="bot-review-detail"]', {
        includes: ['Duplicates removed: 0', 'Outside this run: 0', 'rechecked before action'],
      }),
      semantic('[data-ia-role="bot-detail"]', { includes: ['Reviewed: @demo_creator', 'rechecked before action'] }),
      semantic('[data-ia-role="bot-review-list"]', { includes: ['@demo_creator'] }),
      semantic('[data-ia-action="bot-review"]', { hidden: true }),
      semantic('[data-ia-action="bot-start"]', { hidden: false }),
    ],
    targetSelector: null,
  }),
];

export const overlayQaScenarios = Object.freeze([...requiredStates, ...matrixStates]);
export { viewports };
