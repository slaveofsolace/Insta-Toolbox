# Overlay UI specification

The overlay is a compact operator panel that stays subordinate to Instagram. It
keeps the PWA, pairing, exact-request, reservation, one-item, and page-driver
architecture unchanged.

The default view is collapsed. When open, the exact target, current safety
state, and next available action take priority over explanatory copy. Desktop
placement is movable and resizable; narrow layouts use a fitted bottom sheet.

## Layout and visual rules

- System UI typography with real weight and spacing hierarchy; no remote fonts.
- Neutral adaptive surfaces; no black branding slab or cream dashboard shell.
- Compact navigation with visible tool names and accessible labels.
- Exact target, state, and next safe action above protocol explanation.
- Motion limited to one short open/close transition and collision-mode change.
- Safety detail, imports, downloads, and history behind disclosures when they are
  not the current task.
- Small state dots appear only when their adjacent label identifies the state.

## Tokens

### Light

| Role | Value |
|---|---|
| Shell | `#f7f8f5` |
| Raised surface | `#ffffff` |
| Tool rail | `#eef0eb` |
| Primary ink | `#1d211b` |
| Secondary ink | `#687064` |
| Boundary | `#d8ddd4` |
| Signal pin | `#b9ef35` |
| Focus | `#168cff` |

### Dark

| Role | Value |
|---|---|
| Shell | `#151714` |
| Raised surface | `#1c1f1b` |
| Tool rail | `#10120f` |
| Primary ink | `#f3f5ef` |
| Secondary ink | `#a9afa3` |
| Boundary | `#343a31` |
| Signal pin | `#b9ef35` |
| Focus | a high-contrast system-adjusted blue or forced-color highlight |

Warning, danger, success, and uncertain states require icon/label changes in
addition to color. Final tokens must pass WCAG AA at their actual text size.

## Typography and controls

- Body and control text: 14 px minimum.
- Secondary/supporting text: 12 px minimum.
- View title: 18 px, semibold.
- Target identity: 17–18 px, semibold, wrapping safely.
- Protocol/detail disclosures: 12–13 px with at least 1.45 line height.
- Tooltips are supplemental; every icon button has an accessible name.
- Primary touch targets: at least 44 × 44 CSS px.
- Radii: 8 px controls, 10 px cards, 12 px shell; pills only for compact state
  labels where the shape carries meaning.
- Borders establish grouping. Shadows indicate the one floating shell only.

## Shell

### Launcher

- First install defaults collapsed on every viewport.
- 44 × 44 px neutral button with the IT mark and an accessible `Open Insta Toolbox`
  name.
- Safe-area inset plus 12–16 px viewport inset.
- Optional state dot only for a ready request, active run, attention, or safe
  stop; no ordinary pulse or continuous animation.
- Dock preference moves the launcher and panel together.

### Desktop panel

- Width presets: compact 336 px, standard 380 px, wide 480 px.
- Width is capped to the available viewport minus safe insets.
- Default Now height is content-bounded with a 680 px maximum at 1440 × 900.
- Dense views may grow only to `calc(100dvh - safe insets)` and then scroll their
  content region.
- No minimum height may exceed the available viewport.
- The 52 px single-row header, tool navigation, and creator credit remain fixed
  while the view scrolls.
- Left and right docking use the same DOM; only logical inset properties change.

### Tool rail

- 48 px wide with five 44 px tab controls: Now, Capture, Queue, Messages,
  Workspace.
- Correct `tablist`, `tab`, and `tabpanel` roles.
- Arrow keys move focus; Home and End select the first/last tab.
- Selected state uses weight, surface, and the signal edge—not color alone.
- Visible labels appear through accessible tooltips on pointer/focus delay; the
  accessible name never depends on a tooltip.

### Narrow/mobile

- At narrow effective widths, use a bottom sheet rather than a full-screen page.
- Width follows the viewport; maximum height is approximately 78 `dvh` in
  portrait and the available short dimension in landscape.
- Tool navigation becomes a five-item bottom bar or horizontally scroll-free
  compact rail with 44 px targets.
- Header and close control remain visible.
- Safe-area environment insets apply to every edge.
- At 200% zoom, CSS viewport breakpoints naturally select the narrow layout; no
  required action may need horizontal scrolling.

## Preferences V3

Storage key: `instaToolboxOverlayPreferencesV3`

```json
{
  "schemaVersion": 3,
  "open": false,
  "section": "now",
  "dock": "right",
  "width": "standard",
  "theme": "auto",
  "density": "comfortable",
  "firstRunComplete": false,
  "position": null,
  "panelWidth": null,
  "panelHeight": null,
  "opacity": 0.88
}
```

Migration rules:

1. A valid V3 record is normalized field by field.
2. A V2 record is migrated additively. If only V1 exists, preserve its valid
   `open` and `section`, apply safe defaults, and mark the record as migrated.
3. A fresh install receives `open: false` regardless of desktop width.
4. Invalid values fall back independently; one bad field does not erase valid
   preferences.
5. Preferences contain no username, message content, pairing secret, token,
   origin history, or imported queue data.
6. Storage failures reject visibly and preserve the in-memory safe default.

## Theme behavior

- `light` and `dark` are explicit.
- `auto` follows Instagram's rendered surface, with system preference only as a
  fallback.
