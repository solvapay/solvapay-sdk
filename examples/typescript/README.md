# SolvaPay TypeScript examples

Node / Next.js / Cloudflare Workers / Supabase Edge / MCP demos for the `@solvapay/*` packages.

These packages are workspace members (`examples/typescript/*` in `pnpm-workspace.yaml`) under the `@example/*` name scope.

## Quick start

```bash
# from repo root
pnpm install
pnpm build:packages
./examples/typescript/setup-env.sh

cd examples/typescript/express-basic
pnpm dev   # stub mode — no API key needed
```

See the [top-level examples README](../README.md) for the full catalog, and each example’s own README for deploy / env details.

## Shared utilities

[`shared/`](./shared/) — stub API client and helpers used across several demos.
