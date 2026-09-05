---
'@solvapay/react': patch
'create-solvapay': patch
---

Blend the MCP widget into the host canvas: transparent `html`/`body`, a hairline card (no fill or shadow) sourced from `--color-border-primary` / `--border-radius-xl`, and a `color-scheme` meta on the scaffolder and example iframes so first paint matches the host before `applyDocumentTheme` runs.
