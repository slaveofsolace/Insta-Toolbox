# Presence batch review

`extension/presence-batch-review.js` maps a finite Presence plan into the existing Follow / Unfollow review shapes. It does not execute actions.

## Contract

`createPresenceBatchDraft({ reviewedPlan, current, selectedTargetIds, now })` takes the reviewed planner output, current planner inputs, an explicit nonempty target-ID selection, and the current timestamp. It recompiles the observations and rejects expired reviews, account or routine changes, changed targets, and selections outside the review. Selection keeps the planner's order and cannot widen the original plan. The original expiry is retained.

A successful result contains:

- `queueDraft`: the fields consumed by `extension/overlay/views/queue.js` for the finite target review, with source `presence`.
- `confirmationDraft`: the `{ kind: 'account', action, items, description }` shape consumed by `extension/overlay/batch.js`. Items use `{ id, username }`; numeric identities remain separately available in `bindings`.
- `bindings`: exact planning account ID, target ID, username, and action per target.
- `status: 'review-required'`, `executable: false`, and `capabilities.live: false`.

Unavailable results contain a reason and no queue or confirmation draft. Invalid planner records throw rather than being repaired with guessed identities.

Copied plans can supply presentation metadata, but never permission. Simulated session results are rejected. Recompiling caller-supplied history does not establish trusted production history. Partial absence remains insufficient for a Presence Unfollow suggestion; existing manual partial-comparison behavior is unchanged.

## Production connection still required

This module is not bundled or connected to a Start control. Do not pass its confirmation data to the existing batch executor until all of the following are implemented:

1. Add a dedicated review-draft entry point to the queue view. Its current composer recomputes only manual sources and would invalidate source `presence`.
2. Resolve the signed-in numeric account identity independently. A checked profile ID is not viewer proof; Ghost's username-bound `iguser-v1-*` key is not a numeric identity.
3. Revalidate target numeric identity, current relationship, protections, source provenance, expiry, restrictions, and trusted managed-history outcomes before every dispatch. The current batch item shape binds usernames only; it does not enforce the separate Presence bindings.
4. Connect the shared trusted per-account arbiter with Ghost, preserving already-dispatched settlement and uncertain-outcome reconciliation.
5. Collect an ordinary fresh exact-action confirmation through the existing batch UI. Never import `confirmed`, a prior confirmation, a simulation, or a persisted plan as authority.

The integration owner must keep live and scheduled capabilities disabled until those boundaries and authenticated disposable-target acceptance pass. No numeric account resolver, executor, scheduler, or second click engine is supplied here.

## Verification

Run `node --test tests/presence.test.js tests/presence-batch-review.test.js`. The focused adapter tests cover finite selection, ordering, current-state drift, expiry, held targets, partial negative evidence, simulation separation, immutable output, and the actual batch confirmation contract with Cancel. They make no Instagram requests or mutations and are not authenticated compatibility evidence.
