---
'@solvapay/react': minor
---

Fullscreen is now the hosted page, not a stretched widget: a centered 1000px column, payment rail 340 / management rail 300, no in-widget header. Below 1000px of host width the layout falls back to the inline stack. Close and the attribution footer stay. Invented `--color-*` names (`background-accent`, `text-on-accent`, `border-default`, …) are gone — the stylesheet uses the MCP Apps spec tokens.
