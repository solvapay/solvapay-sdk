---
'@solvapay/react': minor
'create-solvapay': patch
---

Unify MCP commerce surfaces under one layout law: primary content leads, Seller → Your account trails, and the identity rail stays visible at every width.

`<McpApp>` now reads the host `displayMode` and advertises `inline` + `fullscreen`. A user-initiated Full view control calls `requestDisplayMode` when the host offers it. The example and `create-solvapay` templates pass `SOLVAPAY_MCP_APP_CAPABILITIES` into `new App()`.
