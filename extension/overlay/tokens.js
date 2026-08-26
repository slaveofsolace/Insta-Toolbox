(() => {
  'use strict';

  // Single source of visual truth for the extension overlay and the
  // Tampermonkey toolbox. See docs/DESIGN_SYSTEM.md.
  //
  // Both surfaces previously carried their own palette — 104 colour literals
  // between them and no shared name — so a fix in one never reached the other.
  // Everything visual now resolves to a role defined here.
  //
  // Instagram publishes its palette as CSS custom properties on the document.
  // Each role reads Instagram's value first and falls back to a fixed one, so
  // the panel follows the page's light and dark treatment without detecting it,
  // and stays readable if Instagram renames a variable. This is visual
  // compatibility only; the project is independent of Instagram and Meta.

  const SPACE = ['0', '4px', '8px', '12px', '16px', '20px', '24px'];

  function palette() {
    return {
      '--insta-toolbox-bg': 'rgb(var(--ig-primary-background, 255 255 255))',
      '--insta-toolbox-bg-raised': 'rgb(var(--ig-elevated-background, 255 255 255))',
      '--insta-toolbox-bg-sunken': 'rgb(var(--ig-secondary-background, 250 250 250))',
      '--insta-toolbox-text': 'rgb(var(--ig-primary-text, 0 0 0))',
      '--insta-toolbox-text-muted': 'rgb(var(--ig-secondary-text, 115 115 115))',
      '--insta-toolbox-line': 'rgb(var(--ig-separator, 219 219 219))',
      '--insta-toolbox-accent': '#b83d67',
      '--insta-toolbox-accent-violet': '#7657d6',
      '--insta-toolbox-accent-blue': '#1f6eb3',
      '--insta-toolbox-on-accent': '#fff',
      '--insta-toolbox-success': 'rgb(var(--ig-success, 0 148 84))',
      '--insta-toolbox-warning': '#b26a00',
      '--insta-toolbox-danger': 'rgb(var(--ig-error-or-destructive, 237 73 86))',
      // Deliberately not the danger colour: an uncertain outcome may well have
      // succeeded, and colouring it as a failure would assert what we do not know.
      '--insta-toolbox-uncertain': '#7a5cc4',
      '--insta-toolbox-focus': '#b83d67',
    };
  }

  function scale(density) {
    const tight = density === 'compact';
    return {
      '--insta-toolbox-space-1': SPACE[1],
      '--insta-toolbox-space-2': SPACE[2],
      '--insta-toolbox-space-3': SPACE[3],
      '--insta-toolbox-space-4': SPACE[4],
      '--insta-toolbox-space-5': SPACE[5],
      '--insta-toolbox-space-6': SPACE[6],
      // Compact trims vertical rhythm only. Hit targets and font sizes are
      // never reduced, so a denser panel stays as usable as a roomy one.
      '--insta-toolbox-pad-y': tight ? SPACE[2] : SPACE[3],
      '--insta-toolbox-pad-x': tight ? SPACE[3] : SPACE[4],
      '--insta-toolbox-gap': tight ? SPACE[2] : SPACE[3],
      '--insta-toolbox-radius-sm': '6px',
      '--insta-toolbox-radius-md': '8px',
      '--insta-toolbox-radius-lg': '16px',
      '--insta-toolbox-border': '1px',
      '--insta-toolbox-target': '44px',
      '--insta-toolbox-text-lg': '15px',
      '--insta-toolbox-text-md': '14px',
      '--insta-toolbox-text-sm': '13px',
      '--insta-toolbox-text-xs': '12px',
      '--insta-toolbox-leading-lg': '20px',
      '--insta-toolbox-leading-md': '20px',
      '--insta-toolbox-leading-sm': '18px',
      '--insta-toolbox-leading-xs': '16px',
      '--insta-toolbox-weight-normal': '400',
      '--insta-toolbox-weight-strong': '600',
      '--insta-toolbox-font': 'var(--ig-font-family, "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif)',
      '--insta-toolbox-shadow-panel': '0 12px 40px rgba(0, 0, 0, .18)',
      '--insta-toolbox-shadow-popover': '0 8px 24px rgba(0, 0, 0, .16)',
      '--insta-toolbox-shadow-none': 'none',
      '--insta-toolbox-motion-fast': '120ms',
      '--insta-toolbox-motion-base': '180ms',
      '--insta-toolbox-motion-slow': '240ms',
      '--insta-toolbox-ease': 'cubic-bezier(.2, .7, .3, 1)',
    };
  }

  function declarations(density) {
    return Object.entries({ ...palette(), ...scale(density) })
      .map(([name, value]) => `${name}: ${value};`)
      .join(' ');
  }

  // Shared primitives. Component styles live with their surface; anything that
  // decides colour, focus, target size, or motion lives here.
  function primitives() {
    return `
    .insta-toolbox-focusable:focus { outline: none; }
    .insta-toolbox-focusable:focus-visible {
      outline: 2px solid var(--insta-toolbox-focus);
      outline-offset: 2px;
    }
    /* A control may look small but must never be small to hit. */
    .insta-toolbox-target { min-width: var(--insta-toolbox-target); min-height: var(--insta-toolbox-target); }
    .insta-toolbox-state-locked { color: var(--insta-toolbox-text-muted); }
    .insta-toolbox-state-armed { border-color: var(--insta-toolbox-danger); color: var(--insta-toolbox-danger); }
    .insta-toolbox-state-running { border-color: var(--insta-toolbox-warning); color: var(--insta-toolbox-warning); }
    .insta-toolbox-state-paused { border-color: var(--insta-toolbox-line); color: var(--insta-toolbox-text-muted); }
    .insta-toolbox-state-stopped { border-color: var(--insta-toolbox-danger); color: var(--insta-toolbox-danger); }
    .insta-toolbox-state-uncertain { border-color: var(--insta-toolbox-uncertain); color: var(--insta-toolbox-uncertain); }
    .insta-toolbox-state-success { color: var(--insta-toolbox-success); }
    .insta-toolbox-state-selected { color: var(--insta-toolbox-accent); }
    [disabled], [aria-disabled="true"] { opacity: .45; cursor: not-allowed; }

    @media (prefers-reduced-motion: reduce) {
      /* State still changes; it simply arrives without travel. */
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    }

    @media (forced-colors: active) {
      /* Structure has to survive without colour, so every edge becomes real. */
      .insta-toolbox-surface, .insta-toolbox-raised, .insta-toolbox-sunken { background: Canvas; color: CanvasText; }
      .insta-toolbox-surface, .insta-toolbox-raised, .insta-toolbox-sunken, .insta-toolbox-card { border: 1px solid CanvasText; }
      .insta-toolbox-focusable:focus-visible { outline-color: Highlight; }
      .insta-toolbox-state-selected { color: Highlight; }
    }`;
  }

  const api = Object.freeze({
    css(options = {}) {
      const density = options.density === 'compact' ? 'compact' : 'comfortable';
      const scope = options.scope || ':host';
      return `${scope} { ${declarations(density)} }\n${primitives()}`;
    },
    declarations,
    palette,
    scale,
    // Exposed so tests can assert the contract rather than re-reading strings.
    roles: Object.freeze(Object.keys(palette())),
    steps: Object.freeze(Object.keys(scale('comfortable'))),
  });

  Object.defineProperty(globalThis, 'InstaToolboxTokens', {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();
