# Design system

One visual language for both surfaces: the extension overlay and the
Tampermonkey toolbox. Everything here is defined once, in
`extension/overlay/tokens.js`, and consumed by both.

## Why this exists

Before this document the two surfaces shared **nothing**. A survey of the two
stylesheets found:

| | Extension overlay | Tampermonkey toolbox |
|---|---|---|
| Selectors and custom properties | 88 | 49 |
| Names defined in **both** | 0 | 0 |
| Hardcoded colour literals | 28 | 76 |
| Instagram CSS variables used | 0 | 14 |

Two independent palettes, two naming schemes (`.insta-toolbox-*` against `.panel`/`.tab`),
104 colour literals between them, and only one of the two integrating with
Instagram's own theme at all. A change to one surface never reached the other,
and dark mode was correct in one place and approximated in the other.

## Instagram integration

Instagram publishes its palette as CSS custom properties on the document. The
tokens read those first and fall back to fixed values, so the panel follows the
page's light and dark treatment without needing to detect the theme:

```css
--insta-toolbox-accent: #b83d67;
--insta-toolbox-text: rgb(var(--ig-primary-text, 0 0 0));
--insta-toolbox-line: rgb(var(--ig-separator, 219 219 219));
```

If Instagram renames a variable the fallback keeps the panel readable rather
than unstyled. This is visual compatibility only. The project is independent and
is not affiliated with or endorsed by Instagram or Meta, and nothing here copies
Instagram assets, marks, or proprietary styling.

## Semantic colour roles

Roles, never raw colours. A component asks for `--insta-toolbox-danger`, not a hex value.

| Role | Token | Used for |
|---|---|---|
| Surface | `--insta-toolbox-bg` | Panel body |
| Raised surface | `--insta-toolbox-bg-raised` | Header, footer, cards |
| Sunken surface | `--insta-toolbox-bg-sunken` | Tab strip, track fills |
| Text | `--insta-toolbox-text` | Primary copy |
| Muted text | `--insta-toolbox-text-muted` | Secondary copy, captions |
| Separator | `--insta-toolbox-line` | Borders and rules |
| Accent | `--insta-toolbox-accent` | Primary action, selected tab |
| On accent | `--insta-toolbox-on-accent` | Text and icons on an accent or danger fill |
| Success | `--insta-toolbox-success` | Completed, proven removal |
| Warning | `--insta-toolbox-warning` | Running, paused, incomplete scan |
| Danger | `--insta-toolbox-danger` | Destructive action, failed, blocked |
| Uncertain | `--insta-toolbox-uncertain` | Postcondition not proven |
| Focus ring | `--insta-toolbox-focus` | Keyboard focus |

`--insta-toolbox-uncertain` is deliberately distinct from `--insta-toolbox-danger`. An uncertain
outcome is not a failure: the action may have happened. Colouring the two the
same would tell the reader something the tool does not know.

## State palette

Every interactive element resolves to exactly one state.

| State | Treatment |
|---|---|
| `primary` | Accent fill, white text |
| `secondary` | Transparent fill, accent text, accent border |
| `quiet` | Transparent fill, muted text, no border until hover |
| `warning` | Warning border and text |
| `destructive` | Danger fill, white text, requires confirmation |
| `success` | Success text with a check |
| `selected` | Accent underline, `aria-selected="true"` |
| `disabled` | 45% opacity, `not-allowed`, `aria-disabled` |
| `locked` | Muted with a lock, explains what is required |
| `armed` | Legacy bridge state; never exposed as a user-facing unlock control |
| `running` | Warning border with progress |
| `paused` | Muted border, resume affordance |
| `stopped` | Danger border, exact stop reason |
| `uncertain` | Uncertain border, states what could not be proven |

`locked`, `armed`, `stopped`, and `uncertain` are internal presentation classes.
Current destructive flows expose an ordinary exact confirmation and a bounded
running state; they do not expose an arm button, typed phrase, or global unlock.

