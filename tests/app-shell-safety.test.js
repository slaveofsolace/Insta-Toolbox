import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('assembled application does not split closing tags across source fragments', async () => {
  const parts = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-02.jsfrag', 'utf8'),
    readFile('src/app.parts/part-03.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  const source = parts.join('');
  assert.doesNotMatch(source, /<\s+\/section>/i);
  assert.match(source, /<\/section>\s+\$\{state\.importWarnings\.length/);
});

test('restored snapshot identifiers are escaped before option markup insertion', async () => {
  const source = await readFile('src/app.parts/part-02.jsfrag', 'utf8');
  assert.match(source, /value="\$\{escapeHtml\(item\.id\)\}"/);
  assert.doesNotMatch(source, /value="\$\{item\.id\}"/);
});

test('empty message lists use a truthful zero-state range label', async () => {
  const source = await readFile('src/app.parts/part-02.jsfrag', 'utf8');
  assert.match(source, /\$\{filtered\.length\s+\? `Rendering rows/);
  assert.match(source, /: 'No messages to render\.'/);
});

test('view navigation moves focus to the rendered page heading', async () => {
  const [shell, renderer, handlers] = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-03.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  assert.match(shell, /<h1 data-page-heading tabindex="-1">/);
  assert.match(renderer, /focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(handlers, /window\.scrollTo\(0, 0\);[\s\S]*?render\(\{ focusHeading: true \}\)/);
  assert.match(handlers, /render\(\{ focusHeading: true \}\)/);
  assert.match(handlers, /focusSelector: `\[data-action="relationship-tab"\]/);
});

test('controlled live account UI confirms one exact item before durable execution', async () => {
  const [imports, queueView, settingsView, handlers] = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-02.jsfrag', 'utf8'),
    readFile('src/app.parts/part-03.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  assert.match(imports, /createExtensionAccountActionDriver/);
  assert.match(imports, /createIndexedDbActionLedger/);
  assert.match(imports, /saveActionJobCheckpoint/);
  assert.match(queueView, /latestActionJob\.items\.length === 1/);
  assert.doesNotMatch(queueView, /confirm-action-live|requestExactConfirmation/);
  assert.doesNotMatch(settingsView, /live-action-enabled|live-action-batch-limit/);
  assert.match(queueView, /data-action="run-action-extension-live"/);
  assert.match(handlers, /'action\.account-live-intent'/);
  assert.match(handlers, /const confirmed = await confirmAction\(\{[\s\S]*?title: `\$\{actionLabel\} 1 account\?`/);
  assert.match(handlers, /confirmLabel: `\$\{actionLabel\} @\$\{item\.username\}`/);
  assert.match(handlers, /currentJob\?\.previewDigest !== reviewedJob\.previewDigest/);
  assert.match(handlers, /currentItem\?\.username !== reviewedJob\.username/);
  assert.match(handlers, /const confirmation = \{[\s\S]*?action: item\.action,[\s\S]*?count: 1,[\s\S]*?username: item\.username/);
  assert.match(handlers, /prepared\.payload\?\.ready !== true/);
  assert.match(handlers, /createExtensionAccountActionDriver\(state\.bridgePairing, \{[\s\S]*?confirmation,[\s\S]*?jobId: job\.id/);
  assert.match(handlers, /const savedState = await saveActionJobCheckpoint\(checkpointJob\)/);
  assert.match(handlers, /state = savedState/);
  assert.match(handlers, /markQueueItem\(state\.queue, item\.queueItemId, 'completed'\)/);
  assert.match(handlers, /liveActionBatchLimit: 1,[\s\S]*?liveActionEnabled: true/);
  assert.equal(
    handlers.indexOf("'action.account-live-intent'")
      < handlers.indexOf('executeReviewedActionJob(job'),
    true,
  );
});

test('controlled live DM UI confirms exactly one item before either ledger or driver', async () => {
  const [imports, messagesView, handlers] = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-02.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  assert.match(imports, /createExtensionDmUnsendDriver/);
  assert.match(imports, /createIndexedDbDmLedger/);
  assert.match(imports, /saveDmJobCheckpoint/);
  assert.match(messagesView, /latestDmJob\.items\.length === 1/);
  assert.match(messagesView, /data-action="run-dm-extension-live"/);
  assert.match(handlers, /'action\.dm-live-intent'/);
  assert.match(handlers, /'Unsend 1 DM\?'/);
  assert.match(handlers, /confirmLabel: 'Unsend this DM'/);
  assert.match(handlers, /currentItem\?\.conversationId !== reviewedJob\.conversationId/);
  assert.match(handlers, /currentItem\?\.messageId !== reviewedJob\.messageId/);
  assert.match(handlers, /const confirmation = \{[\s\S]*?action: 'unsend',[\s\S]*?conversationId: item\.conversationId,[\s\S]*?count: 1,[\s\S]*?messageId: item\.messageId/);
  assert.match(handlers, /prepared\.payload\?\.ready !== true/);
  assert.match(handlers, /createExtensionDmUnsendDriver\(state\.bridgePairing, \{[\s\S]*?confirmation,[\s\S]*?jobId: job\.id/);
  assert.match(handlers, /const savedState = await saveDmJobCheckpoint\(checkpointJob\)/);
  assert.match(handlers, /state = savedState/);
  assert.equal(
    handlers.indexOf("'action.dm-live-intent'")
      < handlers.indexOf('createIndexedDbDmLedger()'),
    true,
  );
  assert.equal(
    handlers.indexOf("'action.dm-live-intent'")
      < handlers.indexOf('executeReviewedDmJob(job'),
    true,
  );
});

test('destructive PWA actions use one accessible in-app confirmation with Cancel focused', async () => {
  const [shell, handlers, styles] = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
    readFile('src/styles.css', 'utf8'),
  ]);
  const source = `${shell}\n${handlers}`;
  assert.doesNotMatch(source, /(?:window|globalThis)\.confirm\s*\(/);
  assert.match(shell, /document\.createElement\('dialog'\)/);
  assert.match(shell, /data-role="action-confirmation"/);
  assert.match(shell, /aria-labelledby', 'action-confirmation-title'/);
  assert.match(shell, /aria-describedby', 'action-confirmation-message action-confirmation-facts'/);
  assert.match(shell, /data-confirmation-decision="cancel"/);
  assert.match(shell, /dialog\.querySelector\('\[data-confirmation-decision="cancel"\]'\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(shell, /dialog\.addEventListener\('cancel',[\s\S]*?settleActionConfirmation\(false\)/);
  assert.match(handlers, /title: 'Clear local workspace\?'/);
  assert.match(handlers, /confirmLabel: 'Clear local data'/);
  assert.match(handlers, /activeView !== 'settings' \|\| state !== reviewedState/);
  assert.match(styles, /\.action-confirmation \.confirmation-actions button \{ min-width: 132px; min-height: 44px; \}/);
  assert.match(styles, /@media \(forced-colors: active\)/);
});

test('discard aborts only the matching reviewed execution and stale checkpoints are rejected', async () => {
  const [shell, handlers] = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  assert.match(shell, /let actionExecutionController = null/);
  assert.match(shell, /let dmExecutionController = null/);
  assert.match(shell, /actionExecutionController !== controller/);
  assert.match(shell, /current\?\.id !== job\.id/);
  assert.match(shell, /current\?\.previewDigest !== job\.previewDigest/);
  assert.match(shell, /dmExecutionController !== controller/);
  assert.match(handlers, /signal: controller\.signal/);
  assert.match(
    handlers,
    /discarded\?\.id === actionExecutionJobId[\s\S]*?actionExecutionController\?\.abort\(\)/,
  );
  assert.match(
    handlers,
    /discarded\?\.id === dmExecutionJobId[\s\S]*?dmExecutionController\?\.abort\(\)/,
  );
  assert.match(handlers, /const savedState = await saveActionJobCheckpoint\(checkpointJob\)/);
  assert.match(handlers, /const savedState = await saveDmJobCheckpoint\(checkpointJob\)/);
});

test('overview does not describe controlled DM removal as preview-only', async () => {
  const source = await readFile('src/app.parts/part-01.jsfrag', 'utf8');
  assert.match(source, /Find messages you sent and create an unsend plan\./);
  assert.match(source, /Every permanent action requires one exact confirmation on Instagram\./);
  assert.doesNotMatch(source, /Preview\/export only in this build/);
});
