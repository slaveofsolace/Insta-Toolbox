export async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function loadWithRecovery({
  attempts,
  close,
  load,
  prompt,
  reveal,
  stop,
  timeoutMs,
}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error('Desktop startup attempts must be an integer from 1 through 10.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Desktop startup timeout must be between 1 and 60000 milliseconds.');
  }
  for (const callback of [close, load, prompt, reveal, stop]) {
    if (typeof callback !== 'function') throw new Error('Desktop startup recovery needs every callback.');
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await withTimeout(
        Promise.resolve().then(() => load(attempt)),
        timeoutMs,
        `Local interface load timed out after ${timeoutMs}ms.`,
      );
      return { attempt, status: 'loaded' };
    } catch (error) {
      await stop({ attempt, error });
      await reveal({ attempt, error });
      const canRetry = attempt < attempts;
      const decision = await prompt({ attempt, canRetry, error });
      if (!canRetry || decision !== 'retry') {
        await close({ attempt, error });
        return { attempt, error, status: 'closed' };
      }
    }
  }
  throw new Error('Desktop startup recovery reached an invalid state.');
}
