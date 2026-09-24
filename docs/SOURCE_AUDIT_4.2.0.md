# Read-only tool references

Checked September 24, 2026. These sources were inspected as references; no source
code or model weights were incorporated.

| Source | Revision | Finding |
| --- | --- | --- |
| [Osintgram](https://github.com/Datalux/Osintgram/tree/cfb7038b6743f9ca22c58041035d27931382bfbb) | `cfb7038b` | 28 profile, network, content, contact and search commands; Python application under GPL-3.0. |
| [InstagramMutualFollowerChecker](https://github.com/OscarFromNZ/InstagramMutualFollowerChecker/tree/69c343d9574545487338cccb3f1a706d9832d0c5) | `69c343d` | Same friendship-cursor pagination; returns accumulated partial data on errors. ISC is declared, but the complete controlling notice was not established. |
| [IGMutualChecker](https://github.com/maxas10/IGMutualChecker/tree/8fab7b4651ea2e2c497c58f81106487307893a2c) | `8fab7b4` | MIT. Observes mounted DOM rows and replaces its snapshot, losing earlier virtualized windows. |

## What fits

| Group | Commands reviewed | Toolbox disposition |
| --- | --- | --- |
| Profile | Profile information, account-about, profile picture, highlights | Loaded profile counts and post links fit the read-only insights view. Account history, full-size media and highlight extraction need separate native evidence; not exposed as working controls. |
| Network | Followers, following, cross-account comparison, commenters, people tagging the target, people tagged by the target, suggested profiles | Keep the existing Mutual Checker. Cross-account and tag/comment networks need reliable coverage and attribution; suggestions depend on HikerAPI upstream. |
| Content | Hashtags, captions, comments, comment totals, like totals, media types, posting times, photo descriptions, photos, stories | Add loaded-post links, linked hashtags, observed media types and dated-post summaries. Do not infer captions from comments, counts from abbreviated text, or ownership of alt text. No bulk media extraction is added. |
| Context | Tagged-location addresses | No reverse geocoding or location enrichment service is added. |
| Contacts | Follower emails, following emails, follower phones, following phones | Excluded: contact harvesting is not needed for the toolbox's account workflows. |
| Search | Hashtag search, location search | Native Instagram search already serves navigation. No duplicate search panel or remote backend is added. |

Network comparison remains in Mutual Checker. Read-only profile/content insights
sit alongside it rather than adding a second comparison tool. They use already
loaded native elements, preserve unknown fields, and export only on request.
Reports label sample coverage and do not imply full history or author attribution
for links found in comments.

Contact harvesting, inferred personal routines, geolocation enrichment and paid
data services are not included. Existing local-first storage and permissions stay
unchanged.

## Local model audit

Osintgram's web backend uses **Ollama**, defaulting to `llama3.1:8b`; it also documents
`qwen2.5:7b`. The configured context is 16,384 tokens, output limit 1,024 tokens,
and tool loop limit eight turns. The model selects the same tools as the manual
interface; it does not provide Instagram access.

Upstream estimates approximately 4.7 GB for the default model and about 2 GB for
its context cache. These are upstream estimates, not local benchmarks. Its other
dependencies include Python 3.10+, FastAPI, Uvicorn, the Ollama client, HikerAPI,
instagrapi and geopy. Data collection still requires a paid HikerAPI key or a
separate account/session. Its configurable Ollama host can be remote.

Bundling this stack would add installation, resource, session and data-sharing
requirements without improving the three core actions. The userscript therefore
uses deterministic local summaries and does not display an unconnected model
control. A future optional model integration needs an explicit local endpoint,
data preview, resource checks and separate acceptance.

## Missing follower records

None of these collectors demonstrates recovery of records omitted by Instagram.
Osintgram also has request budgets and finite list defaults. Replacing accumulated
pagination with a mounted-row snapshot would regress completeness. Partial
comparisons remain visible, downloadable and labelled; omitted identities and
the reason for omission are not guessed.

Primary source: [tool dispatch](https://github.com/Datalux/Osintgram/blob/cfb7038b6743f9ca22c58041035d27931382bfbb/src/web/tools.py),
[model loop](https://github.com/Datalux/Osintgram/blob/cfb7038b6743f9ca22c58041035d27931382bfbb/src/web/app.py),
[runtime guide](https://github.com/Datalux/Osintgram/blob/cfb7038b6743f9ca22c58041035d27931382bfbb/doc/web-ui.md),
and [collector](https://github.com/Datalux/Osintgram/blob/cfb7038b6743f9ca22c58041035d27931382bfbb/src/osint_service.py).
