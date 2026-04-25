---
name: upstream sdk fixes goldberg workarounds
overview: Fold the three SDK workarounds from the `supabase-edge-mcp` Goldberg example back into `@solvapay/*` packages so future consumers get stateless-mode MCP, UI-only tool filtering, and edge entrypoint parity out of the box — then simplify the example down to the minimum it actually demonstrates.
todos:
  - id: draft-mode-option
    content: Implement `mode` + `buildTransport` options in packages/mcp-fetch/src/handler.ts with per-mode transport construction and a shared connect-close mutex
    status: pending
  - id: add-stateless-test
    content: "Add packages/mcp-fetch/src/__tests__/handler-stateless-json.test.ts covering initialize → initialized → tools/list → tools/call with mode: 'json-stateless' and a 50x concurrency check"
    status: pending
  - id: hide-tools-option
    content: Add `hideToolsByAudience` option to CreateSolvaPayMcpServerOptions in packages/mcp/src/server.ts with tools/list handler wrap
    status: pending
  - id: hide-tools-test
    content: Add packages/mcp/src/__tests__/hide-tools-by-audience.test.ts covering tools/list filtering + tools/call still reaching hidden tools
    status: pending
  - id: edge-exports-regression-test
    content: Add packages/server/src/__tests__/edge-exports.test.ts asserting every symbol imported via `@solvapay/server` is present on the built edge entrypoint
    status: pending
  - id: changesets
    content: Write .changeset/mcp-fetch-stateless-modes.md (minor) and .changeset/mcp-hide-tools-by-audience.md (minor); optionally .changeset/server-edge-exports-regression-test.md (patch)
    status: pending
  - id: example-cleanup
    content: "Follow-up PR: collapse examples/supabase-edge-mcp/supabase/functions/mcp/index.ts back to <30 lines using the new options; update README"
    status: pending
  - id: full-smoke-rerun
    content: After preview snapshot ships, rerun full MCPJam / ChatGPT connector smoke test to confirm no regression vs the Goldberg deploy behaviour
    status: pending
isProject: false
---


# Upstream SDK fixes for Goldberg workarounds

## Context

During the Goldberg demo stand-up we hit three SDK limitations in sequence and worked around each one in [examples/supabase-edge-mcp/supabase/functions/mcp/index.ts](examples/supabase-edge-mcp/supabase/functions/mcp/index.ts). The example now carries ~80 lines of SDK-glue that should live inside `@solvapay/mcp-fetch` + `@solvapay/mcp` so any future integrator on a Web-standards runtime can wire up a paywalled MCP server in <30 lines.

Target state: the example file goes back to calling `createSolvaPayMcpFetchHandler(...)` directly with one new option, and the SDK grows a handful of well-typed knobs that every workaround we did collapses into.

```mermaid
flowchart LR
  eg[examples/supabase-edge-mcp/index.ts] -->|today: 180 lines, deep SDK internals| sdk1[workaround soup]
  eg -->|after plan: ~30 lines, one createSolvaPayMcpFetchHandler| sdk2[createSolvaPayMcpFetchHandler + audienceFilter]
  sdk2 -->|mode: stateless-json + BYO transport| transport[@mcp/sdk WebStandardStreamableHTTPServerTransport]
  sdk2 -->|hideToolsByAudience| coreServer["createSolvaPayMcpServer"]
```

## Issue inventory

### 1. `@solvapay/mcp-fetch` — `createSolvaPayMcpFetchHandler` broken for stateless fetch runtimes

Three compounding bugs in [packages/mcp-fetch/src/handler.ts](packages/mcp-fetch/src/handler.ts). Example workarounds live in [examples/supabase-edge-mcp/supabase/functions/mcp/index.ts](examples/supabase-edge-mcp/supabase/functions/mcp/index.ts).

- **Destructure default swallows `undefined`** — `sessionIdGenerator = defaultSessionIdGenerator` (line ~101) converts a caller-supplied `sessionIdGenerator: undefined` into the UUID generator. The transport's stateless-mode branch at `webStandardStreamableHttp.js:585` is unreachable from consumers of this helper.
- **No `transport.close()` after handling** — handler ~lines 159-180 does `new WebStandardStreamableHTTPServerTransport(...)` + `server.connect(transport)` but never closes. The second request throws `Already connected to a transport` from `shared/protocol.js:216` because the server's `_transport` slot is still occupied (only nulled by `transport.close()` → `_onclose()`).
- **No way to enable JSON-response mode** — transport defaults to SSE streaming; tool results arrive async on the stream. Pair that with a proper close in the finally block and the stream gets cancelled before the tool-result frame lands, so clients see HTTP 200 with an empty body.

### 2. `@solvapay/mcp-core` — no first-class way to hide UI-only virtual tools from `tools/list`

