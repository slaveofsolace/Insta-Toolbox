# Presence — Live Like Me

An account routine that feels personal without hiding what it does.

**Status: branch-only scaffold.** The planner and an interactive no-click concept are implemented. This is not a released replacement for Follow / Unfollow and does not automate a live Instagram account.

## Branch and dependency

- Working branch: `feat/live-like-me-scaffold`.
- Branch point: `9e9bcb6c3ea62f0b6bd4c42076742987088097dd` on `sol/settings-dm-4.0` ([draft PR #52](https://github.com/slaveofsolace/Insta-Toolbox/pull/52)).
- Stable main at the start of this work: `7ffbcf8a95253f37fec09fbd6c2351e0fca6fc68`, release 3.1.12.
- The inherited 4.0.0 package version belongs to PR #52's candidate. This scaffold does not publish or promote that candidate.
- Parent Ghost/settings files, existing Follow / Unfollow behavior, manifests, generated userscript, release channel and existing notices are unchanged by this scaffold.

Read [the continuation brief](CODEX_HANDOFF.md), [source review](SOURCE_REVIEW.md) and [validation record](VALIDATION.md) before integration.

## Product idea

Presence is the working feature name. **Live Like Me** describes its purpose; **Be Me** can become a session action after native execution is accepted. **Grow my account** is a user-selected goal, not a promise of follower gains.

Presence and Ghost are complementary: Presence helps the user build and maintain connections; Ghost handles separately reviewed inbox cleanup. Neither should be described as undetectable, a human impersonator, or complete erasure of retained data.

The proposed product evolves Follow / Unfollow from a bare action list into a routine:

1. Choose interests and boundaries.
2. Choose a routine and when it should be available.
3. Inspect suggested targets and why each was included or excluded.
4. Preview a finite session without clicks.
5. In a future integrated build, approve the actual session and observe progress.
6. Revisit verified managed follows after the selected waiting period.

A user should configure their routine once without repeatedly configuring every field. Approval should remain specific to the actual action scope. The first live release should reuse the existing finite batch review; longer-lived delegated policies are a separate design and acceptance milestone.

## Routines

| Routine | Current planning behavior | Future extension |
| --- | --- | --- |
| Find my people | Suggest new follows from supplied candidates whose explicit topics overlap the user's choices. Exclusions and protections take precedence. | Native, permitted candidate collection from selected sources; clearly explained relevance. |
| Stay connected | Suggest following back candidates with positive follow-back evidence. | A saved routine of selected relationship-maintenance actions. |
| Make room | Suggest revisiting uniquely verified Presence-managed follows after seven elapsed days by default. Unknown follow-back state is held. | Durable follow lifecycle, reviewed keep/unfollow choices, reminders and history. |

The current default allowances (12, 6, or 12 depending on routine) are editable planning examples, not Instagram-safe limits. All routines remain disabled for actual execution.

## Implemented files

| File | Responsibility |
| --- | --- |
| `src/core/presence.js` | Pure profile normalization, active-window calculations, finite plan compilation, mode-handoff advice and simulated session lifecycle. |
| `tests/presence.test.js` | 37 account-free regression tests covering identity, protections, evidence, timing and simulation. |
| `experiments/presence/index.html` | Full design-lab screen: routine editor, boundaries, explained plan, preview controls and Ghost information dialog. |
| `experiments/presence/presence.css` | Light/dark layout, responsive dimensions, reduced motion, focus and forced-color handling. |
| `experiments/presence/presence.js` | Synthetic candidates, form binding, explicit preference saving, demo export and simulated progress. |
| `scripts/serve-presence-preview.mjs` | Separate loopback-only allowlisted preview server; does not alter the production asset server. |

No new dependencies are added. No third-party implementation is vendored. The production build can include the unused core module through existing core-directory packaging, but no production entrypoint invokes it and the experiment is not part of the shipped interface.

## Try the scaffold

Use the repository's declared Node.js version and package manager when checking the full project.

```sh
node --test tests/presence.test.js
node scripts/serve-presence-preview.mjs
```

Open `http://127.0.0.1:4179`. The default example window covers nearly the whole day; equal start/end is rejected rather than silently meaning all day. Change the window for deliberate outside-hours testing.

Choose a routine, change interests or exclusions, build the plan, then preview. The seven accounts and account ID 100 are synthetic. The 650 ms preview step is presentation timing, not proposed Instagram pacing.

Preferences save under `instaToolboxPresencePreviewV1` on that loopback origin only. Candidate lists, simulated results and execution authority are not restored automatically. Export produces a `presence-review` planning document with `executable: false`; it is not accepted as an executable bridge job. Storage failure is surfaced without claiming a successful save.

This development server serves only the preview HTML/CSS/JS and the planner module. It refuses unrelated files, unsupported methods and unrelated Host headers. Do not widen the production static-asset policy just to expose this experiment.

## Core contracts

### Profile

Versioned, allowlisted fields: stable account ID; username; routine; explicit topics/excluded topics; protected IDs; local active window; IANA time zone; separate follow/unfollow session allowances; waiting period; evidence freshness; private-account preference.

The normalizer always sets `liveEnabled: false`, `reviewRequired: true` and `keepMutuals: true`. Unknown fields are not propagated. Imported JSON is data, never authority.

### Candidate

Every candidate identifies the observing account, stable target ID, username, source, observed relationship, follow-back state and evidence class, account privacy, observation time and topics. Missing identity rejects malformed input; missing or stale relationship evidence holds the candidate instead of inventing certainty.

Labels such as `direct` and `complete-list` are accepted as planning inputs but are **not cryptographic or runtime proof**. A real adapter must independently establish their meaning before any click. The prototype cannot certify arbitrary imported evidence.

### Follow-up history

Unfollow suggestions require exactly one matching account-bound event with `origin: presence`, verified outcome and a past follow timestamp. The waiting period begins at verified follow completion, not discovery or selection. Legacy, duplicated or uncertain history cannot silently become managed-follow provenance. Existing follows remain protected by default.

This intentionally limited one-event model is not a production event store. The next implementation must reconcile complete action histories, renames, manual interventions, follow requests, undo and uncertain outcomes before general migration.

### Plan

`compilePlan` is deterministic for the same inputs and clock. It produces immutable decisions, explanations, due times and a finite list of suggestions. It never fetches, clicks or schedules a browser operation.

A partial follower-list absence is not used to infer a non-mutual automatically. This does not change 3.1.12's existing manual workflow, which intentionally allows reviewed partial-result targets with uncertainty labels.

### Session preview

States: draft, ready, previewing, paused, simulated, stopped and expired. Resume returns to ready; it does not silently continue. Stop, restriction and account changes stop the preview. Expiry uses wall-clock time. Every result says simulated, never followed or unfollowed.

### Cross-mode boundary

`modeHandoff` only explains whether an in-flight or uncertain action must settle before a mode change. It is **not a lock, coordinator, worker lease or permission to start Ghost**. Actual Presence/Ghost exclusion requires a single trusted account-level owner spanning all execution surfaces.

## Integration map

Preserve and extend, rather than duplicate:

- `extension/overlay/views/queue.js` and `extension/overlay/batch.js`: finite target review and existing Follow / Unfollow entry.
- `extension/background.js` and `extension/content-instagram.js`: account inspection, reviewed action routing, exact-target execution and outcomes.
- `extension/inbox-coordinator.js`, `extension/inbox-runtime.js`, `extension/managed-inbox-tabs.js`: inspect PR #52's ownership, checkpoint and uncertainty patterns. These are not yet a complete shared runtime.
- `extension/cleanup-settings.js`, `extension/overlay/preferences.js`, `extension/overlay/tokens.js`, `extension/overlay/shell.js`: additive settings and common design language.
- `userscripts/src/toolbox-shell.js` and the userscript build: a thin compatible surface after native integration is accepted.
- The desktop/PWA remain local workspaces; packaging alone does not supply an authenticated Instagram browser worker.

## Release boundary

Only planning and preview capability flags are true. Discovery, live execution, scheduling, background work, likes, comments, messaging and Ghost handoff remain unavailable. Do not enable a production control merely because a pure model or fixture passes.

Do not merge this branch straight to main while its parent is still under review. Reconcile the parent first, preserve its later commits, then complete the evidence and release gates in the continuation brief. A new installer/userscript release is outside this scaffold's completion claim.
