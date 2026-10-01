---
'@solvapay/react': patch
---

The MCP checkout "How many credits?" step uses the same full-width preset tiles as the top-up view. The old `.solvapay-mcp-amount-option` chip styles are removed; `amountOptions` and `amountOption` className slots remain but are unused.
