
## OpenAPI mode notes

This project was scaffolded from an OpenAPI spec.

In one-to-one mode, each operation marked `paid` or `free` in
`selections.json` is wired into `src/tools/` as an MCP tool.

In intent-driven mode, scaffold writes the project skeleton and the agent
authors `src/tools/*.ts` by hand. The shipped tool contract is the
agent-authored intent files, not a one-file-per-operation export.

To regenerate from an updated spec, re-run
`npm create solvapay <name> -- --type mcp --openapi <spec>` against
a **fresh target directory** — the scaffolder intentionally refuses to
overwrite an existing one. Diff the new directory against this one and
copy over the relevant changes.

For intent-driven tool clustering (one MCP tool spanning multiple upstream
operations), use Cursor or Claude Code with the `solvapay/create-mcp-app`
skill loaded. The terminal-only `npm create solvapay` shortcut emits
one-to-one tools.
