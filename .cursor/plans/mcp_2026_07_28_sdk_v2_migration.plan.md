---
name: MCP 2026-07-28 / official SDK v2 migration
overview: "The MCP specification revision 2026-07-28 is now reachable only through the official TypeScript SDK v2, which shipped GA at `2.0.0` and replaces the single `@modelcontextprotocol/sdk` package with a scope of split packages (`@modelcontextprotocol/core`, `/server`, `/client`, `/node`, `/express`, `/hono`, `/fastify`). The wire protocol goes stateless — no `initialize`, no `Mcp-Session-Id`, no server-to-client request channel. Only `@solvapay/mcp` imports the official SDK, so the blast radius inside our packages is small, but the change is breaking for every integrator (the peer dependency is renamed). Decision — single clean cut to v2 and retire every legacy affordance we hand-maintain (the `sse-stateful` mode, the `McpHandlerMode` option, the session plumbing, and the v1 `0.2.x` line, which we deprecate rather than dual-target). Vendor the three ext-apps symbols we use rather than wait for its stalled v2 — lead PR #710 is closed and no v2 prerelease exists. Retiring our legacy code is not the same as refusing 2025-era clients — keep `createMcpHandler`'s zero-cost `legacy: 'stateless'` leg so today's hosts keep working with nothing for us to maintain, and hold `legacy: 'reject'` (modern-only) as a documented future toggle for once hosts ship 2026-07-28."
todos:
  - id: prep-audit
    content: Pre-flight audit. Bump `engines.node` to `>=20` and the `zod` peer to `^4.2.0` — dropping the `^3.25.0` zod-3 leg, since v2 needs 4.2+ — across `@solvapay/mcp`, `@solvapay/mcp-core`, `@solvapay/server`. Confirm no remaining v1 `@modelcontextprotocol/sdk` references outside `packages/mcp` (CI gates, docs, scaffolding templates, Deno import maps).
    status: completed
  - id: spike-branch
    content: Confirmation spike, not open research — the three unknowns are already answered by the published `2.0.0` types; prove them in code and move on. (1) `createMcpHandler` is fetch-native — it returns a `{ fetch, close, notify, bus }` object, the Workers/Deno/Bun shape, so the fetch-first handler maps cleanly. (2) `hideToolsByAudience` rebuilds on the factory seam — `McpRequestContext.requestInfo` is a web `Request`, so the ChatGPT UA branch runs before the server is built. (3) Vendoring is viable — server-side ext-apps usage is exactly `registerAppTool` / `registerAppResource` / `RESOURCE_MIME_TYPE` across two files.
    status: completed
  - id: extapps-decision
    content: 'Vendor — decided, not open. ext-apps still ships no v2 (`1.7.5`, peer `@modelcontextprotocol/sdk@^1.29.0`); its lead migration PR #710 is closed and #719/#720 are stale drafts. Vendor the ~40 lines of `registerAppTool` / `registerAppResource` / `RESOURCE_MIME_TYPE` into `packages/mcp/src/internal/` and drop the ext-apps server peer from `@solvapay/mcp`. The client-side ext-apps usage in `@solvapay/react`/examples runs in the iframe and is untouched. Because dropping the peer leaves merchants writing MCP Apps tools with no v2-compatible import, the three symbols are re-exported from `@solvapay/mcp` rather than kept private.'
    status: completed
  - id: codemod
    content: Run `npx @modelcontextprotocol/codemod v1-to-v2 packages/mcp` (the codemod is GA at `2.0.0`, no `@beta`) plus each example and the scaffolding template, then resolve every `@mcp-codemod-error` marker. Review the manifest rewrite by hand — this is a pnpm workspace and the codemod only rewrites the nearest manifest.
    status: completed
  - id: handler-rewrite
    content: "Rewrite `packages/mcp/src/fetch/handler.ts` onto `createMcpHandler(factory, options)`. This deletes the per-request transport construction, the `server.connect`/`transport.close` dance, the shared-server mutex, the `buildTransport` escape hatch and the `sessionIdGenerator` option. Reshape `CreateSolvaPayMcpFetchHandlerOptions` from `server: McpServer` to `factory: McpServerFactory`, and retire `McpHandlerMode` entirely — `sse-stateful` has no v2 equivalent (sessions are gone) and the rest collapses onto the SDK's `responseMode` (`json` for edge runtimes that cannot stream, `auto`/`sse` otherwise). Auth becomes `handler.fetch(request, { authInfo })`, dropping the `resolvedAuthInfo as any` cast."
    status: completed
  - id: legacy-stance
    content: "Keep `createMcpHandler`'s default `legacy: 'stateless'` so 2025-era hosts (Claude Desktop, ChatGPT, Cursor) keep working at zero maintenance cost while they ship 2026-07-28 support — retiring our legacy machinery is not the same as refusing legacy clients. Leave `legacy: 'reject'` (modern-only) documented as a deliberate future toggle; flipping it now would leave a server no currently-shipping host can reach, which is its own broken window."
    status: completed
  - id: hide-tools
    content: Rebuild `applyHideToolsByAudience` (`packages/mcp-core/src/hideToolsByAudience.ts`) without the `_requestHandlers` private-map reach-in (still private in v2). Under `createMcpHandler` the ChatGPT bypass reads the User-Agent off `McpRequestContext.requestInfo.headers.get('user-agent')` in the factory and decides what to register, so no handler wrapping is needed; `Protocol.removeRequestHandler(method)` is a public fallback. Fix the latent bug too — the `getClientVersion()` half of the detection returns `undefined` on 2026-era connections (no `initialize`), so the header path must be primary.
    status: completed
  - id: schemas
    content: Move every schema we hand to `registerTool` to an explicitly `z.object()`-wrapped zod >=4.2 schema. Affects `packages/mcp/src/registerPayableTool.ts`, `packages/mcp/src/internal/buildMcpServer.ts`, and `jsonSchemaToZodRawShape` in `packages/server/src/register-virtual-tools-mcp.ts` (raw shapes now get wrapped with the SDK's bundled zod and fail at the first `tools/list`).
    status: completed
  - id: auth-errors
    content: "Align the OAuth bridge with v2: token verifiers must throw `OAuthError(OAuthErrorCode.InvalidToken)` or invalid tokens become HTTP 500, and RFC 9207 `iss` validation is now enforced. Re-check our hand-rolled `-32001` / `-32603` codes against v2's `ProtocolErrorCode` and the new `-32020` (`HeaderMismatch`) / `-32021` / `-32022` — all confirmed present in `2.0.0`; `-32001` does not collide numerically, but confirm the semantics."
    status: completed
  - id: tests
    content: "Re-baseline the MCP test suites. `protocolVersion: '2025-06-18'` fixtures in `packages/mcp/__tests__/fetch/*` need modern-era counterparts (both eras stay in scope — `legacy: 'stateless'` remains on), capability advertisement changed (`listChanged: true` is now default), unknown-tool calls now reject instead of resolving `isError`, and there is no in-memory 2026-era transport — drive `handler.fetch` directly."
    status: completed
  - id: examples-template
    content: Migrate the five MCP examples and the `create-solvapay` MCP template. `examples/mcp-checkout-app`, `examples/mcp-oauth-bridge` and `examples/mcp-time-app` carried hand-rolled session maps and `isInitializeRequest` routing that disappear entirely — all three now mount one `app.all('/mcp', toNodeHandler(mcpHandler))` from `@modelcontextprotocol/node`, which streams SSE and forwards `req.auth` as `authInfo`. `examples/supabase-edge-mcp` needed its Deno import map re-pointed at the split packages.
    status: completed
  - id: release
    content: 'Ship it: `@solvapay/mcp` and `@solvapay/mcp-core` 0.2.x -> 0.3.0 behind a `preview` snapshot tag first, with a migration note in both CHANGELOGs and `docs/guides/mcp.mdx`. Deprecate rather than maintain the v1 line — publish 0.2.x as-is, add a deprecation notice, and do not backport. Changesets are written and `changeset status` confirms the intended plan with no majors: `mcp` and `mcp-core` 0.3.0, `server` 2.1.0, `create-solvapay` 0.6.0, `react` 1.6.1, `react-supabase` untouched. Holding `mcp` at 0.3.0 (rather than the 1.0.0 that a `workspace:^` peer cascade would force) required pinning `mcp`''s `@solvapay/mcp-core` peer to the explicit lockstep range `^0.3.0` and spanning `react`''s to `^0.2.8 || ^0.3.0`; `mcp-core` keeps the 0.3.0 boundary so zod-3 consumers on `^0.2.8` are not silently upgraded into the narrowed peer. The `preview` snapshot publish and the `npm deprecate` on 0.2.x are still outstanding.'
    status: pending
isProject: true
---

# MCP 2026-07-28 / official SDK v2 migration

## TL;DR

The 2026-07-28 protocol revision is a clean break, and the official TypeScript SDK
made it a clean break too: the single `@modelcontextprotocol/sdk` package is gone,
replaced by a scope of split packages, now GA at `2.0.0`. There is no path to
2026-07-28 on v1 — the v1 `@modelcontextprotocol/sdk` line never reaches this revision.

Our exposure is narrower than it looks. `@solvapay/mcp` is the only package that
imports the official SDK; `@solvapay/mcp-core`, `@solvapay/server` and
`@solvapay/react/mcp` all type MCP structurally and carry no `@modelcontextprotocol/*`
dependency. That boundary (an existing rule in
`.cursor/rules/mcp-apps-sdk.mdc`) is the single biggest reason this migration is
tractable.

**Engine-side follow-up:** TypeScript/Go adapters already speak 2026-07-28 via the
official SDKs. Shared-engine hosts (Ruby / Python / Rust / TypeScript engine mode)
are covered by `~/.cursor/plans/mcp_2026-07-28_engine_parity_9ea70341.plan.md`
(`server/discover`, per-request `_meta`, SEP-2549 cache fields, `-3202x` codes).

**Recommendation: cut straight to v2, do not dual-target v1.** Supporting both means
maintaining two transport implementations behind a build-time flag, because v1 and v2
objects cannot cross (`instanceof` and nominal types do not survive the boundary — the
SDK's own migration guide is explicit about this). We are pre-revenue with no paying
customers on the MCP packages, `@solvapay/mcp` is still `0.2.x`, and the integrator
cost of staying on v1 is "keep installing the old peer dependency" — nobody is
stranded. Deprecate the 0.2.x line and move on.

**Retire legacy on our side; keep serving legacy clients.** Delete every legacy affordance
we hand-maintain — the `sse-stateful` mode, the `mode` option, the session plumbing, the v1
`0.2.x` line — but keep `createMcpHandler`'s zero-cost `legacy: 'stateless'` leg so today's
hosts still connect while they upgrade. And ext-apps no longer gates us: it has no v2 (its
lead PR is closed), so we vendor the three symbols we use. See
[The ext-apps blocker](#the-ext-apps-blocker).

## What actually changed

Two things landed at once, and it is worth keeping them apart.

### 1. The protocol revision (2026-07-28)

Sources: the [release candidate
announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
and the [breaking-changes
guide](https://www.developersdigest.tech/blog/mcp-2026-07-28-breaking-changes).

The core goes stateless. `initialize`/`initialized` is removed (SEP-2575) and replaced
by a `server/discover` method plus a per-request `_meta` envelope carrying protocol
version, client info and client capabilities. `Mcp-Session-Id` is removed (SEP-2567),
so any request can land on any instance. Streamable HTTP now requires `Mcp-Method` and
`Mcp-Name` headers so gateways can route without reading the body (SEP-2243). List and
resource-read results carry `ttlMs` and `cacheScope` for caching (SEP-2549).

The server-to-client request channel is gone. Elicitation and sampling become in-band:
a handler returns an `inputRequired(...)` result carrying an opaque `requestState`, and
the client re-issues the original call with the answers. Roots, sampling and
protocol-level logging are deprecated (SEP-2577) with a twelve-month floor before
removal. Tool schemas are lifted to full JSON Schema 2020-12. Extensions (MCP Apps,
Tasks) become first-class and version independently of the spec.

**None of this directly bites us today.** We do not use sampling, roots, elicitation,
logging or tasks anywhere in the repo. What bites us is the transport rework and the
SDK repackaging that carries it.

### 2. The SDK v2 repackaging

| v1                               | v2                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk`      | `@modelcontextprotocol/server` (server implementation)                                                                                                           |
|                                  | `@modelcontextprotocol/client` (client implementation)                                                                                                           |
|                                  | `@modelcontextprotocol/core` (public Zod `*Schema` constants)                                                                                                    |
| `StreamableHTTPServerTransport`  | `NodeStreamableHTTPServerTransport` (`/node`); the web-standard `WebStandardStreamableHTTPServerTransport` we use **survives** in `@modelcontextprotocol/server` |
| built-in framework glue          | `@modelcontextprotocol/{node,express,hono,fastify}`                                                                                                              |
| `SSEServerTransport`, AS helpers | `@modelcontextprotocol/server-legacy` (frozen, deprecated)                                                                                                       |

Status as of 2026-08-05: `2.0.0` is GA. Every split package (`core`, `server`, `client`,
`node`, `express`, `hono`, `fastify`, `server-legacy`) and the codemod are on `2.0.0`, all
sharing one version number. The earlier draft's beta-churn risk is closed — pin exactly and
move. Note the fetch-first `WebStandardStreamableHTTPServerTransport` we build today still
exists in `2.0.0` (re-exported from `@modelcontextprotocol/server`), but `createMcpHandler`
owns transport construction now, so we stop instantiating it directly.

Beyond the rename, the changes that touch code we have written:

- **`ctx` replaces `extra`.** Handler second argument is restructured:
  `extra.authInfo` -> `ctx.http?.authInfo`, `extra.requestInfo` -> `ctx.http?.req`
  (a real Web `Request`, so header reads become `.get()` instead of bracket access),
  `extra.sessionId` -> `ctx.sessionId`.
- **`setRequestHandler` takes a method string**, not a Zod schema.
- **Raw Zod shapes are deprecated** on `registerTool`/`registerPrompt`. They still
  work, but they get wrapped with the SDK's _bundled_ zod — which fails at the first
  `tools/list` when the shape was authored with a different zod copy. Wrap with
  `z.object()` yourself.
- **Zod 3 is dropped**; v2 wants `zod ^4.2.0` (4.0–4.1 falls back to the bundled
  converter and silently drops `.describe()` descriptions).
- **Node 20+** required.
- **`McpError` -> `ProtocolError`**, `ErrorCode` -> `ProtocolErrorCode`,
  `StreamableHTTPError` -> `SdkHttpError`. The `MCP error <code>: ` message prefix is
  gone. Unknown/disabled tool calls now _reject_ with `-32602` instead of resolving
  `{ isError: true }`.
- **OAuth error classes consolidate** into `OAuthError` + `OAuthErrorCode`. Token
  verifiers that throw anything else produce HTTP 500 instead of a 401 challenge.
- **`createMcpHandler(factory, options)`** is the new HTTP entry point — a fresh
  server per request, serving both eras from one endpoint.

The SDK ships a codemod (`@modelcontextprotocol/codemod`) that mechanically handles
the import rewrites, symbol renames, `extra` -> `ctx` remapping and the
`registerTool` call-shape conversion.

## What this means for our SDK, file by file

Everything below is scoped to the ~15 files that actually touch the official SDK.

### `packages/mcp` — the whole migration lives here

**`src/fetch/handler.ts` is the centre of gravity.** Today it builds a
`WebStandardStreamableHTTPServerTransport` per request against one long-lived shared
`McpServer`, and serialises concurrent requests behind a mutex because
`McpServer._transport` is a single slot:

```166:192:packages/mcp/src/fetch/handler.ts
  const makeTransport = (): WebStandardStreamableHTTPServerTransport => {
    if (buildTransport) return buildTransport()
    if (mode === 'json-stateless') {
      return new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
    }
    // ...
  }

  // Serialise server connect/close cycles. `McpServer._transport` is a
  // single slot — the protocol's `connect()` throws "Already connected
  // to a transport" if it's set ...
  let serverMutex: Promise<void> = Promise.resolve()
```

`createMcpHandler` deletes this entire class of problem. It takes a factory
`(ctx: McpRequestContext) => McpServer | Server` and builds a fresh instance per
request, so the mutex, the connect/close cycle and the "fine for the low-throughput
edge-function case" caveat in that comment all go away. Concurrency stops being
serialised.

The mapping for our three modes:

| Our `McpHandlerMode` | v2 equivalent                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `'json-stateless'`   | `createMcpHandler(factory)` default (`legacy: 'stateless'`, `responseMode: 'auto'` or `'json'`) |
| `'sse-stateless'`    | `createMcpHandler(factory, { responseMode: 'sse' })`                                            |
| `'sse-stateful'`     | no direct equivalent — sessions are gone from the protocol                                      |

**Decision: retire `McpHandlerMode` outright.** `'sse-stateful'` — the current default — has
no v2 equivalent because sessions are gone from the protocol, and the other two collapse
onto the SDK's `responseMode`. `CreateSolvaPayMcpFetchHandlerOptions.server: McpServer`
becomes a `factory` in the same breaking change, so nothing is left for `mode` to select.
Edge runtimes that cannot hold a stream pass `responseMode: 'json'` (single JSON body,
mid-call notifications dropped — we emit none); everything else takes the `'auto'` default.
This retires _our_ legacy plumbing, not legacy _clients_: `createMcpHandler`'s
`legacy: 'stateless'` default (kept) still answers 2025-era hosts on the same endpoint at
zero cost to us — see "Backwards compatibility" below.

The auth plumbing gets _cleaner_. Today we cast our auth envelope through `any` to
satisfy the SDK's `AuthInfo`:

```252:262:packages/mcp/src/fetch/handler.ts
      const response = await transport.handleRequest(
        req,
        resolvedAuthInfo
          ? {
              // `AuthInfo` from the SDK is structurally identical to our
              // envelope — cast away the brand so the types line up.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              authInfo: resolvedAuthInfo as any,
            }
          : undefined,
      )
```

`handler.fetch(request, { authInfo })` takes the same strictly-pass-through `AuthInfo`,
and the SDK's migration guide explicitly calls out removing v1-era double casts. This
is also a chance to delete two of the four `no-explicit-any` suppressions in the
package, which the workspace TypeScript rule wants gone anyway.

**`src/registerPayableTool.ts` and `src/internal/buildMcpServer.ts`** need the schema
treatment: every `inputSchema` we forward must be an explicitly `z.object()`-wrapped
zod >=4.2 schema, and the `toolConfig as any` casts at lines 232 and 240 should
resolve now that `registerTool` accepts Standard Schema.

**`src/express/oauth-bridge.ts` and `src/fetch/oauth-bridge.ts`** are hand-rolled
fetch/Express handlers with no SDK imports, so they survive the rename. What they need
is a conformance pass: RFC 9207 `iss` validation, and confirming our `-32001`
unauthorized code does not now collide with v2's renumbered `-32020` (`HeaderMismatch`).

### `packages/mcp-core` — one file, one real problem

`applyHideToolsByAudience` reaches into the SDK's private handler map:

```174:191:packages/mcp-core/src/hideToolsByAudience.ts
  const inner = (server as McpServerLike).server
  if (!inner || typeof inner !== 'object' || !(inner._requestHandlers instanceof Map)) {
    return
  }
  const handlers = inner._requestHandlers
  const original = handlers.get('tools/list')
  if (!original) return
  // ...
  handlers.set('tools/list', async (req, extra) => {
```

The file's own comment calls this "the one piece of SDK-internal knowledge we live
with until the SDK ships a first-class 'replace handler' affordance." v2 ships two
things that retire it:

1. `Protocol.removeRequestHandler(method)` is now public.
2. More usefully, `createMcpHandler`'s factory receives
   `McpRequestContext { era, authInfo?, requestInfo?: Request }`. The ChatGPT
   User-Agent detection this helper exists for can read
   `ctx.requestInfo?.headers.get('user-agent')` _before_ the server is built, and the
   factory simply decides which tools to register.

That turns a handler-wrapping hack into a branch in the factory. It also fixes a
latent correctness issue: the current `defaultIsChatGptRequest` falls back to
`server.getClientVersion()`, which returns `undefined` on 2026-era connections because
`initialize` never runs. The header path keeps working; the fallback silently stops.

Also note `ApplyHideToolsByAudienceExtra` mirrors v1's `IsomorphicHeaders`
(`Record<string, string | string[] | undefined>`). v2 uses the Web Standard `Headers`
object, so `readHeader` becomes `headers.get(name)`.

### `packages/server` — no SDK dependency, one schema problem

`register-virtual-tools-mcp.ts` converts JSON Schema to a Zod raw shape and hands it
straight to `registerTool`:

```140:143:packages/server/src/register-virtual-tools-mcp.ts
        inputSchema: jsonSchemaToZodRawShape(
          mappedDefinition.inputSchema.properties as Record<string, JsonSchemaProperty>,
          mappedDefinition.inputSchema.required || [],
        ),
```

This is exactly the failure mode the migration guide warns about: a raw shape built
with _our_ zod, wrapped by the SDK's _bundled_ zod, registering fine and then failing
on the first `tools/list`. Fix is one line — wrap in `z.object()` — plus the
`zod ^4.2.0` bump. We deliberately do not reach for the SDK's `fromJsonSchema()` here,
because `@solvapay/server` must stay free of `@modelcontextprotocol/*` per the package
boundary rule.

### `packages/react/mcp` — nothing, probably

All types are structural; the only MCP SDK contact is in example `mcp-app.tsx` files
that import `@modelcontextprotocol/ext-apps` directly. Those move whenever ext-apps
moves.

### Examples and scaffolding

`examples/mcp-checkout-app` and `examples/mcp-oauth-bridge` both hand-roll the
sessionful pattern — a `Map` of transports keyed by session id, `isInitializeRequest`
routing, `onsessioninitialized`. All of that deletes down to a `createMcpHandler`
factory. `examples/supabase-edge-mcp` pins the SDK through a Deno import map
(`supabase/functions/mcp/deno.json`) that needs re-pointing at the split packages.
`packages/create-solvapay/templates/mcp/_base/package.json` pins
`@modelcontextprotocol/sdk@^1.29.0` and has a scaffold test asserting that pin.

## The ext-apps blocker

This was billed as the scheduling constraint. It no longer is — we vendor, so ext-apps
stops gating us.

`@modelcontextprotocol/ext-apps@1.7.5` still declares
`"@modelcontextprotocol/sdk": "^1.29.0"` as a peer dependency, and its v2 migration has
stalled: the lead PR [#710](https://github.com/modelcontextprotocol/ext-apps/pull/710)
(`App` subclasses the v2 `Client`) is **closed unmerged**, while
[#719](https://github.com/modelcontextprotocol/ext-apps/pull/719) (draft, core-only Apps
protocol) and [#720](https://github.com/modelcontextprotocol/ext-apps/pull/720) (draft,
official `Protocol` base with role-isolated peers) linger as stale drafts behind an
unresolved question about whether server-only consumers must bundle the client role. No v2
prerelease is published.

If we adopt SDK v2 while ext-apps is still on v1, we get two zod copies, two SDK
copies and an unsatisfiable peer graph.

**We are not actually that dependent on it.** We use exactly three symbols:
`registerAppTool`, `registerAppResource` and `RESOURCE_MIME_TYPE`. Reading the
upstream source, `registerAppTool` is a `_meta.ui.resourceUri` <-> legacy-flat-key
normaliser followed by `server.registerTool`, and `registerAppResource` is a
`mimeType` default followed by `server.registerResource`. Roughly 40 lines of real
logic.

**Decision: vendor.** With #710 closed there is no near-term v2 to wait for, and waiting
would re-couple our schedule to an upstream with an unresolved architecture debate. Vendor
the three symbols into `packages/mcp/src/internal/` behind a thin wrapper, drop the ext-apps
server peer from `@solvapay/mcp` entirely, and revisit adopting upstream only if a real
reason appears — it is ~40 lines and cheap to reverse. The client-side ext-apps usage in
`packages/react/mcp` and the example widgets is unaffected: it runs in the iframe and never
touches the server SDK, so it stays on the ext-apps client entry regardless.

## Backwards compatibility: don't

The question in the brief was whether to keep supporting the previous major. Working
through what that would actually cost:

**Dual-targeting v1 and v2 in one package is not a conditional import.** The SDK's
migration guide is explicit that v1 and v2 modules have separate classes and types,
and that objects must not flow between them — `instanceof` and nominal types do not
cross. In practice that means `@solvapay/mcp` would need two parallel implementations
of `fetch/handler.ts`, `registerPayableTool.ts` and `buildMcpServer.ts`, selected at
build time via separate entry points, with both peer dependency sets declared
optional. Every bug fix lands twice. Every test runs twice. The public types diverge,
because `createSolvaPayMcpServer` returns an `McpServer` whose identity differs between
the two.

**What we get for that: nothing anyone is asking for.** No paying customers on these
packages. `@solvapay/mcp` is at `0.2.8` — pre-1.0, where breaking changes in a minor
are the documented convention. And integrators who cannot move yet are not stranded:
the v1 package still exists under its own name, `0.2.8` stays on npm forever, and
`@modelcontextprotocol/sdk@1.29.x` keeps working against every 2025-era host. The
"stay put" story is genuinely fine.

**So: single clean cut.** Concretely —

- `@solvapay/mcp` and `@solvapay/mcp-core` go `0.2.8` -> `0.3.0`. Peer dependencies
  swap from `@modelcontextprotocol/sdk` to `@modelcontextprotocol/server`
  (+ `/core`, + `/node` where a Node transport is needed). `engines.node` -> `>=20`,
  `zod` peer -> `^4.2.0`.
- The `0.2.x` line is **deprecated, not maintained**. Publish an `npm deprecate`
  notice pointing at the migration note. No backports, no security-only branch.
  Revisit only if a real integrator with a real constraint shows up.
- Everything else in the workspace (`@solvapay/server` at `2.0.0`, `@solvapay/react`
  at `1.6.0`) takes a minor for the zod and Node bumps. Those are not MCP-breaking.

One distinction to be deliberate about, because it is easy to conflate with "retire
legacy": **we retire every legacy affordance _we_ hand-maintain, but we still _answer_
2025-era clients.** Those are different things. Retired: the `sse-stateful` mode, the
session-id plumbing, the connect/close mutex, the hand-rolled session maps in the examples,
and the v1 `0.2.x` line. Kept: `createMcpHandler`'s default `legacy: 'stateless'`, which
answers 2025-era clients on the same endpoint as 2026-era ones at **zero code and zero
maintenance** for us. Claude Desktop, ChatGPT connectors and Cursor do not speak 2026-07-28
yet (the spec finalised days ago), so keeping that default is what lets the packages talk to
any real host at all. `legacy: 'reject'` (modern-only) is a deliberate future toggle for
once hosts have shipped 2026-07-28 support — flipping it today would leave a server no
current client can reach, which is a broken window, not a clean cut. Backwards compatibility
lives in the protocol layer, at zero cost — never in our package matrix.

## Phasing

Sequenced by dependency, not by calendar.

**Phase 0 — pre-flight.** Node and zod bumps, dependency audit, confirm nothing
outside `packages/mcp` names the v1 package. Independently useful and safe to land
before anything else. Touches: every `packages/*/package.json`, the scaffold template,
the Deno import maps.

**Phase 1 — confirmation spike.** The three `spike-branch` questions are already answered by
the published `2.0.0` types; this is a short branch to prove them in code, not open
research. The one design decision it used to carry — whether to retire `sse-stateful` / the
`mode` option — is now made: retire it, and keep `legacy: 'stateless'` for 2025-era clients.
Output is a green `handler.fetch` smoke test, not a decision record.

**Phase 2 — vendor ext-apps symbols.** The decision is made (vendor; #710 is closed). This
is the ~40-line lift into `packages/mcp/src/internal/` plus dropping the server peer. Blocks
Phase 3 and nothing else.

**Phase 3 — `@solvapay/mcp` + `@solvapay/mcp-core`.** Codemod, then the manual work:
handler rewrite, `hideToolsByAudience` rebuild, schema wrapping, auth error alignment.
This is the invasive phase — `fetch/handler.ts` is effectively rewritten rather than
patched, and `CreateSolvaPayMcpFetchHandlerOptions` changes shape.

**Phase 4 — tests.** Substantial re-baselining, not a sweep. The `protocolVersion:
'2025-06-18'` fixtures across `packages/mcp/__tests__/fetch/*` need modern-era
counterparts; capability advertisement changed (a declared `tools: {}` is now
advertised with `listChanged: true`, so golden tests move); unknown-tool calls reject
instead of resolving; and there is no in-memory 2026-era transport, so era coverage
means driving `handler.fetch` through a `StreamableHTTPClientTransport` with a
`fetch` override. Follow the RED-GREEN-REFACTOR workflow in `.cursor/rules/tdd.mdc`.

**Phase 5 — examples, template, docs.** Five examples, one scaffold template,
`docs/guides/mcp.mdx` and `docs/guides/mcp-app.mdx`. The examples get materially
simpler, which makes them the best place to sanity-check the new public API before
it is frozen.

**Phase 6 — release.** Snapshot preview first (`pnpm changeset:snapshot` publishes
under the `preview` tag), validate against a real host, then `0.3.0`.

## Risks and open questions

- **~~The SDK is still `2.0.0-beta.5`.~~ Resolved:** `2.0.0` is GA across all split
  packages and the codemod. Pin exactly and move — no beta churn left to absorb.
- **~~ext-apps timing is genuinely unknown.~~ Resolved by decision:** we vendor, so upstream
  timing and the three-way PR race no longer gate us (and #710, the lead PR, is now closed).
  Residual risk is drift from whatever normalisation upstream adds later — cheap to reconcile
  against ~40 vendored lines.
- **~~`'sse-stateful'` removal needs a real answer.~~ Decided — retire it** (and the whole
  `mode` option). Pre-revenue on these packages, no integrator on session stickiness, and
  2025-era _clients_ stay served by the kept `legacy: 'stateless'` leg, so removing the mode
  is not a client-facing break. The only client-facing lever left is `legacy: 'reject'`,
  which we deliberately do **not** flip yet.
- **ChatGPT's connector gateway is the riskiest host.** The bypass in
  `hideToolsByAudience` exists because ChatGPT re-validates iframe-initiated
  `tools/call` against a cached `tools/list`. Now that the spec has real cache
  semantics (`ttlMs`, `cacheScope`), the workaround may need rethinking rather than
  porting — and the `getClientVersion()` half of the detection stops working on the
  modern era regardless.
- **The `_meta` conventions we rely on need an explicit test against 2026-07-28.** We stamp
  `_meta.ui.*`, `_meta.audience` and `_meta["openai/widgetSessionId"]`. Confirmed in the
  `2.0.0` types: the SDK lifts the reserved `io.modelcontextprotocol/*` keys out of the
  `_meta` handlers see into `ctx.mcpReq.envelope`, leaving everything else (all of ours,
  which are outside that prefix) in `ctx.mcpReq._meta`. The convention should hold — assert
  it with a test that round-trips a tool call carrying our keys rather than trusting the
  prefix rule.
