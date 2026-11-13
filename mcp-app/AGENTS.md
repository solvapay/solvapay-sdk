# AGENTS.md — mcp-app/

Builds the SolvaPay MCP App widget (checkout, account, top-up) from
`@solvapay/react`'s MCP views into one self-contained `mcp-app.html`. It is built
once here and copied into each language's package.

- **Change the widget in `packages/react`, not here.** This folder only bundles it.
- After a change, refresh each language's copy (`python/scripts/sync_widget.py`).
  CI fails when a committed copy is stale.
- The build must stay byte-for-byte reproducible: workspace packages resolve
  from source (see `vite.config.ts`), so the output never depends on a `dist/`.
