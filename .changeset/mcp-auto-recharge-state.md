---
'@solvapay/mcp-core': patch
'@solvapay/react': patch
---

MCP account now shows real auto-recharge status and links out to the hosted portal form. Top-up `create_payment_intent` forwards `autoRecharge` so the inline toggle actually persists. `McpAutoRechargeView` and the `views.autoRecharge` override are removed — `view: 'auto-recharge'` renders the account surface.
