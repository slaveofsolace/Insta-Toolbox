# Presence reference review

Reviewed September 16, 2026. Links below are primary repository sources, not evidence that their current automation works against Instagram today. None of these projects was executed against an account.

The malformed links in the request resolve to the three repositories listed below. The new Presence implementation is original JavaScript. No upstream functions, bundled libraries, binaries, credentials, selector clients or authentication flows were copied into this branch. Existing project attribution remains unchanged.

## Requested references

### InstaPy / InstaPy

Sources: [repository](https://github.com/InstaPy/InstaPy), [settings](https://github.com/InstaPy/InstaPy/blob/master/docs/settings.md), [license](https://github.com/InstaPy/InstaPy/blob/master/LICENSE).

The project describes Instagram automation implemented with Python/Selenium. Settings expose separate action choices, interest-related inputs, exclusions and configurable session constraints. The inspected settings blob is `80fce9ab7f32914a9e7f964b58c068d38aa02086`.

Useful product ideas: declarative routines, independently chosen actions, explicit exclusions and inspectable session configuration. Presence expresses these as a normalized profile and deterministic plan rather than embedding a Python browser process.

Not adopted: its login flow, probabilistic stock comments, arbitrary interaction cascades, numerical examples presented as safe platform quotas, or any detection-evasion mechanism. Broader interaction types remain separately scoped future features.

License observed: GPL-3.0 on the repository. This branch uses design ideas and newly written implementation, not a copied or mechanically translated GPL module. Any later source reuse needs its own provenance and compatibility decision; rewording copied code is not the provenance process.

### mifi / SimpleInstaBot

Sources: [repository and README](https://github.com/mifi/SimpleInstaBot), [license](https://github.com/mifi/SimpleInstaBot/blob/master/LICENSE).

The README describes configurable follow/unfollow routines, delayed revisits and remembered follow history across restarts. It also distinguishes several account-management modes. These are the closest conceptual match for a managed-follow lifecycle.

Useful ideas: record verified follow completion, preserve managed history, configure a follow-up interval and avoid repeating a past target. Presence uses the user's earlier seven-day requirement, not the reference's example interval.

Not adopted: browser-signature changes, stealth claims, copied numerical activity limits or broad guarantees of account growth or safety. The reference is not proof that its selectors or policies remain usable.

License observed: MIT, copyright Mikael Finstad. License blob: `1abed255ada97fc94bb18f3fc81aecfa2f524683`. No code was transplanted. If a later contribution reuses code, preserve the applicable notice and record exact files and revisions.

### samuelmolp / Full-featured-INSTAGRAM-bot

Sources: [repository](https://github.com/samuelmolp/Full-featured-INSTAGRAM-bot), [README](https://github.com/samuelmolp/Full-featured-INSTAGRAM-bot/blob/main/README.md), [functions.py](https://github.com/samuelmolp/Full-featured-INSTAGRAM-bot/blob/main/functions.py).

The inspected source chains follow, follow-back and liking routines. The first 120 lines of `functions.py` use Selenium calls, fixed sleeps and absolute XPath paths. Inspected blob: `45aa318dff009beb8f5feeb69f5f4f053c1e3a6a`.

Useful idea: a named session composed of distinct activities rather than unrelated buttons. Presence retains that product direction but separates planning from each eventual action adapter.

Not adopted: hard-coded browser paths, credential persistence, account-generation flows, generic activity merely to appear human, or click chains without exact-target proof.

No license file appeared in the inspected root listing. That observation is not permission to copy and is not a claim that every historical file was searched. No code was imported from this repository.

## Additional relevant reference

[mifi/instauto](https://github.com/mifi/instauto) now directs readers to [SimpleInstaBot/packages/instauto](https://github.com/mifi/SimpleInstaBot/tree/master/packages/instauto). The pointer README describes a TypeScript/Puppeteer library and separation of library from desktop shell. Inspected pointer blob: `85ea47fc05f54308b07c46e800d72242d1893c79`.

This supports considering a small reusable core with runtime adapters, rather than combining entire desktop/browser frameworks. The moved implementation was not audited for direct inclusion and is not a dependency here. Future evaluation must inspect the current package itself, not assume the old repository contains the latest source.

## New implementation provenance

| New component | Origin | Reuse decision |
| --- | --- | --- |
| `src/core/presence.js` | Original implementation for this repository's requirements | No upstream code dependency. |
| `tests/presence.test.js` | Original deterministic fixtures and assertions | Synthetic account labels only. |
| `experiments/presence/*` | Original UI concept within the requested visual direction | System fonts and a small original inline icon; no borrowed assets. |
| `scripts/serve-presence-preview.mjs` | Original allowlisted loopback server | Separate from the production server. |

Source research informed the requirements, not claims of live compatibility. The handoff distinguishes verified repository behavior, reference ideas, original design decisions and unresolved browser integrations.

## Rules for later reuse

Record exact upstream revision, file, license, notice, modifications and tests for any imported implementation. Keep that record alongside `THIRD_PARTY_NOTICES.md`. Do not paste source into an MIT-labeled file and plan to erase its history later. Prefer the existing toolbox action engines when they already perform the job; adding a second Selenium/Puppeteer stack is not required by the concept.
