---
'@solvapay/agents': minor
---

`@solvapay/agents` is published, starting at 0.1.0: verify agent tokens, authorize and complete each paid call and report usage, with adapters for MCP servers (`@solvapay/agents/mcp`) and HTTP APIs (`@solvapay/agents/http`), plus `@solvapay/agents/testing`. It ships built ESM with type declarations. Agent payments are a preview: SolvaPay turns them on per merchant, and until then calls are refused with `feature_not_enabled`. Live agent payments aren't open yet, so build and test with a sandbox key.
