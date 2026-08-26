# Shared MCP App widget artifact

Canonical `mcp-app.html` vendored into every language SDK so non-Node
runtimes do not need a Vite toolchain.

Rebuild the single-file bundle from this package, then vendor:

```bash
pnpm --filter @solvapay/mcp-app-widget build
node tools/mcp-app-widget/vendor.mjs
```

`check.mjs` fails CI when any SDK copy drifts from the canonical file,
or when the artifact is a stub (no bundled script / bootstrap URI / too
small).
