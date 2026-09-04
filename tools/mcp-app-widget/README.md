# Shared MCP App widget artifact

Canonical `mcp-app.html` vendored into every language SDK so non-Node
runtimes do not need a Vite toolchain. Copy destinations live in
`contract/manifest/repo-paths.yaml` (`mcpAppWidget*` lookups).

Rebuild the single-file bundle from this package, then vendor:

```bash
pnpm --filter @solvapay/mcp-app-widget build
pnpm exec tsx tools/mcp-app-widget/vendor.ts
```

`check.ts` fails CI when any SDK copy drifts from the canonical file,
or when the artifact is a stub (no bundled script / bootstrap URI / too
small).
