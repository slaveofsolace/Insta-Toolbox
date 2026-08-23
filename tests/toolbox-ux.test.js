import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const labels = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
const generated = await readFile(new URL('../userscripts/insta-aio-companion.user.js', import.meta.url), 'utf8');

test('first use explains the tools, local storage, and the read-only boundary', () => {
  assert.match(generated, /data-role="intro"/);
  assert.match(generated, /Mutual Checker/);
  assert.match(generated, /Follow \/ Unfollow/);
  assert.match(generated, /DM Unsend/);
  assert.match(generated, /Data stays in this browser/);
  // The distinction a first-time user most needs: checks read, actions change.
  assert.match(generated, /Checks are read-only/);
  assert.match(generated, /Changes require one exact confirmation/);
  // It is dismissible and remembered, not shown on every load.
  assert.match(shell, /'intro-done':/);
  assert.match(shell, /introDone: value\.introDone === true/);
  assert.match(
    shell,
    /'intro-done': \(\) => \{[\s\S]*?savePreferences\(\{ view: 'checker' \}\);[\s\S]*?query\('\[data-view="checker"\]'\)\?\.focus\(\);/,
    'the button labelled Start with the checker must actually select the checker',
  );
});

test('the panel names the current Instagram context for every handled state', () => {
  for (const state of [
    'Signed out',
    'security check',
    'Action blocked',
    'Rate limited',
    'Conversation open',
    'Inbox open',
    'Nothing to work on here',
  ]) {
    assert.ok(shell.includes(state), `context state missing: ${state}`);
  }
  assert.match(shell, /listType: 'followers', label: 'Followers'/);
  assert.match(shell, /listType: 'following', label: 'Following'/);
  assert.match(shell, /action: `scan-\$\{followerList\.listType\}`/);
  assert.match(shell, /new MutationObserver\(\(records\) => \{[\s\S]*?renderContext\(\);/);
  // Blocked states must not offer an action that cannot work.
  assert.match(shell, /tone: 'blocked'/);
  assert.match(shell, /const show = Boolean\(context\.cta\) && state\.run\?\.status !== 'running'/);
});

test('the checker is a sequence that reports completeness per list', () => {
  assert.match(shell, /function scanState\(listType\)/);
  assert.match(shell, /state\.capture\.verified\?\.\[listType\] !== true\) return 'partial'/);
  assert.match(shell, /state\.capture\.complete\?\.\[listType\] === true \? 'done' : 'partial'/);
  assert.match(generated, /data-step="following"/);
  assert.match(generated, /data-step="followers"/);
  assert.match(generated, /data-step="compare"/);
  // A partial scan must say so on the step and on the comparison.
  assert.match(shell, /accessible accounts found — partial/);
  assert.match(shell, /some accounts may be missing/);
  assert.match(shell, /\(partial\)/);
  assert.match(shell, /Scanned \$\{found\} \$\{listType\} — incomplete\./);
  assert.match(shell, /outcome\?\.reason === 'list-count-mismatch'/);
  assert.match(shell, /Instagram reports \$\{outcome\.expectedCount\}, so this capture stays incomplete/);
});

test('legacy checker rows are quarantined until an exact list dialog is rescanned', () => {
  assert.match(shell, /const requiresCountReconciledRescan = Number\(value\.schemaVersion\) < 4/);
  assert.match(shell, /schemaVersion: 5/);
  assert.match(shell, /verified: \{ followers: false, following: false \}/);
  assert.match(shell, /'scanned-followers': \(\) => names\(verifiedCapture\('followers'\)\)/);
  assert.match(shell, /'scanned-following': \(\) => names\(verifiedCapture\('following'\)\)/);
  assert.match(shell, /cannot drive comparisons or runs until rescanned/);
  assert.match(shell, /if \(observedTypes\.size !== 1\) continue/);
  assert.equal(
    shell.match(/new Map\(verifiedCapture\(listType\)\.map\(/g)?.length,
    2,
    'both full and visible rescans must replace quarantined rows instead of promoting them',
  );
});

test('the checker scan controls name the exact list they operate on', () => {
  const following = generated.match(/<button[^>]*data-action="scan-following"[^>]*>([^<]+)<\/button>/);
  const followers = generated.match(/<button[^>]*data-action="scan-followers"[^>]*>([^<]+)<\/button>/);
  assert.equal(following?.[1], 'Scan Following');
  assert.equal(followers?.[1], 'Scan Followers');
  assert.notEqual(following?.[1], followers?.[1]);
  assert.match(shell, /button\.textContent = `\$\{status === 'todo' \? 'Scan' : 'Rescan'\} \$\{listLabel\}`/);
});

test('userscript restores the previous checker comparison when local persistence fails', () => {
  assert.match(
    shell,
    /const previousCapture = state\.capture;[\s\S]*?state\.capture = nextCapture;[\s\S]*?catch \(error\) \{\s*state\.capture = previousCapture;\s*throw error;/,
  );
});

test('the userscript migrates the old opaque default while preserving explicit choices', () => {
  assert.match(shell, /schemaVersion: 2,[\s\S]*?opacity: 0\.88/);
  assert.match(shell, /source\.schemaVersion === 1 && Number\(source\.opacity\) === 0\.94/);
  assert.match(shell, /clamp\(opacity \?\? 0\.88, 0\.55, 1\)/);
  assert.match(generated, /<input[^>]*value="88"[^>]*data-preference="opacity"/);
});

test('the settings popover uses the resized layout viewport on every desktop', () => {
  assert.match(shell, /\.settings-panel \{[^}]*max-height: var\(--aio-settings-max-height\)/);
  assert.match(shell, /const renderedPanelHeight = innerWidth <= 600/);
  assert.match(shell, /Math\.min\(size\.height, Math\.max\(0, innerHeight - 74\)\)/);
  assert.match(shell, /host\.style\.setProperty\('--aio-settings-max-height', `\$\{settingsMaxHeight\}px`\)/);
  assert.doesNotMatch(shell, /\.settings-panel \{[^}]*max-height:[^;}]*dvh/);
});

test('the context strip keeps explicit readable text in dark Instagram themes', () => {
  assert.match(shell, /\.context \{[^}]*background: var\(--aio-bg-sunken[^}]*color: var\(--aio-text/);
  assert.match(shell, /\.context-copy strong \{[^}]*color: var\(--aio-text[^}]*!important/);
});

test('a partial scan is never presented as a complete comparison', () => {
  // The compare step only reads "done" when both scans reached the end.
  assert.match(
    shell,
    /const complete = scanState\('following'\) === 'done' && scanState\('followers'\) === 'done';/,
  );
  assert.match(shell, /compareStep\.dataset\.state = both \? \(complete \? 'done' : 'partial'\) : 'todo'/);
});

test('a run shows its targets and skip reasons before it starts', () => {
  assert.match(shell, /function renderRunReview\(items, \{ omitted = 0, removed = 0, skippedReasons = \[\] \} = \{\}\)/);
  assert.match(generated, /data-role="run-review"/);
  assert.match(shell, /function reviewAccountRun\(\)/);
  assert.match(shell, /renderRunReview\(plan\.items, plan\)/);
  assert.match(shell, /data-action="review-accounts"/);
  assert.match(shell, /Duplicates or already-correct targets removed/);
  // Review is read-only. The action-specific confirmation happens before the
  // finite capability is minted.
  const runBody = shell.slice(shell.indexOf("'run-accounts': async"), shell.indexOf("'run-unsend': ()"));
  assert.ok(runBody.indexOf('accountRunDraft.signature !== current.signature') < runBody.indexOf('confirmRun('));
  assert.ok(runBody.indexOf('confirmRun(') < runBody.indexOf('startAccountRun('));
  const startBody = shell.slice(shell.indexOf('async function startAccountRun'), shell.indexOf('function confirmRun'));
  assert.ok(startBody.indexOf('const capabilityId') < startBody.indexOf("status: 'running'"));
  assert.ok(startBody.indexOf('approvedTargets: [...queue]') < startBody.indexOf('await continueAccountRun()'));
});

test('the open exact profile is the direct bounded Follow or Unfollow source', () => {
  assert.match(generated, /<option value="current-profile">Current exact profile<\/option>/);
  assert.match(shell, /const source = query\('\[data-role="bot-source"\]'\)\?\.value \|\| 'current-profile'/);
  assert.match(shell, /const count = source === 'current-profile' \? 1 : requestedCount/);
  assert.match(shell, /'current-profile': \(\) => \{/);
  assert.match(shell, /source !== 'current-profile' && action === 'follow'/);
  assert.match(shell, /view: 'account'/);
  assert.match(shell, /Open one Instagram profile first\. No target was reviewed\./);
});

test('the primary Unsend action confirms once and starts without a history prescan', () => {
  const unsendButton = generated.match(/<button[^>]*class="button danger big"[^>]*data-action="run-unsend"[^>]*>Unsend DMs<\/button>/);
  assert.ok(unsendButton, 'Unsend DMs must remain the visible primary action');
  assert.doesNotMatch(unsendButton[0], /\shidden(?![-\w])/);
  const plan = generated.match(/<div[^>]*data-role="unsend-plan"[^>]*>/);
  assert.ok(plan, 'the DM action area must always be visible');
  assert.doesNotMatch(plan[0], /\shidden(?![-\w])/);
  assert.match(generated, /data-action="scan-sent">Check conversation/);
  assert.match(shell, /async function runDmUnsend\(\)/);
  assert.match(shell, /const inspection = dmRunner\.inspect\(\)/);
  assert.doesNotMatch(
    shell.slice(shell.indexOf('async function runDmUnsend()'), shell.indexOf('// --- Section 7:')),
    /scanSentConversation\(|inspectAll\(/,
  );
  assert.match(shell, /const plan = dmRunner\.createPlan\(\{/);
  assert.match(shell, /Permanently unsend \$\{scopeLabel\} in this conversation/);
  assert.match(shell, /await dmRunner\.start\(\{/);
  assert.match(labels, /function createPlan\(value = \{\}\)/);
  assert.doesNotMatch(labels, /phrase = `UNSEND|ENABLE LIVE ACTIONS/);
  assert.match(labels, /countExact: false/);
  assert.match(labels, /stableEmptyPasses < STABLE_EMPTY_PASSES/);
  assert.match(labels, /plan\.limit === null \? MAX_PLAN_MESSAGES : plan\.limit/);
  assert.doesNotMatch(shell, /'unsend-all':/);
  assert.match(shell, /'run-unsend': \(\) => runDmUnsend\(\)/);
  // An empty result says nothing was touched rather than implying success.
  assert.match(shell, /No sent messages found/);
  // The optional check stays advisory because Instagram virtualizes the thread.
  assert.match(shell, /Read-only estimate\. Instagram may load more while Unsend runs/);
});

test('the userscript starts the confirmed Unsend plan and surfaces async failures', () => {
  const reservationBody = shell.slice(
    shell.indexOf('function reserveUnsendPlan(plan)'),
    shell.indexOf('function recordVerifiedUnsend(plan, outcome)'),
  );
  assert.match(reservationBody, /activeUnsendCapability = \{/);
  assert.match(reservationBody, /minDelayMs: 1_000/);
  assert.match(reservationBody, /maxDelayMs: 2_000/);
  assert.doesNotMatch(reservationBody, /saveState\(\)/);

  const clickBody = shell.slice(
    shell.indexOf("shadow.addEventListener('click'"),
    shell.indexOf("shadow.addEventListener('change'"),
  );
  assert.match(clickBody, /async \(event\) =>/);
  assert.match(clickBody, /await actions\[target\.dataset\.action\]\?\.\(\);/);
  assert.match(clickBody, /status\(`Stopped: \$\{error\.message\}`\)/);

  const runBody = shell.slice(
    shell.indexOf('async function runDmUnsend()'),
    shell.indexOf('// --- Section 7:'),
  );
  assert.ok(runBody.indexOf('confirmRun(') < runBody.indexOf('reserveUnsendPlan(plan)'));
  assert.ok(runBody.indexOf('reserveUnsendPlan(plan)') < runBody.indexOf('await dmRunner.start({'));
});

test('finite run confirmation replaces global unlock controls and phrases', () => {
  assert.doesNotMatch(shell, /ENABLE LIVE ACTIONS|LIVE_AUTHORIZATION_PHRASE/);
  assert.doesNotMatch(shell, /Type .*unlock Follow, Unfollow, and Unsend/);
  assert.doesNotMatch(shell, /setLiveActionsUnlocked|InstaAioUserscriptLiveAuthority|data-role="live-actions"/);
  assert.match(shell, /function confirmRun\(message\)/);
  assert.match(shell, /approvedTargets: \[\.\.\.queue\]/);
  assert.match(shell, /capabilityExpiresAt: Date\.now\(\) \+ RUN_CAPABILITY_MS/);
  assert.doesNotMatch(labels, /currentEligibleCount !== plan\.eligibleCount/);
  assert.match(labels, /Number\(value\?\.version\) !== PLAN_VERSION/);
  assert.doesNotMatch(labels, /liveAuthority\?\.enable|ARM UNSEND/);
});

test('the extension keeps Stop available and labels read-only checks truthfully', async () => {
  const messages = await readFile(new URL('../extension/overlay/views/messages.js', import.meta.url), 'utf8');
  assert.match(messages, /const readOnlyCheck = state\.operation === 'check'/);
  assert.match(messages, /readOnlyCheck \? 'Stop check' : 'Stop unsending'/);
  assert.match(messages, /button\.disabled = pendingReservation \|\| \(active\s*\? !state\.canStop/);
  assert.match(messages, /readOnlyCheck\s*\?\s*'Read-only check · nothing changed'/);
});

test('the tablist keeps one selected tab and moves with the arrow keys', () => {
  assert.match(shell, /function syncTabs\(active\)/);
  assert.match(shell, /tab\.setAttribute\('aria-selected', String\(selected\)\)/);
  // Roving tabindex: exactly one tab in the tab order at a time.
  assert.match(shell, /tab\.tabIndex = selected \? 0 : -1/);
  assert.match(shell, /ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last'/);
  assert.match(shell, /next\.focus\(\)/);
});

test('motion is tied to state and removed under reduced motion', () => {
  assert.match(shell, /transition: border-color var\(--aio-motion-base/);
  assert.match(shell, /transition: width var\(--aio-motion-base/);
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shell, /\.intro \{ animation: none; \}/);
  // No ambient motion: nothing loops.
  assert.doesNotMatch(shell, /animation:[^;]*infinite/);
});

test('the panels lead with one action instead of a row of peers', () => {
  // Button clutter was the complaint. Secondary tools moved behind disclosures.
  const toolbars = (generated.match(/<div class="toolbar">/g) || []).length;
  const disclosures = (generated.match(/class="settings-inline"/g) || []).length;
  assert.ok(disclosures >= 3, 'each tool should keep its secondary actions behind a disclosure');
  assert.ok(toolbars < 24, `toolbars grew to ${toolbars}; keep secondary actions disclosed`);
});
