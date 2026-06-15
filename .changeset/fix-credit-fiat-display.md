---
"@solvapay/react": patch
---

Credit balances now show a consistent, correct fiat estimate in the balance badge and MCP account card (previously the account card was ~100x too high). Uses the shared `creditsToDisplayMinorUnits` helper from `@solvapay/mcp-core`.
