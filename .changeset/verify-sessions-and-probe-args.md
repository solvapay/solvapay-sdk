---
'solvapay': patch
---

`solvapay verify` now connects the way MCP hosts do: it sends `initialize` and `notifications/initialized`, then pins the `mcp-session-id` the server issued. Servers that keep sessions, the Python and Go SDK defaults, no longer fail every check with HTTP 400 or "invalid during session initialization".

The paywall check calls each tool with arguments built from its `inputSchema` instead of a fixed `query`/`symbol`/`ticker`, so it reaches the gate on tools that validate their arguments first. It skips widget-only tools by their `audience: "ui"` tag, still runs when the tools check fails on leaked UI tools, and says which calls errored instead of blaming the customer's balance. A token the server rejects now fails the run.

`verify` never charges: it reads `account` before probing, and when the customer can already pay (`canCall: true`) it skips the paywall check and says to sign in as a customer with no plan. If `account` fails, it skips the probe too.
