---
'create-solvapay': minor
'@solvapay/init': minor
'solvapay': minor
---

Add `create-solvapay` umbrella scaffolder and `@solvapay/init`
shared lib.

`npm create solvapay <name> -- --type mcp` scaffolds a SolvaPay-monetized
Cloudflare Workers MCP server in one pass. v1 ships one project type
(`mcp`) with two sub-modes:

- `from-openapi` — generate one MCP tool per spec operation, with
  one-to-one tier defaults from `suggestedTier`.
- `from-scratch` — drop in a single placeholder paid tool (camelCase
  name, default `helloTool`) so the project deploys without writing any
  code first.

The umbrella shape leaves `--type cli`, `--type api`, etc. as additive
follow-ups that do not require a new npm package.

`@solvapay/init` is the shared lib both `solvapay` and
`create-solvapay` depend on (browser auth, env writers, product picker,
install runner, `runInitInDirectory`). The `solvapay init` CLI's
externally observable behaviour is byte-identical to 1.0.x; the minor
bump on `solvapay` reflects the new transitive `@solvapay/init`
dependency.

Intent-driven tool clustering is intentionally only available via the
`solvapay/create-mcp-app` skill (Cursor / Claude Code) — it needs an LLM
agent to author the resulting `src/tools/*.ts` files.
