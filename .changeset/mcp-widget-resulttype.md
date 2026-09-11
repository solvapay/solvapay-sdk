---
'@solvapay/mcp': patch
'@solvapay/mcp-core': patch
---

Widget `resources/read` now goes through `mcpWidgetResource`, so the 2026-07-28 era gets `resultType` / catalog cache stamps. TypeScript engine-mode `/mcp` no longer returns `-32603` for the widget URI.
