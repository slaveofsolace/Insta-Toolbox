import test from 'node:test';
import assert from 'node:assert/strict';

import { loadWithRecovery, withTimeout } from '../desktop/startup-recovery.mjs';

function harness(decisions = []) {
  const calls = [];
  return {
    calls,
    options: {
      attempts: 3,
      timeoutMs: 100,
      close(details) { calls.push(['close', details.attempt]); },
      prompt(details) {
        calls.push(['prompt', details.attempt, details.canRetry]);
        return decisions.shift() || 'close';
      },
      reveal(details) { calls.push(['reveal', details.attempt]); },
      stop(details) { calls.push(['stop', details.attempt]); },
    },
  };
}

test('desktop startup returns immediately after a successful local load', async () => {
  const run = harness();
  run.options.load = (attempt) => run.calls.push(['load', attempt]);
  assert.deepEqual(await loadWithRecovery(run.options), { attempt: 1, status: 'loaded' });
  assert.deepEqual(run.calls, [['load', 1]]);
});

test('desktop startup reveals the window and retries only after that choice', async () => {
  const run = harness(['retry']);
  run.options.load = (attempt) => {
    run.calls.push(['load', attempt]);
    if (attempt === 1) throw new Error('fixture load failed');
  };
  assert.deepEqual(await loadWithRecovery(run.options), { attempt: 2, status: 'loaded' });
  assert.deepEqual(run.calls, [
    ['load', 1], ['stop', 1], ['reveal', 1], ['prompt', 1, true], ['load', 2],
  ]);
});

test('desktop startup closes after cancel without another load', async () => {
  const run = harness(['close']);
  run.options.load = (attempt) => {
    run.calls.push(['load', attempt]);
    throw new Error('fixture load failed');
  };
  const result = await loadWithRecovery(run.options);
  assert.equal(result.status, 'closed');
  assert.equal(result.attempt, 1);
  assert.deepEqual(run.calls, [
    ['load', 1], ['stop', 1], ['reveal', 1], ['prompt', 1, true], ['close', 1],
  ]);
});

test('desktop startup stops after its final bounded attempt', async () => {
  const run = harness(['retry', 'retry', 'retry']);
  run.options.load = (attempt) => {
    run.calls.push(['load', attempt]);
    throw new Error('fixture load failed');
  };
  const result = await loadWithRecovery(run.options);
  assert.equal(result.status, 'closed');
  assert.equal(result.attempt, 3);
  assert.deepEqual(run.calls.filter(([name]) => name === 'load'), [
    ['load', 1], ['load', 2], ['load', 3],
  ]);
  assert.deepEqual(run.calls.at(-2), ['prompt', 3, false]);
  assert.deepEqual(run.calls.at(-1), ['close', 3]);
});

test('desktop load timeout rejects on schedule', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, 'fixture timeout'),
    /fixture timeout/,
  );
});
