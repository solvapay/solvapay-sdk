
## OpenAPI mode notes

This project was scaffolded from an OpenAPI spec. Each operation marked
`paid` or `free` in `selections.json` is wired into `src/tools/` as a
SolvaPay-paywalled MCP tool.

To regenerate from an updated spec, re-run
`npm create solvapay <name> -- --type mcp --openapi <spec>` against
a **fresh target directory** — the scaffolder intentionally refuses to
overwrite an existing one. Diff the new directory against this one and
copy over the relevant changes.

For intent-driven tool clustering (one MCP tool spanning multiple
upstream operations), run the scaffolder through Cursor or Claude Code
with the `solvapay/create-mcp-app` skill loaded — intent-driven mode needs
an LLM agent to author the resulting `src/tools/*.ts` files.
