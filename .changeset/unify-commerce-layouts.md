---
'@solvapay/react': minor
'create-solvapay': patch
---

Unify MCP commerce surfaces under one layout law: primary content leads, Seller → Your account trails, and the identity rail stays visible at every width.

`<McpApp>` now reads the host `displayMode` and advertises `inline` + `fullscreen`. The example and `create-solvapay` templates pass `SOLVAPAY_MCP_APP_CAPABILITIES` into `new App()`.

Inline chrome, card and footer are one centered `36rem` block on wide hosts. `.solvapay-mcp-main` still fills the iframe so the 760px density query can see host width.

Widget top-up uses 4-up credit tiles, the existing auto-recharge fields, and a 260px inline / 340px fullscreen summary rail. Plan selection is one ordered column of fixed-box rows. A limit-reached handoff names the product and opens the account — it does not invent a shortfall.
