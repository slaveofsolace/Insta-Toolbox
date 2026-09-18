# Release status

Current candidate: **4.0.1**

Development candidate only. The published release remains **3.1.12**; the
stable update URL is unchanged. The userscript contains reviewed serial inbox
cleanup and the compact Presence session. Authenticated acceptance remains
separate from the fixture results. See [DM restoration](./DM_RESTORATION_4.0.1.md)
for the native selection and removal-reporting history.

## Release files

| Surface | File |
| --- | --- |
| Tampermonkey | `insta-toolbox.user.js` |
| Chrome extension | `Insta-Toolbox-Extension-4.0.1.zip` |
| Web/PWA | `insta-toolbox-web-4.0.1.zip` |
| Windows | `Insta-Toolbox-Setup-4.0.1.exe` |
| macOS | `Insta-Toolbox-4.0.1-universal.dmg` and `.zip` |
| Integrity | `SHA256SUMS.txt`, SBOM, and GitHub provenance attestation |

The stable userscript channel is:

`https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js`

Version 4 keeps the userscript identity and local data introduced in 3.0. Tampermonkey updates an existing 3.x installation in place. Remove a 2.x script before installing the current release.

## Candidate gates

The development matrix contains:

- 973 automated tests at the shared Presence/Ghost integration checkpoint;
- complete generated-userscript and extension fixture acceptance;
- 45 historical 4.0.0 overlay screenshot states awaiting 4.0.1 recapture;
- 11 historical 4.0.0 PWA screenshot states awaiting 4.0.1 recapture;
- service-worker cache generation `insta-toolbox-v401`.

The native DM regression matrix also covers restored pre-Fast handling of sent
replies and story replies through the generated userscript's primary action.
Read-only native selection passed; post-removal authenticated acceptance is
still pending for the repaired candidate.

The optional userscript reaction pass is enabled in this branch candidate. Its
generated-browser acceptance verifies confirmation, cancellation, exact
signed-in-account ownership, one reaction removal, message preservation,
dialog closure, and an independent verified count. This does not establish
current authenticated Instagram reaction compatibility; a disposable live
reaction remains a separate gate.

The current source passes the complete local extension/userscript acceptance,
including responsive and true 200% zoom states. Earlier Chrome pairing, Windows
and macOS packaging, archive inspection, and checksum results do not certify a
new commit until exact-commit CI completes. Authenticated acceptance remains a
separate gate. Desktop/PWA expansion is deferred while the Tampermonkey workflow
is being completed. See the acceptance record for each check's exact scope.

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

The candidate record is [acceptance/4.0.1.md](./acceptance/4.0.1.md).
Compatibility is tracked in [compatibility/4.0.1.md](./compatibility/4.0.1.md).

Automated fixtures do not prove current authenticated Instagram selectors, human screen-reader use, persistent-profile behavior, SmartScreen trust, Gatekeeper trust, or notarization. Record those checks separately without committing usernames, messages, thread IDs, cookies, tokens, or private screenshots.

Historical evidence directories keep the version and filenames they were produced with. They are not renamed or presented as current evidence.

## Related documents

- [Installation](./INSTALLATION.md)
- [Operator acceptance](./OPERATOR_ACCEPTANCE.md)
- [Browser QA](./BROWSER_QA.md)
- [Overlay QA](./OVERLAY_QA.md)
- [Maintainer guide](./MAINTAINER_GUIDE.md)
- [Security review](./SECURITY_REVIEW.md)