- Observe relevant `class`/`style` changes on `html` and `body` and the system
  color-scheme media query; do not poll.
- Theme changes update token attributes without rebuilding the view or losing
  focus.
- Forced colors removes decorative shadows, uses system colors, and preserves
  state with text and borders.

## Route-aware information architecture

### Now

Profile routes show exact username, identity confidence, relationship, queue
match/protection, session warning, and one next safe action. List dialogs show
detected list type and capture counts. DM routes show conversation identity,
evidence count, exact-target availability, and one review action. Unsupported
routes show a short neutral state, not an empty ledger.

### Capture

Use the fixed same-origin read-only friendship routes for the authenticated
Mutual Checker. Show the requested list, pages loaded, unique total, retry state,
completeness, and storage failure. Use the verified Followers/Following dialog
as a fallback, and render only a bounded local preview.

### Queue

The current username/action/status is focal. Open, Complete, and Skip remain the
primary loop. Import/export and signed history are disclosures. A destructive
run appears only after an exact finite review and one ordinary confirmation; its
transient capability expires or is revoked on completion, Stop, or safe stop.

### Messages

Keep **Unsend DMs** visible. Its confirmation names the exact open thread and
scope, then starts one streaming traversal without a preliminary history count.
Advanced controls hold the read-only diagnostic and finite newest/oldest scopes.
Report only verified removals and stop reasons.

### Workspace

Show paired state, exact origin, read/action permissions, extension version, last
bridge contact, and Open Workspace. Pair/revoke and privacy guidance use concise
disclosures; remove feature-marketing cards.

## State language

Primary state vocabulary is fixed:

- `waiting for target`
- `ready`
- `confirming`
- `running`
- `completed`
- `expired`
- `canceled`
- `safe stop`
- `uncertain`

Expiry updates never extend the capability and are not announced every second.
`aria-live` announces only major state transitions. Every destructive state
shows the exact username or conversation identity beside it.

## Collision and execution-safe mode

The overlay never moves or restyles Instagram. When a relevant native target
menu, confirmation dialog, or controlled execution surface appears:

1. record prior shell state;
2. reduce the panel to a compact status strip on the opposite safe edge;
3. show exact target and current state, plus Cancel only while cancellation is
   still semantically valid;
4. prove no rectangle intersection with the target control, message row, menu,
   or dialog;
5. restore only after the native surface closes and the page context revalidates.

If no safe strip placement exists, collapse to the launcher and announce the
safe stop. The overlay never synthesizes a click, hides a native control, or
claims cancellation rolled back an already-dispatched action.

## Architecture

Use ordered classic content-script modules under `extension/overlay/`; do not add
a framework or remote asset:

```text
extension/overlay/
├── shared.js
├── preferences.js
├── route-observer.js
├── theme.js
├── bridge.js
├── downloads.js
├── accessibility.js
├── icons.js
├── shell.js
├── collision.js
└── views/
    ├── now.js
    ├── capture.js
    ├── queue.js
    ├── messages.js
    └── workspace.js
extension/instagram-overlay.js   # lifecycle bootstrap only
```

Boundaries:

- normalization and preference migration are pure and directly tested;
- bridge calls never render;
- views never persist;
- downloads own every object URL and revoke them on replacement/teardown;
- shell owns static markup, tokens, and safe `textContent` insertion;
- route observer compares URLs through Navigation API, `popstate`, and one
  bounded/debounced DOM observer—never a recurring location timer;
- collision module only observes and measures; it never activates Instagram;
- bootstrap owns listeners and one idempotent teardown;
- the isolated-world namespace exposes no secret or destructive token to the
  page;
- build/package validation scans every ordered module for forbidden `.click()`,
  synthetic dispatch, polling, remote assets, and unsafe dynamic HTML.

## Performance budgets

- Collapsed idle: no recurring timer; zero context inspection without a pending
  exact request; mutation callbacks only compare route/theme/surface signals.
- Open idle: no full rerender on unrelated Instagram mutations.
- Route transition: one debounced context refresh, target under 50 ms in fixture.
- Active-run expiry: update at most one text node per second and stop at expiry.
- 2,000-item queue: bounded normalization and no more than the current item plus
  a small history/preview window in the DOM.
- Teardown: remove listeners/observers/timers and revoke every object URL.

## Required verification

Direct runtime tests must cover V1→V2 migration, fresh collapsed default,
dock/width/theme/density persistence, semantic tab keyboard behavior, route
deduplication and teardown, theme changes, immutable expiry, collision mode,
storage failures, bridge reconnect, bounded 2,000-item rendering, and object URL
cleanup.

Visual QA must use the built production scripts across the committed scenario,
viewport, theme, 200% zoom, mobile-landscape, forced-color, and native-surface
matrix. Geometry assertions are separate from screenshot comparison. Baselines
are explicitly updated and platform-specific.

## Verification boundary

Automated fixture checks cover the production runtime matrix, geometry, state
semantics, and platform-specific screenshots. Authenticated persistent-profile
fit, human screen-reader acceptance, and any real Follow, Unfollow, or Unsend
action require separate operator review.

Implementation details are in
[OVERLAY_UI_IMPLEMENTATION.md](./OVERLAY_UI_IMPLEMENTATION.md).
