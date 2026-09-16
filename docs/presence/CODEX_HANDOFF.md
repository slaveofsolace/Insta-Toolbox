# Codex continuation — Presence / Live Like Me

Continue the work in `slaveofsolace/Insta-Toolbox` on `feat/live-like-me-scaffold`.

## 1. Read this before editing

The user wants the old Follow / Unfollow experience to evolve into a personally configured routine that feels like it lives alongside their account: **Live Like Me**, **Be Me**, and a **Grow my account** goal. The companion concept is **Ghost**, which separately handles inbox cleanup. Preserve that product ambition. Do not reduce the final product to another exported list or leave an enabled-looking session control that only simulates work.

This branch is the scaffold, not the completed automation. Its implemented planner and prototype are useful foundations; all live capability flags remain false intentionally. Complete the runtime incrementally and make supported versus unavailable behavior unmistakable.

Branch point:

- Parent: `sol/settings-dm-4.0` / draft PR #52.
- Exact parent revision: `9e9bcb6c3ea62f0b6bd4c42076742987088097dd`.
- Stable main at scaffold start: `7ffbcf8a95253f37fec09fbd6c2351e0fca6fc68`, release 3.1.12.
- Parent package version 4.0.0 is a candidate, not a release completed by this work.

Fetch current refs and inspect both branches before doing anything else. The user is actively developing Ghost. Do not reset, force-push, overwrite, delete or duplicate that work. If PR #52 has advanced, integrate its changes deliberately. If it was squash-merged, compare patch ancestry and port only the Presence commits rather than replaying all parent work. Keep the new PR draft and stacked on the parent until integration is agreed.

Read:

- `docs/presence/README.md`
- `docs/presence/SOURCE_REVIEW.md`
- `docs/presence/VALIDATION.md`
- `docs/INBOX_CLEANUP_4.0.md`
- `docs/REACTION_CLEANUP_4.0.md`
- `docs/SETTINGS_4.0.md`
- `docs/SECURITY_REVIEW.md`
- `docs/OPERATOR_ACCEPTANCE.md`
- `docs/MAINTAINER_GUIDE.md`
- `THIRD_PARTY_NOTICES.md`
- Any current `AGENTS.md` instructions and the actual package scripts.

## 2. What exists now

`src/core/presence.js` is original, dependency-free, browser-neutral JavaScript. It normalizes account profiles, evaluates local active windows with IANA zones, compiles finite follow/unfollow suggestions with reasons, and simulates a session. It has no fetch, page access, executor injection, browser automation, timer scheduler or action authority.

Implemented routines:

- Find my people: explicit topic overlap from supplied candidates.
- Stay connected: positively evidenced follow-back candidates.
- Make room: uniquely verified managed follows due for review after a configurable elapsed-day window, seven days by default.

Protections include self, keep list, mutuals, existing/pending follows, previous follow cycles, stale/future evidence, duplicate identity, account mismatch and ambiguous managed history. Inputs are bounded and outputs immutable. User session allowances support an explicit zero. They are not platform safety quotas.

`createPreviewSession` is a no-click model. Its result is `simulated`, not followed/unfollowed. A planning manifest has `executable: false`. Importing that manifest must never mint permission.

`modeHandoff` is advisory logic only. It is not an account mutex or real Ghost integration.

`experiments/presence/` is a working synthetic-data interface: routine selection, interests, exclusions, allowance, waiting period, schedule window, private-account setting, keep list, explained decisions, preview/pause/resume/stop, dark theme, export and a Ghost information dialog. Preferences save locally only on explicit request; no live session is restored. This is outside the shipped overlay and must stay labeled a concept until integrated.

`tests/presence.test.js` contains 37 passing focused tests. Those results do not establish native Instagram support. Read the validation limits before repeating test claims.

## 3. First actions

1. Check `git status`, current branch, parent/main SHAs and active PR work. Preserve uncommitted team work.
2. Run the declared Node.js/pnpm versions. Do not replace `package.json` or dependency versions to match an older environment.
3. Run `node --test tests/presence.test.js` and the existing full suite before changes. Separate inherited failures from regressions.
4. Start `node scripts/serve-presence-preview.mjs` and open `http://127.0.0.1:4179` in a normal browser. Verify the real ESM loader, CSP and successful preference save/reload/reset. Those three things were not established by the scaffold's offline browser fixture.
5. Inspect the existing native Follow / Unfollow path end to end before connecting the planner.
6. Write a short integration map and owner assignments. Do not start by rebuilding the application or importing an entire upstream bot framework.

