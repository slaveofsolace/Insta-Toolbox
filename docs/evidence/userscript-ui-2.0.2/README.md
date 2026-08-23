# Userscript UI evidence — 2.0.2

These synthetic Chromium captures cover the compact Tampermonkey overlay at short-laptop, narrow-panel, mobile, light, dark, and true 200% zoom sizes. They contain fixture names only; no Instagram account or message data is present.

Generate the current captures with `pnpm run qa:extension`. The source manifest is `test-results/extension-acceptance/userscript-layout/manifest.json`. The reviewed Windows captures are stored in `win32/`.

The acceptance runner also checks section overlap, panel escape, duplicate IDs, settings geometry, usable move controls, resolved light/dark colors, and the 200% CSS viewport before writing a screenshot.
