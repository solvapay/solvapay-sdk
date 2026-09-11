---
'create-solvapay': patch
'@solvapay/init': patch
---

Fix the Rust MCP template's missing `output_schema` field, hide UI-only tools in the Python factory, and refresh TypeScript SolvaPay caret pins / offline fallbacks (including `@solvapay/server-wasm` and `@solvapay/core`) so scaffolds match the post-release train (`core` 2.0.0, `server` 3.0.0, `mcp` 1.0.0, `react` 3.0.0, `server-wasm` 0.2.0).
