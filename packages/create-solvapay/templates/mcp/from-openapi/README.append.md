## OpenAPI mode notes

This project was scaffolded from an OpenAPI spec.

In one-to-one mode, each operation marked `paid` or `free` in
`selections.json` is wired into `src/tools/` as an MCP tool.

In intent-driven mode, scaffold writes the project skeleton and the agent
authors `src/tools/*.ts` by hand. The shipped tool contract is the
agent-authored intent files, not a one-file-per-operation export.

When you generate upstream TypeScript types, check the actual success response
codes and schema shapes before typing handlers. Create operations commonly
return `201`, not `200`; delete operations may return `204` with no JSON body.

To regenerate from an updated spec, re-run
`npm create solvapay <name> -- --type mcp --openapi <spec>` against
a **fresh target directory** — the scaffolder intentionally refuses to
overwrite an existing one. Diff the new directory against this one and
copy over the relevant changes.

For intent-driven tool clustering (one MCP tool spanning multiple upstream
operations), use Cursor or Claude Code with the `solvapay/create-mcp-app`
skill loaded. The terminal-only `npm create solvapay` shortcut emits
one-to-one tools.

If the spec has no absolute `servers` URL, confirm the real upstream API base
URL before writing intent tools. Keep that URL centralized in a small helper
instead of repeating literals across handlers.
