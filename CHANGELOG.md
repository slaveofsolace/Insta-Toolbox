# Changelog

This project uses [Semantic Versioning](https://semver.org/).

## 4.1.6 - 2026-09-24

- Keep Ghost discovery out of Instagram's Notes strip, including native HTML lists without an explicit ARIA role. Only conversation rows enter the inventory.
- Find messages in short, non-scrolling conversations with deeply nested message containers. A three-message chat no longer finishes without selecting its messages.
- Keep reaction cleanup working while Instagram hides the conversation behind its Reactions popup. Reaction badges remain separate from message content, and the signed-in account is rechecked without mistaking nested profile links for different accounts.
- Do not count an edited or still-loading message as unsent after a confirmation closes. Actual payload removal and retained-slot replacements remain supported.
- Keep Mutual Checker running when a later page repeats an account without its previously supplied numeric ID. Conflicting explicit IDs still produce an error.
- Include the Ghost worker, history traversal, and Presence story-navigation repairs from 4.1.5 in the stable Tampermonkey release.

## 4.1.5 - 2026-09-19

- Ghost workers wait for the conversation to load, reuse a bounded tab pool, and keep progress when a conversation cannot be opened. Only tabs launched by the reviewed job can join it.
- Ghost retries message-menu failures without misreporting them as deletions. Stop lets a dispatched removal settle before closing its tab.
- Inbox discovery opens the native inbox automatically and waits for delayed pages instead of stopping at the first bottom edge or overlapping window.
- All-message Unsend processes newly loaded rows as they arrive. Oldest and Newest selections retain their ordering. A failed row does not abandon the remaining history, and long runs have no message-count quota.
- Voice-note ownership includes waveform-only messages. Playback progress no longer changes a message's identity, and reverse-layout scroll anchoring is handled during removal checks.
- Presence recognizes loaded stories without slide IDs in their URLs, verifies same-URL story advances, closes stories and notifications before changing activities, and records results during the run.

## 4.1.4 - 2026-09-19

- Recognize voice-note waveforms and playback controls as part of the exact message payload, so a removed voice message is not mistaken for an unchanged virtual row.
- Keep Presence bound to the verified signed-in account while Instagram temporarily hides account navigation in story and full-screen views.
- Treat Presence target searches as active work and keep the toolbox status on Presence while it moves between Instagram surfaces.
- Retry an unchanged sent message through its exact native menu up to five times instead of ending the conversation pass after the first unverified result.
- Continue the direct Unsend traversal after a genuinely recycled or unprovable row, keep verified removals counted separately, and report unresolved outcomes after the remaining messages are checked.
- Accept Instagram's retained and recycled virtual message groups when the exact confirmed payload has disappeared or changed, without treating preview edits or received messages as sent-message proof.
- Recognize duplicated Instagram navigation labels such as `HomeHome`, so Presence can leave a DM view and start its reviewed feed search.
- Keep Ghost worker uncertainty handling, exact-thread authorization, adaptive pacing, Stop, expiry, and restriction handling unchanged.

## 4.1.3 - 2026-09-19

- Start each Live like me cycle with visible target searches and two short retries before the first scheduled rest.
- Count only verified actions toward a Presence burst so skipped targets do not trigger extra quiet windows.
- Preserve whole-conversation Unsend progress after each verified removal instead of returning to the newest message.
- Wait for delayed oldest-history loading and prove a stable boundary before declaring the conversation exhausted.
- Keep finite newest/oldest scopes, exact ownership, thread authorization, removal proof, Stop, and restriction handling unchanged.

## 4.1.2 - 2026-09-18

- Verify confirmed Unsend results when Instagram removes the exact native message group but retains its outer virtual-list slot.
- Require one matching native payload to disappear, keep duplicate-text handling exact, and reject remounts, edits, loading transitions, or missing confirmation settlement.
- Discover current Instagram story-tray tiles and post actions exposed as accessible role buttons instead of relying on legacy story links or native `button` elements.
- Keep Presence bound to the reviewed visible control and verify the resulting story viewer or action state before recording success.
- Preserve DM ownership checks, exact-thread confirmation, adaptive pacing, Ghost checkpoints, and restriction stops.

## 4.1.1 - 2026-09-18

- Keep delayed but verified message removals from being reported as uncertain by giving the stable postcondition its own full settlement window.
- Verify keyed message removals across native bottom anchoring and exact virtual-scroller replacement while retaining strict neighbor and conversation checks.
- Keep Stop from starting another removal while still settling the exact action already dispatched.
- Open stories through one exact visible profile and its story control. Presence no longer activates a discovered story link directly or accepts unrelated page media as proof.
- Preserve Ghost checkpoints, exact-thread authorization, ownership checks, normal 1–2 second pacing, and fail-closed handling for genuinely unproven outcomes.

## 4.1.0 - 2026-09-18

- Restore multi-message Unsend traversal after Instagram recycles a virtual message row, while retaining exact ownership and removal checks.
- Add reviewed Ghost worker tabs for selected conversations. Tabs may open in front or in the background; destructive actions remain account-paced and run one conversation at a time.
- Replace Presence's manual queue panel with direct activities and a finite **Live like me** session that uses Instagram's visible controls, scheduled quiet periods, Pause, Resume, and Stop.
- Add a bounded per-account Presence activity log with recent results in the toolbox, a separate resizable log window, JSON download, and clear control.
- Keep Presence and Ghost mutually exclusive in the same browser profile, and stop on changed account, conversation, restrictions, lost worker state, or uncertain results.
- Tighten tool spacing, dropdown geometry, responsive layouts, and storage-failure reporting without changing Mutual Checker data contracts.

## 4.0.1 - 2026-09-18

- Recognize sent story and quoted replies when selecting the newest message.
- Verify native removals across timestamp changes and history backfill without mistaking recycled rows for success.
- Enable the optional userscript reaction follow-up after Unsend, with exact signed-in-account ownership proof, separate result accounting, and stop-on-uncertainty behavior. Authenticated disposable-reaction acceptance remains pending.
- Group settings into Appearance, Cleanup defaults, Execution, and Data and troubleshooting; preserve existing preferences and separate appearance and layout resets.
- Restore pre-Fast single-conversation traversal and adaptive 1–2 second pacing. Remove the speed selector and normalize saved Fast preferences without changing other settings.
- Clean up cancelled waits and strengthen removal verification for recycled rows, temporary loading states, and reverted changes.
- Stop safely on page suspension or lost evidence while preserving verified and uncertain outcomes separately.
- Make blur and completion-summary preferences consistent across the extension and userscript.
- Add reviewed, serial Ghost mode to the userscript: scan every inbox section Instagram exposes, select exact conversations, confirm, and use the existing Unsend runner with Pause, Skip, and Stop. Native acceptance remains pending.
- Keep managed worker tabs unavailable until their browser integration passes acceptance.
- Replace the Presence plan builder with five direct activities, one finite maximum, and Start, Pause, Resume, and Stop controls.
- Keep Presence review authority in memory, require exact visible Instagram targets and postconditions, and stop on uncertain outcomes.
- Serialize Presence and Ghost through one verified account lane so the two modes cannot click concurrently in the same browser profile.

## 3.1.12 - 2026-09-12

- Allow partial Mutual Checker results to supply Follow / Unfollow targets, with uncertainty shown in the existing review and confirmation.
- Keep a newly opened confirmation visible when a delayed close event arrives from the previous review.
- Keep verified partial comparisons visible while explaining viewer-age filtering as one known Instagram-side cause.
- Link the signed-in account to Accounts Center and preserve the same guidance in text and JSON downloads.
- Keep age filtering explicitly non-diagnostic because it does not explain every missing account.

## 3.1.11 - 2026-09-08

- Keep partial mutual comparisons visible, searchable, and downloadable.
- Label uncertain differences as “Not found” and explain missing-data limits in the panel, text report, and JSON.
- Preserve complete-list checks for comparison-based Follow / Unfollow runs.

## 3.1.10 - 2026-09-08

- Read exact follower and following counters from verified profile headers when Instagram uses `#` links. This avoids unnecessary profile-metadata requests before and after a comparison.
- Reject unrelated, hidden, ambiguous, rounded, or changing counters. Rate-limit cooldowns and incomplete-list protections remain unchanged.

## 3.1.9 - 2026-09-08

- Keep the single-pass background Mutual Checker workflow from 3.1.3, with no automatic list opening or alternate data-source fallback.
- Honor Instagram's Retry-After before retrying the interrupted request. Without a reset time, back off five minutes, then ten; show a countdown and keep Stop available.
- Preserve completed pages during retries and the saved comparison on failure. Do not infer non-mutuals from incomplete lists.
- Retain the DM conversation-change stop fix, response-body cancellation, storage compatibility, and patched dependencies.
- Update desktop build dependencies to xmldom 0.8.15 and js-yaml 4.3.2.

## 3.1.6 - 2026-09-07

- Check both lists in the background from an open profile, using its exact displayed totals instead of two extra profile-count requests.
- Recognize HTML rate-limit and sign-in responses before decoding JSON. Stop without retries or a manual-scan fallback.
- Keep the request timeout active through the response body and abort stalled downloads before retrying.
- Make manual list capture optional in the context banner. Preserve complete-only comparisons and previous results after failures.

## 3.1.5 - 2026-09-07

- Withhold Mutual Checker comparisons and comparison downloads until both lists are complete. Keep partial rows available separately under Advanced.
- Scan overlapping windows from the top of virtualized dialogs, retaining rows as Instagram recycles them and reacquiring replaced scrollers.
- Require an exact profile total for dialog completion; a quiet scrollbar alone is not proof.
- Reject limited or unfinished API responses even when their counts happen to match. Missing counters are no longer interpreted as zero.
- Preserve saved data while requiring a fresh scan of older dialog captures with unproven completion.

## 3.1.4 - 2026-09-06

- Stop DM Unsend and pending message checks when the open conversation changes, including browsers without navigation events.
- Cancel pending menu waits and release the run so another conversation can be used without refreshing.
- Update the fast-uri build dependency to 3.1.6.

## 3.1.3 - 2026-08-26

### Fixed

- Read Followers and Following with one cursor traversal instead of restarting the entire list.
- Match Instagram's current follow-list request shape and detect platform-limited lists.
- Explain missing cursors and limited lists without marking partial comparisons complete.
- Keep progress tied to the single active traversal, including bounded request retries.

## 3.1.2 - 2026-08-26

### Added

- Browse, search, and progressively reveal all three Mutual Checker comparison groups inside the Instagram toolbox.
- Keep both downloads: a readable text report and the schema-1 JSON record under **Capture lists and export**.
- Show visible disclosure arrows on secondary tool sections in the extension and userscript.

### Fixed

- Retry incomplete relationship pagination with three isolated passes without combining changing memberships into a false complete result.
- Stop duplicate cursor pages from hanging, reacquire replaced list scrollers, ignore unrelated profile counters, and keep uncertain list ends partial.
- Replace the jumping Mutual Checker bar with verified count-based progress and an honest indeterminate state when the total is unknown.
- Prevent a failed manual rescan from presenting an older saved list as a new result.
- Replace stale rows after a complete rescan and isolate manual captures when the profile changes.
- Keep partial or differently sourced captures available for review and export without allowing them to create Follow or Unfollow targets.
- Show verified empty lists as scanned, replace failed-scan progress text, stack narrow result filters, and announce coarse progress and filtered counts.

## 3.1.1 - 2026-08-26

### Fixed

- Prevented duplicate **IT** launchers when more than one current userscript copy starts on the same page.
- Corrected the Tampermonkey guide with arrows on the exact Chrome permission and left-side Install controls.

### Changed

- Added direct support, issue, and Buy Me a Coffee links below the one-minute installation steps.

## 3.1.0 - 2026-08-26

### Changed

- Made the collapsed **IT** button draggable and keyboard-movable across the viewport.
- Added matching lower-left and lower-right resize controls to both in-page surfaces.
- Replaced the loose settings popover with a named modal that dims the page and closes when clicking outside it.
- Added accent, background blur, and collapsed-button size choices without changing saved tool data.
- Removed the redundant first-run card so the three tools open directly.
- Replaced the duplicated installer text with a three-step Tampermonkey guide and click-by-click images.

### Safety

- Follow, Unfollow, and DM Unsend behavior is unchanged. Each live run still requires its exact action confirmation and stops on an uncertain Instagram state.

## 3.0.0 - 2026-08-24

### Changed

- Prepared the public repository identity and release files for **Insta Toolbox**.
- Moved the userscript to `userscripts/insta-toolbox.user.js` and the stable GitHub release update channel.
- Reorganized the overlay around Mutual Checker, Follow / Unfollow, and DM Unsend while keeping the workspace app for imports, comparisons, reviewed plans, ledgers, and exports.
- Updated package metadata, offline cache generation, install documentation, and release automation for the 3.0 line.
- Raised the development and CI runtime to Node.js 24.

### Safety

- Live actions remain off until an action-specific confirmation mints a transient capability.
- Follow, Unfollow, and Unsend stop on changed targets, ambiguous controls, challenges, blocks, rate limits, expiry, or uncertain results.
- The `all` DM scope has no user quota; an internal watchdog only prevents an unbounded runaway process.

### Delivery

- Added a protected, artifact-promotion release workflow. It publishes the exact artifacts from a successful `main` CI run without rebuilding.
- Added SHA-pinned CodeQL, dependency review, Dependabot, weekly account-free compatibility, GitHub Pages deployment, SBOM generation, and provenance attestation.
- Added versioned compatibility and acceptance records.

### Breaking changes

- The 2.x userscript identity, old repository filenames, and raw-branch update URL are not retained as aliases.
- Version 3.0 starts with new local identifiers. It does not read, migrate, or
  delete 2.x browser or desktop state.
- Remove any enabled 2.x script before installing 3.0.

## 2.0.3 - 2026-08-24

- Unified public branding, icons, desktop packaging, and release filenames.
- Added universal macOS package verification and bounded desktop startup recovery.

## 2.0.2 - 2026-08-24

- Restored streaming DM traversal across virtualized conversations.
- Added compact overlay geometry, checksum manifests, and authenticated one-message Unsend acceptance.

Earlier development history is available through the repository tags and commit log.
