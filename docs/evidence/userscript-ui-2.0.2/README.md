# Userscript UI evidence — 2.0.2

These synthetic Chromium captures cover the compact Tampermonkey overlay at short-laptop, narrow-panel, mobile, light, dark, and true 200% zoom sizes. The narrow-panel and true-200% confirmation captures open the real DM review dialog and cancel it before any runner or message action starts. They contain fixture names only; no Instagram account or message data is present.

These reviewed Windows captures are preserved from the 2.0.2 acceptance run. The current `pnpm run qa:extension` command writes current-version evidence under `test-results/extension-acceptance/userscript-layout/`.

The acceptance runner also checks section overlap, panel escape, duplicate IDs, settings geometry, usable move controls, resolved light/dark colors, and the 200% CSS viewport before writing a screenshot. Confirmation checks cover exact action/thread/scope facts, initial Cancel focus, Cancel-before-Confirm order, 44×44 controls, viewport bounds, and zero-action cancellation.