## 4. Product contract

Use **Presence** as the working feature name and **Live Like Me** as the main subtitle. Keep naming centralized so the team can change it without rewriting behavior. **Be Me** can become the action that begins a reviewed routine; do not use it on a mock that merely advances counters. During development use **Preview session** and clearly identify synthetic data.

The product should make the following story simple:

- This is my account.
- These are my interests and the people I want to stay connected with.
- These are my boundaries and active hours.
- This is what the next session proposes and why.
- This is what was actually done, what was skipped, and what needs attention.
- I can pause or stop it at any time.

The user's ambition is ongoing account assistance, not merely one isolated click. Build toward saved routines and bounded delegated sessions. The first production integration should reuse the existing exact finite review. Longer-lived routine execution needs a separately reviewed policy contract covering account, source inventory, allowed actions, maximum scope, active windows, expiration, renewal and cancellation. A schedule becoming due must not revive an expired approval.

Do not promise guaranteed growth, flawless human imitation, undetectability or operation while the browser is closed. “Live Like Me” refers to the user's selected preferences, not fabricated human behavior. Do not infer sensitive traits or mine private DMs to construct a personality.

## 5. Settings, data model and migrations

Separate four kinds of data:

1. Durable preferences: interests, exclusions, routine, cadence, protected accounts, notification choice and user-imposed allowances.
2. Observations: exact account/target IDs, provenance, evidence class, timestamps and completeness.
3. Planning/history metadata: proposed targets, decisions, verified outcomes, follow completion, revisit dates, manual keep choices and uncertainty.
4. Ephemeral authority: reviewed actions, exact runtime context, session expiry, leases and one-use dispatch grants. Never put reusable authority into imported JSON, page storage or backups.

Use additive migrations. Existing manually followed accounts remain pre-existing unless trustworthy history establishes otherwise. A file claiming `origin: presence` or `outcome: verified` is not sufficient to establish production provenance. Imported histories should remain unverified until reconciliation.

The scaffold's one-history-event rule is deliberately conservative. Replace it with an account-bound event model that resolves the latest state without erasing contradictory evidence. Handle username changes, deleted/unavailable targets, multiple historical follow events, requested follows, manual follows/unfollows between sessions, uncertain outcomes and restart. Preserve stable IDs; never invent native IDs for unresolved usernames.

Specify scope for allowances: per approved session initially. If adding rolling account/day limits, use one shared ledger across all surfaces, define local-day/DST behavior, and count in-flight/uncertain dispatches conservatively. Do not call example values Instagram-approved limits.

Make candidate normalization collect actionable validation issues for the UI rather than silently discarding records. Invalid IDs, duplicates and conflicting names should have repair paths; a mixed-account capture must not partially execute unnoticed.

## 6. Candidate discovery and recommendations

The current module consumes supplied candidates; it does not discover anyone. Implement the first adapter from existing user-provided lists and actual Mutual Checker observations. Map its real schema rather than guessing properties from this prototype.

Later sources may include user-selected profiles, interests, or supported rendered recommendations. Each collector needs bounded traversal, exact account identity, timestamps, provenance, completeness and cancellation. Do not copy arbitrary private endpoint clients from upstream bots. Preserve existing authorized read-route boundaries unless a separately reviewed change explicitly expands them.

Keep recommendations explainable. Every row should state the concrete inclusion reason and any uncertainty. A user can keep, exclude, remove or change a recommendation before approval. Avoid opaque “growth scores”; the current topic-overlap score is merely a deterministic sorting aid.

Partial-list behavior is important: 3.1.12 intentionally allows the old manual target-review workflow to use partial captures with uncertainty labels. Preserve that behavior. Presence must not automatically treat “not found” as “does not follow me.” A suggested cleanup needs sufficiently fresh negative evidence; otherwise hold it for manual review. These are different workflows, not contradictory rules.

## 7. Connect to the existing Follow / Unfollow engine

Inspect these exact integration points:

- `extension/overlay/views/queue.js`
- `extension/overlay/batch.js`
- `extension/background.js`
- `extension/content-instagram.js`
- `userscripts/src/toolbox-shell.js`
- Existing batch, exact-target, identity-reset and partial-result tests.

Create a thin adapter from a reviewed Presence plan to the existing finite batch-review flow. It must inspect the signed-in account and resolve each target through the trusted runtime. Do not directly forward an arbitrary planning object with `confirmed: true`. A matching string or non-cryptographic planning hash does not authenticate a page payload.

