(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.bridge) return;

  const DEFAULT_DM_WRITE_TIMEOUT_MS = 8_000;

  function send(chromeLike, message, options = {}) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const isThreadUnsendWrite = /^insta-aio-(reserve|checkpoint|finalize)-thread-unsend$/u
        .test(String(message?.kind || ''));
      const requestedTimeout = Number(options.timeoutMs);
      const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? requestedTimeout
        : isThreadUnsendWrite ? DEFAULT_DM_WRITE_TIMEOUT_MS : 0;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => finish({ error: 'extension-bridge-timeout' }), timeoutMs);
      }
      try {
        chromeLike.runtime.sendMessage(message, (response) => {
          const error = chromeLike.runtime.lastError?.message;
          finish(error
            ? { error }
            : response && typeof response === 'object'
              ? response
              : { error: 'extension-bridge-empty-response' });
        });
      } catch (error) {
        finish({ error: error.message });
      }
    });
  }

  function activePairing(state) {
    return (state?.pairings || []).find((pairing) => pairing?.pairedAt) || null;
  }

  shared.install('bridge', { activePairing, send });
})();
