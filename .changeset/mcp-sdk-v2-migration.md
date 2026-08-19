---
'@solvapay/mcp': minor
---

Migrate to the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/core@2.0.0`). The peer dependency swaps from `@modelcontextprotocol/sdk` to the split v2 packages, the `zod` peer is now `^4.2.0`, and `engines.node` is `>=20`.

**`createSolvaPayMcpFetchHandler` changes shape.** `server: McpServer` is replaced by `factory: McpServerFactory`, so a fresh server is constructed per request via `createMcpHandler`. The `McpHandlerMode` / `mode` option (`sse-stateful`, `json-stateless`, …) is removed — use `responseMode: 'json' | 'sse' | 'auto'` to shape modern-era responses. 2025-era clients are still served through the SDK's default `legacy: 'stateless'` leg, so existing hosts keep working.

**MCP Apps helpers now come from `@solvapay/mcp`.** `@modelcontextprotocol/ext-apps` has no v2 build, so its three server-side symbols (`registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`) are vendored here and exported from this package alongside `RESOURCE_URI_META_KEY`; the ext-apps server peer is dropped. Replace `import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'` with `import { registerAppTool } from '@solvapay/mcp'`. Client-side ext-apps usage inside iframe bundles is unaffected.

All `registerTool` and intent-tool schemas are explicitly `z.object()`-wrapped for zod 4.2+ compatibility with the SDK's bundled converter.

Fixes `registerPayable` handler-arg inference: `InferHandlerArgs` resolved a raw-shape `schema` to `Record<string, unknown>`, so handlers saw `unknown` args instead of the inferred type. Raw shapes and `z.object()` schemas both infer correctly again.

The `@solvapay/mcp-core` peer is now the explicit range `^0.3.0` — the two packages ship in lockstep and this release requires the new `hideToolsByAudience` surface.
