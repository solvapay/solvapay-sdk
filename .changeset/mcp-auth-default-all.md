---
'@solvapay/release-train': patch
---

MCP `authMode` now defaults to `all`: `initialize` and `tools/list` return `401 + WWW-Authenticate` so hosts like MCP Jam Auto open OAuth at connect. Pass `authMode: 'tools-call'` to keep anonymous discovery. Widget `ui://` `resources/read` stays reachable before the gate on every facade.
