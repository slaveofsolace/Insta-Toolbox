# Contributing

Contributions are welcome. Preserve the local-first model, data contracts, and action-specific safety boundary.

## Setup

Use Node.js 24.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run assemble
pnpm test
```

## Pull requests

- Keep the change focused and explain its user-visible effect.
- Add synthetic fixtures and tests for data-contract or browser-driver changes.
- Keep migrations additive. Do not silently rename persisted keys, message types, or exported fields.
- Treat imports, page observations, bridge messages, and filenames as untrusted input.
- Keep live actions inactive until their exact action-specific confirmation.
- Stop on ambiguity instead of guessing at a profile, message, thread, or control.
- Document copied or adapted sources with an exact revision, license, and notice.
- Update installation, compatibility, acceptance, security, and third-party documentation when the boundary changes.
- Never commit credentials, session state, real exports, usernames, messages, thread IDs, private screenshots, private endpoints, or local configuration.

Run the relevant gates before opening a pull request:

```sh
pnpm run assemble
pnpm test
pnpm run verify:repo-hygiene
pnpm audit --prod --audit-level high
git diff --check
```

For delivery changes, also run the matching extension, userscript, browser, overlay, package, or archive checks. Use `pnpm run benchmark:zip` for ZIP import changes.

Generated files must come from their source generators. Do not hand-edit `src/app.js`, `userscripts/insta-toolbox.user.js`, `dist/`, installers, or release archives.

## CI and releases

CI actions are pinned to full commit SHAs. Dependabot proposes action and npm updates; review the upstream release and keep the pin.

The release workflow promotes artifacts from a successful `main` CI run. It must not rebuild them. A maintainer supplies the CI run ID and `v<package.version>` tag, then approves the protected `release` environment. Configure that environment with required reviewers before the first release.

GitHub Pages deploys the web artifact from a successful `main` CI run. Configure Pages to use **GitHub Actions** as its source.

## Code style

- Prefer small browser-neutral core modules.
- Escape imported strings before display.
- Return structured errors and migration reports.
- Keep browser drivers behind narrow interfaces.
- Use direct labels and short operational copy.

Security issues belong in a private GitHub security advisory, not a public issue. See [SECURITY.md](SECURITY.md).
