# Release status

Current candidate: **4.0.0**

Development candidate only. The published release remains **3.1.12**; the stable update URL is unchanged. Reaction cleanup and managed inbox/background execution are not enabled in this candidate.

## Release files

| Surface | File |
| --- | --- |
| Tampermonkey | `insta-toolbox.user.js` |
| Chrome extension | `Insta-Toolbox-Extension-4.0.0.zip` |
| Web/PWA | `insta-toolbox-web-4.0.0.zip` |
| Windows | `Insta-Toolbox-Setup-4.0.0.exe` |
| macOS | `Insta-Toolbox-4.0.0-universal.dmg` and `.zip` |
| Integrity | `SHA256SUMS.txt`, SBOM, and GitHub provenance attestation |

The stable userscript channel is:

`https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js`

Version 4 keeps the userscript identity and local data introduced in 3.0. Tampermonkey updates an existing 3.x installation in place. Remove a 2.x script before installing the current release.

## Candidate gates

The development matrix contains:

- 503 automated tests at the last completed source checkpoint;
- 45 overlay screenshot states;
- 11 PWA screenshot states;
- service-worker cache generation `insta-toolbox-v400`.

Version-refreshed local visual checks passed. Packaging, remote CI, and authenticated acceptance remain separate gates. See the acceptance record for the exact scope of each completed check.

Before a release is promoted, the exact `main` commit must pass assembly, tests, repository hygiene, dependency audit, generated-userscript parity, extension and userscript acceptance, Chrome pairing, browser QA, overlay/PWA visual checks, Windows packaging, macOS packaging, archive inspection, checksum generation, and `git diff --check`.

The release workflow does not rebuild. A maintainer supplies the successful `main` CI run ID and version tag, approves the protected `release` environment, and promotes those exact tested artifacts. The workflow rechecks versions and checksums, generates an SBOM, requests provenance attestation, creates the tag, and publishes the GitHub release.

## Signing status

The Windows installer is unsigned. SmartScreen may warn.

The macOS application is ad-hoc signed for bundle integrity but is not Developer ID signed or notarized. Gatekeeper may warn. Developer ID signing and notarization remain a separate credentialed release task.

## Safety boundary

- Live actions start disabled on every load.
- Dry runs do not click Instagram controls.
- Every mutation requires an action-specific confirmation and transient capability.
- Follow / Unfollow revalidates the target and relationship.
- DM Unsend revalidates the open thread, sent-message ownership, menu, dialog, and removal result.
- Challenge, block, rate-limit, expiry, wrong-target, ambiguous-control, and uncertain-result states stop the runner.
- No build or test command performs a live Instagram action.

## Evidence and nonclaims

The candidate record is [acceptance/4.0.0.md](./acceptance/4.0.0.md). Compatibility is tracked in [compatibility/4.0.0.md](./compatibility/4.0.0.md).

Automated fixtures do not prove current authenticated Instagram selectors, human screen-reader use, persistent-profile behavior, SmartScreen trust, Gatekeeper trust, or notarization. Record those checks separately without committing usernames, messages, thread IDs, cookies, tokens, or private screenshots.

Historical evidence directories keep the version and filenames they were produced with. They are not renamed or presented as current evidence.

## Related documents

- [Installation](./INSTALLATION.md)
- [Operator acceptance](./OPERATOR_ACCEPTANCE.md)
- [Browser QA](./BROWSER_QA.md)
- [Overlay QA](./OVERLAY_QA.md)
- [Maintainer guide](./MAINTAINER_GUIDE.md)
- [Security review](./SECURITY_REVIEW.md)