[packages/mcp-core/src/descriptors.ts](packages/mcp-core/src/descriptors.ts) registers seven transport tools (`create_checkout_session`, `create_payment_intent`, `process_payment`, `create_customer_session`, `create_topup_payment_intent`, `cancel_renewal`, `reactivate_renewal`) unconditionally with `_meta.audience: 'ui'`. LLM-facing hosts (Claude Haiku via MCPJam, ChatGPT connectors) that don't embed the SolvaPay iframe see them in the tool catalogue and try to reason about them. Our first workaround (`registeredTool.enabled = false`) broke `tools/call` for the iframe; the current workaround reaches into `(server as any).server._requestHandlers` and wraps the `tools/list` handler.

### 3. `@solvapay/server` — `edge.ts` entrypoint lagging `index.ts`

Already patched in commit `4a7c769` and shipped via `@preview`. Listed here only because the next Version Packages PR on `main` needs to consume the existing [.changeset/server-edge-exports.md](.changeset/server-edge-exports.md) so the fix lands on stable `latest`. No new code required.

## Fix 1 — `@solvapay/mcp-fetch`: make `createSolvaPayMcpFetchHandler` stateless-fetch-safe

Single-option API with an explicit three-value `mode` that maps each value to the SDK transport options we now know we need. Preserves the current default (backwards-compatible with Node / Express / Bun deployments).

Edit [packages/mcp-fetch/src/handler.ts](packages/mcp-fetch/src/handler.ts):

```ts
export type McpHandlerMode =
  | 'sse-stateful'        // default (today's behaviour: SSE streaming + UUID session IDs)
  | 'json-stateless'      // Web-standards stateless runtimes (Deno / Supabase Edge / CF Workers / Vercel Edge)
  | 'sse-stateless'       // SSE with no session IDs (hypothetical; document as advanced)

export interface CreateSolvaPayMcpFetchHandlerOptions {
  // ...existing...
  /** Transport wiring preset. Defaults to `'sse-stateful'`. */
  mode?: McpHandlerMode
  /**
   * Escape hatch: bring your own transport. When provided, `mode`
   * is ignored and `sessionIdGenerator` / `enableJsonResponse` are
   * the caller's responsibility. The handler still manages
   * `server.connect(transport)` + `transport.close()` per request.
   */
  buildTransport?: () => WebStandardStreamableHTTPServerTransport
}
```

Handler body around line 113-197:

- For `mode: 'json-stateless'` build the transport as `{ sessionIdGenerator: undefined, enableJsonResponse: true }` inside the per-request closure.
- For `mode: 'sse-stateful'` preserve today's behaviour exactly.
- In all modes, wrap the `await transport.handleRequest(...)` in `try { ... } finally { await transport.close().catch(() => {}) }` so the server's `_transport` slot is released. The close is safe on SSE-stateful too because the transport's `close()` is idempotent (see `webStandardStreamableHttp.js:630-639`).
- Add a narrow `Promise`-chain mutex around `connect` / `close` so concurrent requests serialize through the single shared `McpServer` (the current example already does this — move it into the SDK).

New test at `packages/mcp-fetch/src/__tests__/handler-stateless-json.test.ts`:

1. Construct a minimal `McpServer` with one echo tool.
2. Wire `createSolvaPayMcpFetchHandler({ server, mode: 'json-stateless', requireAuth: false, ... })`.
3. Send `initialize` → expect `200` + JSON body with `serverInfo`.
4. Send `notifications/initialized` → expect `202`.
5. Send `tools/list` → expect `200` + JSON body with the echo tool present.
6. Send `tools/call` → expect `200` + JSON body with the echo result.
7. Hit the handler 50x concurrently with `tools/list` to confirm the mutex + close cycle works under load (no "Already connected" errors).

Changeset: `.changeset/mcp-fetch-stateless-modes.md` — `minor` bump on `@solvapay/mcp-fetch` because the new field is additive, default behaviour unchanged.

## Fix 2 — `@solvapay/mcp`: `hideToolsByAudience` option

Edit [packages/mcp/src/server.ts](packages/mcp/src/server.ts) (`CreateSolvaPayMcpServerOptions` around line 64):

```ts
export interface CreateSolvaPayMcpServerOptions extends BuildSolvaPayDescriptorsOptions {
  // ...existing...
  /**
   * After registration, wrap the `tools/list` handler to drop any
   * tool whose `_meta.audience` matches one of these values. The
   * tools stay `enabled: true` so `tools/call` still reaches their
   * handlers — this option only affects the `tools/list` response
   * shape. Use `['ui']` when deploying to a text-host MCP client
   * (Claude Desktop, MCPJam, ChatGPT connectors) that won't embed
   * the SolvaPay iframe surface.
   */
  hideToolsByAudience?: string[]
}
```

Implementation (appends after the existing `createSolvaPayMcpServer(...)` body, just before it returns the server):

