# Presence validation

Date: September 18, 2026.

## Current production-shaped fixture

The generated userscript mounts the compact Presence session in its primary
account tab. Focused controller, native-action, and activity-log tests pass.
Nine browser gates pass across five rendered states.

Verified in deterministic Instagram-shaped fixtures:

- one trusted confirmation occurs before the first action;
- Cancel performs no action;
- post Like verifies the matching Unlike state;
- Follow verifies Following or Requested;
- request confirmation verifies Following or Remove;
- story opening first uses one exact visible profile route, rechecks context,
  and then verifies the story route, media, and controls inside one story-viewer
  root;
- story reaction verifies the matching Unlike state;
- copied, replayed, expired, or wrong-account reviews fail;
- Pause prevents the next action, Resume continues the same review, and Stop
  aborts the wait before another action;
- Live like me remains finite, respects its reviewed window and action ceiling,
  and enters bounded rest periods;
- Instagram sections are reached through observed native controls rather than
  manufactured page URLs; Home waits for delayed story/profile discovery and a
  story hint is never clicked as a direct shortcut;
- the bounded per-account log renders in Presence and in a separate read-only
  resizable window without message or session payloads;
- uncertain results stop without retry;
- one polite live region, 44 px controls, narrow and short layouts, light and
  dark themes, and true 200% zoom remain usable.

The full extension/userscript acceptance matrix also passes with the Presence
session mounted. This covers regressions against Mutual Checker, DM Unsend,
Ghost, responsive layouts, and the existing
accessibility contract.

## Historical planner fixture

The repository retains a synthetic planner and loopback preview as design
research. Its 37 pure-model tests cover normalization, evidence handling,
protections, time windows, deterministic suggestions, and simulated session
states. The preview has no Instagram actuator and is not part of the shipped
userscript interface.

Historical planner exports remain non-executable. Planner success does not
establish production Presence compatibility or permission.

## Not yet established

The current checks do not establish:

- compatibility with the latest authenticated Instagram layouts;
- reliable discovery beyond exact rendered targets;
- current authenticated cross-tab ownership with an active Ghost job;
- operation in a frozen, discarded, closed, or signed-out tab;
- any guaranteed account-growth outcome.

## Required acceptance

1. Install the exact branch-generated userscript in a persistent Chrome profile.
2. Verify the signed-in account and every enabled choice before confirmation.
3. Use specifically approved disposable targets for one Like, Follow or
   Requested result, request confirmation, story view, and story reaction.
4. Verify Pause, Resume, Stop, restriction handling, account changes, and an
   uncertain postcondition without a repeat click.
5. Test the account-level owner shared by Presence and Ghost in the persistent
   profile before allowing the modes to overlap across tabs.
6. Rebuild the userscript from source and rerun the complete repository,
   browser, hygiene, parity, and release checks at the final candidate commit.

Authenticated acceptance must be recorded separately from fixture success.
