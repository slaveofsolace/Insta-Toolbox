# Ghost checkpoint history

`extension/inbox-checkpoint-store.js` stores the twenty most recently updated jobs in one local record. It keeps coordinator metadata, not message contents or action permission.

## Connection

```js
const store = createInboxCheckpointStore({
  read: () => GM_getValue(checkpointKey, null),
  write: (record) => GM_setValue(checkpointKey, record),
  inspectAccount: () => {
    const viewer = nativeViewer.inspect();
    return {
      accountId: viewer.accountKey,
      accountVerified: viewer.accountVerified,
      restriction: viewer.restriction,
    };
  },
});
```

Use the runtime's existing single controller and account Web Lock around writes. The store serializes one instance; plain GM read/write has no cross-instance compare-and-swap guarantee. Do not create competing stores that write the same key without the existing controller lock. The store itself never grants or restores that lock.

- `save(snapshot)` awaits storage and replaces the same canonical review's snapshot. It does not add counters together. A different review becomes a new history entry. Counts cannot decrease for an existing review.
- `load()` returns the newest checkpoint for the currently verified account or `null` when none exists.
- `history()` returns only that account's recent jobs.

The record is `{ version: 1, jobs: [...] }`, newest first, capped at twenty jobs across accounts. An older plain version-1 coordinator checkpoint can be loaded and is converted to the history record on the next successful write. Invalid versions, malformed tasks, unknown thread assignments, and invalid counters fail without overwriting the stored record.

On a profile without the native account picker, loading rejects with `verified-account-required`. This error is not latched. Recheck and load on **Find conversations** after entering the inbox; do not permanently disable the panel because its first mount had no viewer proof. Reads recheck the account after storage returns; writes check before dispatch and after settlement.

## Recovery and failures

Returned active jobs are paused and require review. Running tasks become partial. Prepared, dispatched, or uncertain mutation markers become uncertain and retain their exact reviewed thread and kind. Verified message and reaction counts remain separate. Restoring a checkpoint never restores approval, a lease, confirmation, concurrency permission, or worker authority.

Each read/write has a ten-second timeout by default. A failed or timed-out write rejects and fences further writes in that instance, including after a late settlement. This prevents a delayed old write from being overtaken by a new write. Do not recreate a writable instance while an earlier write might still be in flight; resolve the underlying storage failure and controller ownership first. A failed read or unavailable viewer does not fence later attempts. An account change after a dispatched write can leave the old account's checkpoint saved, but the call rejects instead of claiming success for the new account.

Only canonical review fields, task assignments/status/counters, pending mutation markers, pacing deadline, and a small allowlist of reason codes are retained. Other reason text becomes `other`; raw error messages, message bodies, candidate details, cookies, tokens, and arbitrary fields are dropped.

## Verification

`node --test tests/inbox-checkpoint-store.test.js` exercises retention, replacement, legacy records, counter regressions, sanitization, account filtering/switching, missing-viewer recovery, concurrent markers, delayed writes, timeout fencing, rejection, and actual coordinator restore compatibility. These storage fixtures do not prove browser persistence or Instagram compatibility; runtime integration and browser reload acceptance remain separate.
