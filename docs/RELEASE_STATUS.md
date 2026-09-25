# Release status

Candidate version: **4.2.1**. Latest published release: **4.2.0**.

Version 4.2.1 repairs native inbox discovery and Presence feed readiness,
preserves finite Ghost message selections, and adds an optional reaction count.
It preserves the short-chat, reaction-popup, streaming-history and removal-proof
repairs from 4.1.6. The userscript remains the primary in-page surface.
Only verified removals count as unsent. The stable update URL always resolves
to the latest published release.
Authenticated acceptance remains separate from fixture results. See
[DM restoration](./DM_RESTORATION_4.0.1.md) for the native selection and
removal-reporting history.

## Release files

| Surface | File |
| --- | --- |
| Tampermonkey | `insta-toolbox.user.js` |
| Chrome extension | `Insta-Toolbox-Extension-4.2.1.zip` |
| Web/PWA | `insta-toolbox-web-4.2.1.zip` |
| Windows | `Insta-Toolbox-Setup-4.2.1.exe` |
| macOS | `Insta-Toolbox-4.2.1-universal.dmg` and `.zip` |
| Integrity | `SHA256SUMS.txt`, SBOM, and GitHub provenance attestation |

The stable userscript channel is:

`https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js`

Version 4 keeps the userscript identity and local data introduced in 3.0. Tampermonkey updates an existing 3.x installation in place. Remove a 2.x script before installing the current release.

## Candidate gates

The development matrix contains:

- 1,061 automated tests passed before the final finite-worker regression was added; the exact final count is recorded in the acceptance record;
- complete generated-userscript and extension fixture acceptance;
- 45 overlay screenshot states checked against the reviewed pixel thresholds;
- 11 PWA screenshot states checked against the reviewed pixel thresholds;
- service-worker cache generation `insta-toolbox-v421`.

The 4.2.1 browser, visual and package gates are pending. The listed matrices
describe required coverage, not completed candidate acceptance.

The native DM regression matrix covers sent replies, story replies, direct
chats, group chats, id-less rows, unavailable account labels, retained virtual
groups, and exact unchanged-row retries through the generated userscript's
primary action. A verified removal preserves whole-conversation progress while
finite newest/oldest plans continue to re-enter from their reviewed edge.
The supplied native short thread was empty during inspection; post-removal
authenticated acceptance remains separate from these fixtures.

The optional userscript reaction pass is available. Its
generated-browser acceptance verifies confirmation, cancellation, exact
signed-in-account ownership, one reaction removal, message preservation,
dialog closure, and an independent verified count. This does not establish
current authenticated Instagram reaction compatibility; a disposable live
reaction remains a separate gate.

A two-action live Presence test passed on 4.1.5: native story opening,
Next and verified completion. That is historical evidence, not a live 4.2.0
continuous-run result. The action adapter remains unchanged; scheduling and UI
are updated in 4.2.0.

The release gate includes the complete extension/userscript acceptance suite,
responsive and true 200% zoom states, the 45-state overlay matrix,
the 11-state PWA matrix, and real Chrome extension/PWA pairing. Release promotion uses the
browser, web, Windows, macOS, and checksum artifacts from one successful
`main` CI run without rebuilding them. Authenticated acceptance remains a
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
- Challenge, block, rate-limit, expiry, wrong-target, and revoked authority stop further mutations.
- An ambiguous or unprovable DM row is not counted or blindly retried. All-message cleanup can continue with independently resolved rows and reports failures and unresolved outcomes at the end.
- No build or test command performs a live Instagram action.

## Evidence and nonclaims

The candidate record is [acceptance/4.2.1.md](./acceptance/4.2.1.md).
Compatibility is tracked in [compatibility/4.2.1.md](./compatibility/4.2.1.md).

Automated fixtures do not prove current authenticated Instagram selectors, human screen-reader use, persistent-profile behavior, SmartScreen trust, Gatekeeper trust, or notarization. Record those checks separately without committing usernames, messages, thread IDs, cookies, tokens, or private screenshots.

Historical evidence directories keep the version and filenames they were produced with. They are not renamed or presented as current evidence.

## Related documents

- [Installation](./INSTALLATION.md)
- [Operator acceptance](./OPERATOR_ACCEPTANCE.md)
- [Browser QA](./BROWSER_QA.md)
- [Overlay QA](./OVERLAY_QA.md)
- [Maintainer guide](./MAINTAINER_GUIDE.md)
- [Security review](./SECURITY_REVIEW.md)