```ts
if (options.hideToolsByAudience?.length) {
  const hidden = new Set(options.hideToolsByAudience)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = (server as any).server
  const handlers = inner._requestHandlers as Map<string, (req: unknown, extra: unknown) => Promise<ListToolsResult>>
  const original = handlers.get('tools/list')
  if (original) {
    handlers.set('tools/list', async (req, extra) => {
      const res = await original(req, extra)
      return {
        ...res,
        tools: (res.tools ?? []).filter(
          t => !hidden.has(String(((t._meta as { audience?: unknown } | undefined)?.audience) ?? '')),
        ),
      }
    })
  }
}
```

The reach into `_requestHandlers` is the one piece of SDK-internal knowledge we have to live with — the underlying `Protocol.setRequestHandler` calls `assertRequestHandlerCapability` but NOT `assertCanSetRequestHandler`, so it works but the public `server.setRequestHandler(...)` wrapper on `McpServer` proxies through a path that _does_ assert. The internal-map approach sidesteps that. Document this in a comment.

Tests at `packages/mcp/src/__tests__/hide-tools-by-audience.test.ts`:

- `tools/list` without the option → all 11 tools (4 intent + 7 UI-only).
- `tools/list` with `hideToolsByAudience: ['ui']` → 4 intent tools only.
- `tools/call` on a hidden tool name still succeeds.
- Hidden tool appears in `tools/list` of a second `McpServer` instance without the option (no accidental global state).

Changeset: `.changeset/mcp-hide-tools-by-audience.md` — `minor` bump on `@solvapay/mcp`.

## Fix 3 — `@solvapay/server`/edge: already done, ship it stable

[packages/server/src/edge.ts](packages/server/src/edge.ts) already re-exports the paywall-state engine + type guards + shared payment / bootstrap types via commit `4a7c769` and [.changeset/server-edge-exports.md](.changeset/server-edge-exports.md).

Action needed:

- On the next Version Packages PR the `server-edge-exports` changeset (plus `text-only-paywall`) gets folded into a stable release. Nothing in this plan writes new code.
- Add an explicit smoke test at `packages/server/src/__tests__/edge-exports.test.ts` that imports every symbol via `@solvapay/server` (the `deno` condition resolves here to `dist/edge.js` in the built artefact) and asserts it's a function / object — guards against future regressions like the one we hit.
- Include the smoke test in the same PR as the rest of this plan so the fix is verified before next stable release.

Changeset: covered by the existing `.changeset/server-edge-exports.md` — no new changeset needed. The new smoke test counts as a `patch` bump if folded into a separate changeset (optional, recommended for clarity: `.changeset/server-edge-exports-regression-test.md`).

## Example cleanup

Once Fix 1 + Fix 2 are published (preview first, then stable), collapse [examples/supabase-edge-mcp/supabase/functions/mcp/index.ts](examples/supabase-edge-mcp/supabase/functions/mcp/index.ts) back to a ~30-line entrypoint that calls `createSolvaPayMcpFetchHandler({ ..., mode: 'json-stateless', hideToolsByAudience: ['ui'] })` directly.

Planned diff shape:

- Drop the custom `WebStandardStreamableHTTPServerTransport` singleton / mutex / per-request connect-close dance.
- Drop the `_requestHandlers` reach into the McpServer.
- Keep the Supabase-specific bits: `rewriteRequestPath` (strip `/mcp` function prefix), `applyBrowserCors` / `browserCorsPreflight` (the SDK's native-scheme-only CORS still applies).
- Keep `MCP_PUBLIC_BASE_URL` + static_files config.
- Add a short README note: "If you're deploying on a stateless fetch runtime (Supabase Edge, Cloudflare Workers, Vercel Edge), pass `mode: 'json-stateless'`."

## Release sequence

1. Land all three fixes in a single PR against `dev` (so the preview snapshot gets them atomically).
2. `publish-preview.yml` cuts a preview snapshot → example's `deno.json` keeps `@preview` dist-tag, picks them up on next deploy.
3. Run the same full MCPJam / ChatGPT connector smoke tests the Goldberg demo just passed to confirm no regression.
4. Collapse the example in a follow-up PR (fewer file changes per PR, clean diff).
5. Version Packages PR on `main` promotes the combined set to stable. Expected semver roll: `@solvapay/mcp-fetch` → minor, `@solvapay/mcp` → minor, `@solvapay/server` → already-queued minor from `text-only-paywall.md` (now with `edge-exports` patch riding along). Peer-dep cascade (documented in [.changeset/migration-hand-set-versions.md](.changeset/migration-hand-set-versions.md)) still applies; expect `react`/`mcp-core` to major-bump alongside.

## Out of scope

- Redesigning the SolvaPay OAuth bridge (`/oauth/*` paths) to be RFC-9728-compliant without a Cloudflare proxy. Separate concern; Goldberg's current proxy works.
- Session-persistence across multiple edge-function invocations (would require external storage like Deno KV / Durable Objects). `json-stateless` mode is a deliberate choice.
- Changing the default transport mode. Anything that's Node/Express today keeps working unchanged.