Revalidate account, target, current relationship, current protections, evidence freshness, approved action and restriction signals immediately before dispatch. Changes during review invalidate the relevant plan. Mutations follow the established pacing and exact-target driver; do not introduce a parallel Selenium/Puppeteer click implementation.

Record verified follow completion before starting the waiting window. A click, navigation, optimistic label change or lost acknowledgement is not a verified follow. Keep uncertain results explicit and block blind retries. A follow request is not an already established follow relationship.

A session can process its reviewed finite list without repeatedly asking the same question for every entry. Material scope changes require fresh review. Keep the current account and Stop visible. Pause prevents new actions, while already dispatched work settles as verified, failed or uncertain.

## 8. Living routines beyond Follow / Unfollow

These are future product lanes, not implemented features. Keep them out of release claims until their native adapters and acceptance are complete:

- A discover-and-review feed organized around selected interests.
- A revisit queue with Keep, Later and Unfollow choices.
- Optional likes or saves for explicitly approved posts through separate exact-post adapters.
- User-authored comment drafts that show the exact destination and text before posting.
- Routine reminders and a readable session recap.
- Outcome history separating observed follower changes from causal growth claims.

Do not silently add automated comments, DM campaigns, story views or read receipts to a follow routine. Reading/rendering a surface is not necessarily side-effect free; prove the behavior before labeling it read-only. Do not ship fake activity metrics, fabricated social proof or meaningless clicks intended to make a bot appear human.

“Grow my account” can select a goal and routine settings; it must not display promised gains. Keep unused controls absent or explicitly unavailable, never cosmetically enabled.

## 9. Presence and Ghost coordination

Read `docs/INBOX_CLEANUP_4.0.md` closely. The parent has coordinator/discovery/tab/runtime scaffolds, but native inbox execution remains disabled. Its metadata runtime is not yet a fully registered, authenticated executor. Do not claim Ghost works because a pure coordinator test passes.

Before live Presence and Ghost coexist, introduce one trusted per-account activity owner. Reuse compatible parent contracts instead of creating a second independent background scheduler.

Required behavior:

- Presence and Ghost cannot overlap account-changing operations.
- A requested mode change pauses new dispatches, revokes the old mode's remaining authority, waits for dispatched work, and reconciles uncertainty.
- Starting the new mode requires review of its distinct scope. Presence approval never authorizes DM deletion; Ghost approval never authorizes follows.
- Every worker grant binds account, mode/job, exact tab/document, action identity, epoch and expiry.
- Restart restores metadata only. A silent worker is not presumed dead and safe to replace.
- Do not describe `modeHandoff().ready` as permission or a real distributed lock.

Prove two-instance collisions, stale workers, account switches, late acknowledgements and storage failure. Do not wire live handlers until the account arbiter and native inspection are accepted.

## 10. Scheduling and background behavior

The current active window is a filter on planning, not a running scheduler. Add scheduling through an explicit runtime adapter, with private durable checkpoints and nonpersistent approval.

In an inactive but loaded tab, the user should be able to browse elsewhere without focus stealing where the actual runtime supports it. Frozen, discarded, closed or signed-out tabs must pause accurately. Use wall-clock deadlines and reinspection on wake; do not assume callbacks ran on schedule.

Manifest V3 service-worker restart must not recreate permission. Tampermonkey's current grants do not establish a trusted multi-tab control protocol. Never turn page-writable local storage, BroadcastChannel messages or imported files into execution authority.

Do not spoof visibility, play fake audio, rotate proxies, change fingerprints, bypass challenges, force tab focus or disable browser protections. Desktop packaging currently supplies a local workspace, not an authenticated Instagram worker. Keep desktop execution a separate design until isolation and session handling are approved.

## 11. UI integration and creative direction

Preserve the clean Instagram-compatible system from the parent. The experiment is a design lab, not a new mandatory full-page app. Integrate a compact routine composer into the existing account-tool destination first. Keep the conventional manual Follow / Unfollow route accessible until migration and feature parity are proven.

Recommended hierarchy:

- Account context and current mode.
- Routine selector.
- Interests and a concise allowance/schedule summary.
- One primary action: Build my plan / Review session / Start reviewed session.
- Explained target rows, with held/protected items in a disclosure.
- Persistent run status and Stop while executing.
- Secondary history/settings.

Avoid nested cards, duplicate counts, repeated safety paragraphs and a tab for every preference. Appearance settings belong in the shared 4.0 settings groups, not another isolated store. Use one spacing and typography system across extension/userscript/PWA.

