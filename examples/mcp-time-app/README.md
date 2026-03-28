# MCP time app example

This example shows a minimal MCP App with:

- a tool (`get-current-time`) that returns the current server time
- a UI resource linked through `_meta.ui.resourceUri`
- an interactive view with a button to update the displayed time

## Run the example

```bash
pnpm install
pnpm --filter @example/mcp-time-app build
pnpm --filter @example/mcp-time-app serve
```

The server runs over stdio, so you can attach it from an MCP host that supports MCP Apps.
