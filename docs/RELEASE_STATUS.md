# Release status

Version: **4.3.1**.

## Development focus

Tampermonkey is the active development and update channel. Chrome extension,
Windows/macOS desktop and web/PWA packages are **On hold after 4.3.1**.
Their code, local data and 4.3.1 downloads remain intact. The current release
still completes all package checks; future feature work focuses on Tampermonkey.

## Changes

- Workers recover inbox redirects, open their exact assigned conversation, and
  report navigation failures. Launch correlation survives same-tab navigation.
- Electron and archive tooling are updated with compatible verification;
  GitHub Actions remain pinned to reviewed commit SHAs.
- Ghost Mode opens ten conversation tabs per group, closes the finished group,
  then opens the next. Selected cleanup supports smaller groups.
- Presence growth reviews candidates from selected accounts' mutuals and records
  verified follows for a later Unfollow review after 7–14 days.
- Inbox discovery, feed readiness and own-reaction popup handling include the
  4.2.1 fixes. Narrow Ghost review fields stay inside the panel.
- Existing data, attribution and release-based Tampermonkey updates are preserved.

## Downloads

[Install or update Tampermonkey](https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js).

The [4.3.1 release](https://github.com/slaveofsolace/Insta-Toolbox/releases/tag/v4.3.1)
provides the extension ZIP, web ZIP, Windows installer, universal macOS DMG/ZIP,
`SHA256SUMS.txt`, SBOM and provenance attestation. See
[installation](INSTALLATION.md) for direct links and instructions.

Windows remains unsigned. macOS is ad-hoc signed, not notarized.

## Verification

The source gate is assembly, the full test suite, repository hygiene, dependency
audit, generated bundle parity and diff checks. CI additionally runs the complete
extension/userscript browser fixtures, real Chrome pairing, all 45 overlay and
11 PWA screenshot states, Windows installer lifecycle, macOS package lifecycle,
archive inspection and checksum generation. Visual thresholds remain unchanged.

Release promotion uses exact artifacts from one successful current `main` CI
run; it does not rebuild them. GitHub Pages uses that run's web artifact.

See [4.3.1 acceptance](acceptance/4.3.1.md) and
[compatibility](compatibility/4.3.1.md) for verified scope and nonclaims.
Historical evidence keeps its original version.

## Runtime limits

Ten open tabs do not create ten independent action allowances. Unsend clicks
share account pacing and exclusive mutation ownership. Received messages are
not removed. Unknown outcomes remain separate from verified removals.

Worker tabs and the inbox manager must remain loaded. Discard, sleep, browser
shutdown, expired sessions, account changes and restrictions interrupt jobs.
Discovery may be partial; the product does not claim complete erasure of saved
copies or an inbox Instagram has not exposed.

Current ten-tab authenticated acceptance, corrected native reaction removal,
growth follow/unfollow acceptance and human screen-reader testing are not
established by automated fixtures. No private account evidence is published.