The spirit motif should be subtle: a small outline mark, a restrained transition, and clear Presence/Ghost relationship. No continuous pulsing, spooky effects or animation that obstructs Instagram. Use roughly 120–180 ms motion for tab/disclosure/state changes; respect reduced motion. Reserve destructive styling for destructive scopes, not all account activity.

Review the concept in light/dark, 320 and 390 px widths, short desktop windows, forced colors and real 200% zoom. The screenshot check performed here was fixture-based; do a full normal-origin browser pass. In particular verify transition-settled dark colors, contrast, keyboard focus, dialog Escape/close focus restoration, live-region frequency, long usernames, empty plans and large results. Virtualize or bound long lists before production use.

## 12. Team workstreams and merge order

| Order / owner | Work | Completion evidence |
| --- | --- | --- |
| 1 · Integration lead | Reconcile parent/main, run baseline, map existing account execution. | Exact revisions and inherited/regression report. |
| 2 · Data/core | Native source mapping, additive profiles/history, validation repair paths. | Identity/provenance/migration fixtures and no authority restored from data. |
| 3 · Interface | Move accepted routine composer into existing overlay and userscript. | Actual primary flow, reviewed screenshots, keyboard and storage acceptance. |
| 4 · Browser runtime | Finite reviewed Presence-to-batch adapter. | No-click dry run and exact-target/account/restriction regressions. |
| 5 · Coordinator | Shared Presence/Ghost ownership and interruption protocol. | Collision/restart/uncertain-outcome proof with stale-worker rejection. |
| 6 · Scheduling | Reminders first; bounded delegated sessions only after policy review. | Expiry, DST, inactive/frozen/discarded and restart acceptance. |
| 7 · QA/release | Native disposable tests, cross-surface packaging and update checks. | Exact final commit gates and no overstated support matrix. |

Assign one owner to shared settings/schema changes and one to generated artifacts. Avoid concurrent edits to the userscript monolith without coordination. Keep native DM cleanup development in PR #52 independent of the Presence UI work.

## 13. Test requirements

Retain all 37 Presence cases and the full parent suite. Add behavioral tests rather than relying on source-string assertions alone.

Required new coverage: schema upgrade/downgrade; corrupt storage; zero allowance; IANA/DST/overnight boundaries; observed-vs-verified history; username rename with stable ID; duplicates; stale and partial data; protected user changes after review; old approved plan after settings change; action blocked or signed out mid-session; stop before/during/after dispatch; acknowledgement loss; already-following/requested state; simultaneous Presence/Ghost start; frozen worker wake after epoch change; background expiry; long lists and bounded rendering.

Run the repository's current scripts, including:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run assemble
node --test tests/presence.test.js
pnpm test
pnpm run qa:extension
pnpm run qa:chrome
pnpm run qa:browser:check
pnpm run qa:overlay:check
pnpm run verify:repo-hygiene
```

Before release also verify generated userscript parity, extension/web archive contents, Windows and macOS package lifecycle, checksums and release promotion against the exact final commit. Do not loosen tests or screenshot tolerances just to get a green check. Do not replace the parent visual baseline with screenshots from the standalone concept.

No live Instagram action is authorized merely by this development brief. Obtain fresh approval for exact disposable targets and scope. Never use a real inbox-wide wipe or broad follow campaign as a development test. Keep private screenshots, account identifiers, message content and session data out of Git and diagnostics.

## 14. Release and handoff rules

Do not bump or publish a release just for this scaffold. The stable Tampermonkey URL already points to release assets; keep it that way. Edit source modules and rebuild the generated userscript through the existing scripts, not by manually patching the bundle. Installing this branch's concept is not an update to an installed Tampermonkey copy.

New runtime capabilities must be enabled individually after acceptance. Keep unsupported native discovery, reactions, background and desktop execution false until implemented. “No critical failures in fixtures” is not “works on every Instagram layout.”

For every unfinished item add a **Codex-Handoff** entry with: current behavior; exact missing capability; relevant files; attempted evidence; proposed next change; owner; acceptance tests; whether it is disabled, experimental or supported. Do not say simply “finish automation.”

Final report must include branch SHA, parent/main relationship, changed-file inventory, implemented/scaffolded/proposed feature matrix by surface, migration decisions, screenshots, exact commands/results, actual native evidence versus fixtures, known risks, untouched Ghost work, release status and remaining handoff entries.

The next milestone is a working reviewed single-account Presence routine in the existing interface. The later milestone is bounded ongoing account assistance sharing a trustworthy scheduler with Ghost. Do not confuse the two or report the second as delivered by a prototype.