## Typography

Instagram's system stack via `--ig-font-family`, falling back to the platform UI
font. Four sizes only.

| Step | Size / line height | Used for |
|---|---|---|
| `--insta-toolbox-text-lg` | 15px / 20px | Panel title, run headline |
| `--insta-toolbox-text-md` | 14px / 20px | Body, controls |
| `--insta-toolbox-text-sm` | 13px / 18px | Secondary copy |
| `--insta-toolbox-text-xs` | 12px / 16px | Captions, counts |

Weights: 400 body, 600 emphasis and controls. No other weights, so the panel
never competes with post content beside it.

## Spacing, radii, borders

A 4px scale: `--insta-toolbox-space-1` 4px through `--insta-toolbox-space-6` 24px. Nothing between
steps.

Radii follow Instagram's own shapes: `--insta-toolbox-radius-sm` 6px for inputs,
`--insta-toolbox-radius-md` 8px for buttons and cards, `--insta-toolbox-radius-lg` 16px for the
panel.

Borders are always 1px `--insta-toolbox-line`. Emphasis comes from colour, not thickness.

## Elevation

Three levels. The panel floats over Instagram, so shadows stay soft and shallow
to avoid reading as a modal.

- `--insta-toolbox-shadow-panel` — the panel against the page
- `--insta-toolbox-shadow-popover` — settings and menus above the panel
- `--insta-toolbox-shadow-none` — flat cards inside the panel

## Focus and hit targets

Focus is a 2px `--insta-toolbox-focus` ring at 2px offset, applied through
`:focus-visible` so pointer users do not see it. It is never removed, only
repositioned.

Interactive targets are at least 44×44px. Visually smaller controls keep the
target via padding or a pseudo-element, so a 20px icon still has a 44px hit box.

## Density and breakpoints

`comfortable` is the default. `compact` reduces vertical padding one step and
leaves font sizes and hit targets untouched — it must not shrink targets.

| Breakpoint | Behaviour |
|---|---|
| `>= 900px` tall | Full panel |
| `< 900px` tall | Short-laptop: compact single-row header stays fixed; body scrolls |
| `< 768px` wide | Tablet: single column |
| `< 600px` wide | Mobile: bottom sheet, drag and resize disabled |
| 200% zoom | Treated as the narrow case |

## Motion

Motion explains a state change. It never decorates.

| Token | Duration | Used for |
|---|---|---|
| `--insta-toolbox-motion-fast` | 120ms | Hover, focus |
| `--insta-toolbox-motion-base` | 180ms | Tabs, disclosures |
| `--insta-toolbox-motion-slow` | 240ms | Panel open and close |

Easing is `--insta-toolbox-ease` `cubic-bezier(.2,.7,.3,1)` — quick to start, settling at
the end.

Rules:

- No ambient or looping motion, no parallax, no large transforms.
- No continuous blur. The panel's backdrop blur is a static value, never animated.
- Progress bars transition width only.
- Under `prefers-reduced-motion: reduce`, all transitions and animations are
  removed. State still changes; it just arrives immediately.
- Focus never moves as a result of a transition.

## Forced colors

Under `forced-colors: active` the tokens step aside: surfaces become `Canvas`,
text `CanvasText`, accents and focus `Highlight`, and every border becomes a
solid 1px `CanvasText` so structure survives without colour. Nothing depends on
a colour that forced-colors mode discards.

## Using the tokens

Both surfaces call the same function and inject the result into their shadow
root:

```js
const styles = globalThis.InstaToolboxTokens.css({ density: 'comfortable' });
```

Rules for contributors:

1. Never write a colour literal in a component. Add a role if none fits.
2. Never write a pixel spacing value outside the scale.
3. Never remove a focus ring.
4. Never introduce a state outside the table above.
5. Changing a token changes both surfaces — that is the point. Check both.
