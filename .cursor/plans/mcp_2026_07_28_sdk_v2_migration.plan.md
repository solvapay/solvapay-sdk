---
name: MCP 2026-07-28 / official SDK v2 migration
overview: The MCP specification revision 2026-07-28 finalises on 2026-07-28 and is only reachable through the official TypeScript SDK v2, which replaces the single `@modelcontextprotocol/sdk` package with a scope of split packages (`@modelcontextprotocol/core`, `/server`, `/client`, `/node`, `/express`, `/hono`, `/fastify`). The wire protocol goes stateless — no `initialize`, no `Mcp-Session-Id`, no server-to-client request channel. Only `@solvapay/mcp` imports the official SDK, so the blast radius inside our packages is small, but the change is breaking for every integrator (the peer dependency is renamed) and it lands on top of an unreleased `@modelcontextprotocol/ext-apps` v2. Recommendation - do a single clean cut to v2, deprecate v1 support rather than dual-targeting, and gate the stable release on ext-apps shipping v2.
todos:
  - id: prep-audit
    content: "Pre-flight audit. Bump `engines.node` to `>=20` and the `zod` peer to `^4.2.0` across `@solvapay/mcp`, `@solvapay/mcp-core`, `@solvapay/server`. Confirm no remaining `@modelcontextprotocol/sdk` references outside `packages/mcp` (CI gates, docs, scaffolding templates, Deno import maps)."
    status: pending
  - id: spike-branch
    content: "Throwaway spike on `2.0.0-beta.x` to validate the three unknowns before committing: (1) does `createMcpHandler` cover all three of our `McpHandlerMode` presets, (2) can `hideToolsByAudience` be rebuilt on the public factory seam, (3) can we run without ext-apps by vendoring `registerAppTool`/`registerAppResource`."
    status: pending
  - id: extapps-decision
    content: "Decide the `@modelcontextprotocol/ext-apps` strategy. Its v2 migration is three competing unmerged PRs (#710, #719, #720) and 1.7.5 still peer-depends on `@modelcontextprotocol/sdk@^1.29.0`. Either wait, or vendor the ~40 lines of `registerAppTool` / `registerAppResource` / `RESOURCE_MIME_TYPE` we actually use into `@solvapay/mcp`."
    status: pending
  - id: codemod
    content: "Run `npx @modelcontextprotocol/codemod@beta v1-to-v2 packages/mcp` plus each example and the scaffolding template, then resolve every `@mcp-codemod-error` marker. Review the manifest rewrite by hand — this is a pnpm workspace and the codemod only rewrites the nearest manifest."
    status: pending
  - id: handler-rewrite
    content: "Rewrite `packages/mcp/src/fetch/handler.ts` onto `createMcpHandler(factory)`. This replaces the per-request transport, the `server.connect`/`transport.close` dance and the shared-server mutex with a per-request server factory. Reshape `CreateSolvaPayMcpFetchHandlerOptions` from `server: McpServer` to a factory, and collapse `McpHandlerMode` onto `legacy` + `responseMode`."
    status: pending
  - id: hide-tools
    content: "Rebuild `applyHideToolsByAudience` (`packages/mcp-core/src/hideToolsByAudience.ts`) without the `_requestHandlers` private-map reach-in. Under `createMcpHandler` the ChatGPT bypass reads the User-Agent off `McpRequestContext.requestInfo` in the factory and decides what to register, so no handler wrapping is needed at all."
    status: pending
  - id: schemas
    content: "Move every schema we hand to `registerTool` to an explicitly `z.object()`-wrapped zod >=4.2 schema. Affects `packages/mcp/src/registerPayableTool.ts`, `packages/mcp/src/internal/buildMcpServer.ts`, and `jsonSchemaToZodRawShape` in `packages/server/src/register-virtual-tools-mcp.ts` (raw shapes now get wrapped with the SDK's bundled zod and fail at the first `tools/list`)."
    status: pending
  - id: auth-errors
    content: "Align the OAuth bridge with v2: token verifiers must throw `OAuthError(OAuthErrorCode.InvalidToken)` or invalid tokens become HTTP 500, and RFC 9207 `iss` validation is now enforced. Re-check our hand-rolled `-32001` / `-32603` JSON-RPC error codes against v2's `ProtocolErrorCode` and the new `-32020` / `-32021` / `-32022`."
    status: pending
  - id: tests
    content: "Re-baseline the MCP test suites. `protocolVersion: '2025-06-18'` fixtures in `packages/mcp/__tests__/fetch/*` need modern-era equivalents, capability advertisement changed (`listChanged: true` is now default), unknown-tool calls now reject instead of resolving `isError`, and there is no in-memory 2026-era transport — drive `handler.fetch` directly."
    status: pending
  - id: examples-template
    content: "Migrate the five MCP examples and the `create-solvapay` MCP template. `examples/mcp-checkout-app` and `examples/mcp-oauth-bridge` carry hand-rolled session maps and `isInitializeRequest` routing that disappear entirely; `examples/supabase-edge-mcp` needs its Deno import map re-pointed at the split packages."
    status: pending
  - id: release
    content: "Ship it: `@solvapay/mcp` and `@solvapay/mcp-core` 0.2.x -> 0.3.0 behind a `preview` snapshot tag first, with a migration note in both CHANGELOGs and `docs/guides/mcp.mdx`. Deprecate rather than maintain the v1 line — publish 0.2.x as-is, add a deprecation notice, and do not backport."
    status: pending
