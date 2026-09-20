---
'create-solvapay': patch
---

Fix the MCP scaffold so generated projects advertise `/mcp`, install `@solvapay/mcp-core`, and resolve offline fallbacks against current npm latest. Exact `@solvapay/*` pins stay exact — the failure that prompted this started when a caret floated onto a peer-widening patch.
