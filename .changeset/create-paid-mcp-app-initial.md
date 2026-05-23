---
'create-paid-mcp-app': minor
'@solvapay/cli-core': minor
'solvapay': minor
---

Add `create-paid-mcp-app` and `@solvapay/cli-core` packages.

`npm create paid-mcp-app <name>` now scaffolds a SolvaPay-monetized
Cloudflare Workers MCP server in one pass. v1 ships two modes:

- `from-openapi` — generate one MCP tool per spec operation, with
  one-to-one tier defaults from `suggestedTier`.
- `from-scratch` — drop in a single placeholder paid tool (camelCase
  name, default `helloTool`) so the project deploys without writing any
  code first.

The scaffolder runs the project-local install and the existing
`solvapay init` browser-auth + product-picker flow against the new
directory. Intent-driven tool clustering is intentionally only
available via the existing `create-paid-mcp-app` skill (Cursor / Claude
Code) — it needs an LLM agent to author the resulting `src/tools/*.ts`
files.

`@solvapay/cli-core` is the shared lib both `solvapay` and
`create-paid-mcp-app` depend on. The `solvapay init` CLI's externally
observable behaviour is byte-identical to 1.0.x; the minor bump
reflects the new transitive `@solvapay/cli-core` dependency.
