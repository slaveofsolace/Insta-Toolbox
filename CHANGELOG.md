# Changelog

This project uses [Semantic Versioning](https://semver.org/).

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