isProject: true
---

# MCP 2026-07-28 / official SDK v2 migration

## TL;DR

The 2026-07-28 protocol revision is a clean break, and the official TypeScript SDK
made it a clean break too: the single `@modelcontextprotocol/sdk` package is gone,
replaced by a scope of split packages. There is no path to 2026-07-28 on v1 —
published v1 `1.29.x` tops out at `2025-11-25`.

Our exposure is narrower than it looks. `@solvapay/mcp` is the only package that
imports the official SDK; `@solvapay/mcp-core`, `@solvapay/server` and
`@solvapay/react/mcp` all type MCP structurally and carry no `@modelcontextprotocol/*`
dependency. That boundary (an existing rule in
`.cursor/rules/mcp-apps-sdk.mdc`) is the single biggest reason this migration is
tractable.

**Recommendation: cut straight to v2, do not dual-target v1.** Supporting both means
maintaining two transport implementations behind a build-time flag, because v1 and v2
objects cannot cross (`instanceof` and nominal types do not survive the boundary — the
SDK's own migration guide is explicit about this). We are pre-revenue with no paying
customers on the MCP packages, `@solvapay/mcp` is still `0.2.x`, and the integrator
cost of staying on v1 is "keep installing the old peer dependency" — nobody is
stranded. Deprecate the 0.2.x line and move on.

**The real scheduling constraint is not us, it is `@modelcontextprotocol/ext-apps`.**
See [The ext-apps blocker](#the-ext-apps-blocker).

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

| v1 | v2 |
| --- | --- |
| `@modelcontextprotocol/sdk` | `@modelcontextprotocol/server` (server implementation) |
| | `@modelcontextprotocol/client` (client implementation) |
| | `@modelcontextprotocol/core` (public Zod `*Schema` constants) |
| `StreamableHTTPServerTransport` | `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node` |
| built-in framework glue | `@modelcontextprotocol/{node,express,hono,fastify}` |
| `SSEServerTransport`, AS helpers | `@modelcontextprotocol/server-legacy` (frozen, deprecated) |

Status as of 2026-07-27: `2.0.0-beta.5`, published 2026-07-21, all packages on one
version number. The spec finalises tomorrow; Tier 1 SDKs were expected to ship support
inside the ten-week RC window, so a stable `2.0.0` is imminent but not out yet.

Beyond the rename, the changes that touch code we have written:

- **`ctx` replaces `extra`.** Handler second argument is restructured:
  `extra.authInfo` -> `ctx.http?.authInfo`, `extra.requestInfo` -> `ctx.http?.req`
  (a real Web `Request`, so header reads become `.get()` instead of bracket access),
  `extra.sessionId` -> `ctx.sessionId`.
- **`setRequestHandler` takes a method string**, not a Zod schema.
- **Raw Zod shapes are deprecated** on `registerTool`/`registerPrompt`. They still
  work, but they get wrapped with the SDK's *bundled* zod — which fails at the first
  `tools/list` when the shape was authored with a different zod copy. Wrap with
  `z.object()` yourself.
- **Zod 3 is dropped**; v2 wants `zod ^4.2.0` (4.0–4.1 falls back to the bundled
  converter and silently drops `.describe()` descriptions).
- **Node 20+** required.
- **`McpError` -> `ProtocolError`**, `ErrorCode` -> `ProtocolErrorCode`,
  `StreamableHTTPError` -> `SdkHttpError`. The `MCP error <code>: ` message prefix is
  gone. Unknown/disabled tool calls now *reject* with `-32602` instead of resolving
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

| Our `McpHandlerMode` | v2 equivalent |
| --- | --- |
| `'json-stateless'` | `createMcpHandler(factory)` default (`legacy: 'stateless'`, `responseMode: 'auto'` or `'json'`) |
| `'sse-stateless'` | `createMcpHandler(factory, { responseMode: 'sse' })` |
| `'sse-stateful'` | no direct equivalent — sessions are gone from the protocol |

`'sse-stateful'` is the current default, which makes this an API-shape decision, not a
mechanical port. The honest answer is that the mode option should collapse: the 2026
era has no sessions, and `createMcpHandler`'s legacy leg is stateless by construction.
`CreateSolvaPayMcpFetchHandlerOptions.server: McpServer` has to become a factory
either way, so `mode` can be retired in the same breaking change.

The auth plumbing gets *cleaner*. Today we cast our auth envelope through `any` to
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
   `ctx.requestInfo?.headers.get('user-agent')` *before* the server is built, and the
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
with *our* zod, wrapped by the SDK's *bundled* zod, registering fine and then failing
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

This is the thing that decides the schedule, and it is not under our control.

`@modelcontextprotocol/ext-apps@1.7.5` (released 2026-07-23, four days ago) still
declares `"@modelcontextprotocol/sdk": "^1.29.0"` as a peer dependency. Its v2
migration is **three competing open PRs** — [#710](https://github.com/modelcontextprotocol/ext-apps/pull/710)
(ready, `App` subclasses the v2 `Client`), [#719](https://github.com/modelcontextprotocol/ext-apps/pull/719)
(draft, core-only Apps protocol) and [#720](https://github.com/modelcontextprotocol/ext-apps/pull/720)
(draft, official `Protocol` base with role-isolated peers) — with an unresolved
architectural question about whether server-only consumers should be forced to bundle
the client role. No v2 prerelease is published.

If we adopt SDK v2 while ext-apps is still on v1, we get two zod copies, two SDK
copies and an unsatisfiable peer graph.

**We are not actually that dependent on it.** We use exactly three symbols:
`registerAppTool`, `registerAppResource` and `RESOURCE_MIME_TYPE`. Reading the
upstream source, `registerAppTool` is a `_meta.ui.resourceUri` <-> legacy-flat-key
normaliser followed by `server.registerTool`, and `registerAppResource` is a
`mimeType` default followed by `server.registerResource`. Roughly 40 lines of real
logic.

So there are two viable paths:

- **Wait** for ext-apps v2 and take the dependency. Lowest maintenance, unknown
  timing, and we inherit whichever architecture wins the three-way PR race.
- **Vendor** the three symbols into `packages/mcp/src/internal/` behind our own thin
  wrapper, drop the ext-apps peer dependency from `@solvapay/mcp` entirely, and adopt
  upstream later if it is worth it. Unblocks us immediately; costs us ~40 lines and
  the risk of drifting from whatever normalisation upstream adds next.

Vendoring is the better default given the timing, and it is cheap to reverse. The
client-side ext-apps usage in `packages/react/mcp` and the example widgets is
unaffected either way — that runs in the iframe and does not touch the server SDK.

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

One thing worth being deliberate about: **serve both protocol eras, even though we
only ship one SDK major.** `createMcpHandler`'s default `legacy: 'stateless'` answers
2025-era clients on the same endpoint as 2026-era ones. Keeping that default means
Claude Desktop, ChatGPT connectors and Cursor keep working through their own upgrade
cycles while we sit on v2. That is where the backwards compatibility should live — in
the protocol layer, at zero cost to us — not in our package matrix.

## Phasing

Sequenced by dependency, not by calendar.

**Phase 0 — pre-flight.** Node and zod bumps, dependency audit, confirm nothing
outside `packages/mcp` names the v1 package. Independently useful and safe to land
before anything else. Touches: every `packages/*/package.json`, the scaffold template,
the Deno import maps.

**Phase 1 — spike.** Throwaway branch on `2.0.0-beta.5` answering the three questions
in the `spike-branch` todo. The `createMcpHandler` mode mapping is the one with real
design content: our `'sse-stateful'` default has no v2 equivalent, and we need to know
whether any deployed integrator actually depends on session stickiness before we
retire the option. Output is a decision record, not shippable code.

**Phase 2 — ext-apps decision.** Gated on Phase 1's answer to whether vendoring works.
Blocks Phase 3 and nothing else.

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

- **The SDK is still `2.0.0-beta.5`.** Migrating against a beta means absorbing any
  further churn before `2.0.0`. Mitigated by pinning exactly during the spike and by
  the fact that all v2 packages share one version number.
- **ext-apps timing is genuinely unknown** and has an unresolved architectural
  disagreement behind it. The vendoring path is the hedge; take it unless the spike
  shows the three symbols are doing more than they appear to.
- **`'sse-stateful'` removal needs a real answer.** It is the current default. If
  someone is deployed against it with session stickiness, retiring the mode is a
  behavioural break beyond the peer-dependency rename. Worth checking before Phase 3
  rather than after.
- **ChatGPT's connector gateway is the riskiest host.** The bypass in
  `hideToolsByAudience` exists because ChatGPT re-validates iframe-initiated
  `tools/call` against a cached `tools/list`. Now that the spec has real cache
  semantics (`ttlMs`, `cacheScope`), the workaround may need rethinking rather than
  porting — and the `getClientVersion()` half of the detection stops working on the
  modern era regardless.
- **The `_meta` conventions we rely on are unaudited against 2026-07-28.** We stamp
  `_meta.ui.*`, `_meta.audience` and `_meta["openai/widgetSessionId"]`. The revision
  reserves the `io.modelcontextprotocol/` prefix and lifts those keys out of `params._meta`
  before handlers run; ours are outside that prefix, but the interaction with the
  envelope lift deserves an explicit test rather than an assumption.
