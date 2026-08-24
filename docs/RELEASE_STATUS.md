# Release status

Current version: **2.0.3 release candidate**

## What ships

- **Tampermonkey userscript:** the complete Instagram overlay with Mutual
  Checker, Follow / Unfollow, and DM Unsend.
- **Chrome extension:** the same overlay plus optional local pairing with the
  workspace app.
- **Web / PWA package:** a static-hosting archive for imports, comparisons,
  message search, reviewed plans, history, exports, and backups.
- **Windows desktop app:** one unsigned NSIS installer.
- **macOS desktop app:** one universal DMG and one universal ZIP for Intel and
  Apple Silicon.

Imported data, pairing state, and activity history stay on the user's machine.
The project has no hosted account or data service.

## 2.0.3 package changes

- Uses one canonical Insta Toolbox icon across the web app, desktop bundles,
  extension, and generated userscript.
- Produces stable release filenames:
  - `Insta-Toolbox-Setup-2.0.3.exe`
  - `Insta-Toolbox-2.0.3-universal.dmg`
  - `Insta-Toolbox-2.0.3-universal.zip`
  - `insta-toolbox-web-2.0.3.zip`
  - `insta-aio-companion-2.0.3.zip`
- Builds one macOS application containing both `arm64` and `x86_64` slices.
- Verifies the exact packaged macOS app without modifying or re-signing it
  during QA. Every bundled Mach-O file is checked for both architectures.
- Verifies that desktop archives contain the complete renderer, desktop entry
  point, startup-recovery module, licenses, and expected icon resources.
- Adds bounded startup recovery. A failed load can be retried twice; the final
  failure is shown instead of leaving an invisible background process.
- Keeps the Windows title-bar icon and light startup background aligned with the
  rendered app.

## Signing status

The Windows installer is unsigned. SmartScreen may warn before opening it.

The macOS app is ad-hoc signed for bundle integrity. It is not Apple Developer
ID signed or notarized, so Gatekeeper may warn. The desktop bundle uses
`com.apple.security.cs.disable-library-validation` because this ad-hoc-signed
Electron build has no Developer ID Team ID for library validation. That
exception is limited to the desktop package and is not a substitute for
notarization.

A future Developer ID release should remove the exception, sign every nested
binary with the release identity, notarize the artifacts, staple the ticket,
and repeat the exact-package lifecycle checks.

## Product safety

- Live Instagram actions remain unavailable until the user confirms the exact
  action, target, and finite plan.
- Dry runs do not click Instagram controls.
- Follow / Unfollow revalidates each profile and stops on ambiguity, challenge,
  block, rate limit, expiry, or an uncertain result.
- DM Unsend proves that each selected message was sent by the current user,
  revalidates the open thread, and records only verified removals.
- The desktop, web app, extension, and userscript do not collect Instagram
  credentials, cookies, or session values.

## Verification gates

The final 2.0.3 head must pass:

- deterministic assembly, full tests, repository hygiene, dependency audit,
  generated-userscript parity, and `git diff --check`;
- extension and userscript fixtures, keyboard checks, responsive layouts, and
  no-click safety cases;
- PWA browser baselines and the complete overlay screenshot matrix without
  widening visual tolerances;
- Chrome-for-Testing extension/PWA pairing in a disposable profile;
- Windows installer build, archive inspection, confined app smoke, and silent
  install/uninstall lifecycle;
- macOS universal DMG/ZIP build, full Mach-O architecture inspection, bundle
  icon inspection, ad-hoc signature verification, and exact-app launch smoke;
- release archive contents and `SHA256SUMS.txt` against the published files.

Final counts, CI links, and artifact hashes belong in the pull request and
GitHub release. They are not duplicated here because they change with the
release commit.

## Acceptance limits

Automated fixtures do not prove current authenticated Instagram selectors,
human screen-reader usability, persistent-profile behavior, SmartScreen trust,
or Gatekeeper trust. No live Follow, Unfollow, or Unsend action is part of the
default build or test process.

Before publication, install the commit-pinned userscript or extension in the
intended browser profile, inspect each read-only path, checksum every release
asset, and review the Windows and macOS warnings. Any live Instagram check
requires separate authorization for its exact target and action.

## Supporting documents

- [Installation](./INSTALLATION.md)
- [Browser QA](./BROWSER_QA.md)
- [Overlay QA](./OVERLAY_QA.md)
- [Maintainer guide](./MAINTAINER_GUIDE.md)
- [Security review](./SECURITY_REVIEW.md)
- [Operator acceptance](./OPERATOR_ACCEPTANCE.md)
