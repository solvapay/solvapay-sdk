---
name: supabase-mcp SDK package
overview: Add a new `@solvapay/supabase-mcp` package that wraps `mcp-lite` + `hono` with SolvaPay paywall, virtual tools, OAuth bearer resolution, and DCR/well-known discovery. Ships a turnkey `createSolvaPayMcp()` factory plus low-level primitives, so the Lovable MCP-server skill collapses to a short paste.
todos:
  - id: scaffold
    content: "Scaffold packages/supabase-mcp: package.json, tsconfig.json, README.md, src/{index,primitives,factory,auth-middleware,well-known,virtual-tools,types}.ts with peer deps on mcp-lite, hono, zod, @solvapay/server, @solvapay/core"
    status: pending
  - id: auth_middleware
    content: "Implement createAuthMiddleware: bearer -> userinfo -> ctx.state.customerRef, injects _auth.customer_ref on tools/call only"
    status: pending
  - id: well_known
    content: "Implement createWellKnownHandlers: self-consistent discovery per RFC 8414 §3.3 (issuer and every endpoint on publicBaseUrl, endpoints under /oauth/*), plus createUnauthenticatedResponse with WWW-Authenticate header"
    status: pending
  - id: oauth_proxy
    content: "Implement createOAuthProxyHandlers: register (inject product_ref), authorize (302 to SolvaPay preserving query), token (raw-body POST forward via `await req.text()`, authorization header passthrough, NO `URLSearchParams` re-serialization fallback), revoke (same raw-body rule as token). Returns Hono route installer `mountOAuthProxy(app, opts)` plus individual `(req: Request) => Promise<Response>` helpers for non-Hono callers. Deliberately stricter than the existing Node `oauth-bridge.ts` — see Behavioural contract"
    status: pending
  - id: cors_preflight
    content: "Implement native-scheme CORS preflight helper: matches origins against /^(cursor|vscode|vscode-webview|claude):\\/\\/.+$/, mirrors Origin back with Vary: Origin, echoes requested method/headers. Wired into mountOAuthProxy and exported standalone for reuse on /mcp 401 responses"
    status: pending
  - id: virtual_tools
    content: Implement registerVirtualToolsMcpLite + createPaywallTool helpers matching mcp-lite's server.tool signature
    status: pending
  - id: factory
    content: "Implement createSolvaPayMcp turnkey factory composing the primitives; mounts well-known + oauth proxy + CORS preflight + mcp transport; returns { handler, mcp, app, payable, solvaPay }"
    status: pending
  - id: tests
    content: "Add vitest suites: auth-middleware, virtual-tools, well-known (snapshot JSON, asserts issuer === publicBaseUrl), oauth-proxy (register injects product_ref; authorize 302 preserves qs; token forwards raw body verbatim; revoke mirrors status; preflight echoes native-scheme Origin), factory (end-to-end handler: 401 with WWW-Authenticate, DCR proxy round-trip, tools/list with mocked userinfo)"
    status: pending
  - id: release_wiring
    content: Add changeset, verify pnpm workspace pickup, confirm preview publish workflow builds the new package
    status: pending
  - id: update_skill_plan
    content: After preview publish, update .cursor/plans/lovable-mcp-server_skill_e622a6f4.plan.md so the skill uses createSolvaPayMcp as the happy path and mentions primitives only in an escape-hatch section
    status: pending
  - id: harden_node_spec
    content: "One-line hardening on the existing [`packages/server/src/mcp/oauth-bridge.spec.ts`](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.spec.ts): add `expect(JSON.stringify(doc)).not.toContain('product_ref')` to the discovery test so the Node middleware is guarded by the same negative assertion this package's `well-known.unit.test.ts` adds. Out of scope for the package work itself but should land in the same PR sequence so both surfaces are protected."
    status: pending
isProject: false
---


## Why a separate package

`@solvapay/supabase` today is a thin CORS+Request/Response wrapper around `@solvapay/server` cores (see [packages/supabase/src/handlers.ts](../../solvapay-sdk/packages/supabase/src/handlers.ts) and [packages/supabase/src/index.ts](../../solvapay-sdk/packages/supabase/src/index.ts)). Pulling `mcp-lite`, `hono`, and `zod` into it would bloat every hosted-checkout Deno function. A sibling `@solvapay/supabase-mcp` keeps the checkout wrapper lean and gives the MCP story its own versioning cadence, while still matching the "one-liner Deno handler" vibe.

It is Fetch-first, so the same `handler: (req: Request) => Promise<Response>` works on Supabase Edge, Cloudflare Workers, Bun, and Node — the name reflects its primary target without locking it there.

## Package layout

```
packages/supabase-mcp/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts            # turnkey export: createSolvaPayMcp, types
    primitives.ts       # low-level exports re-exported at ./primitives
    factory.ts          # createSolvaPayMcp implementation
    auth-middleware.ts  # createAuthMiddleware for mcp-lite
    well-known.ts       # createWellKnownHandlers (self-consistent discovery)
    oauth-proxy.ts      # createOAuthProxyHandlers + mountOAuthProxy
    cors.ts             # native-scheme preflight + corsHeaders helper
    virtual-tools.ts    # registerVirtualToolsMcpLite
    types.ts
  __tests__/
    factory.unit.test.ts
    auth-middleware.unit.test.ts
    virtual-tools.unit.test.ts
    well-known.unit.test.ts
    oauth-proxy.unit.test.ts
    cors.unit.test.ts
```

Follows the existing packages' shape — see [packages/supabase/](../../solvapay-sdk/packages/supabase/) for reference.

## Public API

### Turnkey (`@solvapay/supabase-mcp`)

```ts
import { createSolvaPayMcp } from '@solvapay/supabase-mcp'
import { z } from 'zod'

const { handler } = createSolvaPayMcp({
  name: 'my-mcp',
  version: '0.1.0',
  apiKey: Deno.env.get('SOLVAPAY_SECRET_KEY')!,
  apiBaseUrl: Deno.env.get('SOLVAPAY_API_BASE_URL'),
  productRef: Deno.env.get('SOLVAPAY_PRODUCT_REF')!,
  publicBaseUrl: Deno.env.get('MCP_PUBLIC_BASE_URL')!,
  tools: [
    {
      name: 'create_task',
      description: 'Create a task',
      inputSchema: z.object({ title: z.string() }),
      handler: async ({ title }) => ({ id: crypto.randomUUID(), title }),
    },
  ],
})

Deno.serve(handler)
```

Returned shape: `{ handler, mcp, app, payable, solvaPay }` — `mcp` and `app` are exposed so users can add custom tools, middleware, or routes before serving.

### Primitives (`@solvapay/supabase-mcp/primitives`)

For users who want full control over `McpServer` setup or Hono composition:

- `createAuthMiddleware({ apiBaseUrl })` → returns an `mcp-lite` middleware (`(ctx, next) => ...`) that:
  - Reads `Authorization` from `ctx.request.headers`.
  - Calls `<apiBaseUrl>/v1/customer/auth/userinfo` (matches the helper in [skills/solvapay/sdk-integration/mcp-server/guide.md](skills/solvapay/sdk-integration/mcp-server/guide.md)).
  - Writes `ctx.state.customerRef` and, for `tools/call`, mutates `ctx.request.params.arguments._auth = { customer_ref }` so `payable.mcp`'s `getCustomerRef` keeps working unchanged.
- `createWellKnownHandlers({ mcpPublicBaseUrl })` → returns `{ protectedResource, authorizationServer }`, each a `(req: Request) => Response`. Discovery is **self-consistent** per RFC 8414 §3.3: `issuer === mcpPublicBaseUrl` and every endpoint URL starts with `mcpPublicBaseUrl` (`/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`). Strict MCP clients (current Cursor) reject any mismatch silently with "Transient error", so the doc deliberately does **not** reference `apiBaseUrl` or inject `product_ref` into the registration URL — that lives inside the proxy. Mounts cleanly on any Hono/`fetch` router.
- `createUnauthenticatedResponse({ mcpPublicBaseUrl })` → 401 with correct `WWW-Authenticate: Bearer resource_metadata=...` header for reuse.
- `createOAuthProxyHandlers({ apiBaseUrl, productRef })` → returns `{ register, authorize, token, revoke }`, each `(req: Request) => Promise<Response>`, matching the behaviour the SDK's Node middleware [oauth-bridge](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts) already ships in `createOAuthRegisterHandler` / `createOAuthAuthorizeHandler` / `createOAuthTokenHandler` / `createOAuthRevokeHandler`, just Fetch-first:
  - `register` — POST body JSON forwarded to `<apiBaseUrl>/v1/customer/auth/register?product_ref=<productRef>`. `product_ref` is injected here, **never** in the discovery doc.
  - `authorize` — 302 to `<apiBaseUrl>/v1/customer/auth/authorize<query>`, preserving the original query string verbatim.
  - `token` — POST. Forward `await req.text()` raw (no `parseBody()`), pass `content-type` and `authorization` headers through. Re-serializing form bodies risks `+` vs `%20` and param-ordering drift that breaks PKCE verification and Basic-auth signatures.
  - `revoke` — POST, same body/header passthrough as `token`, but the response is empty with mirrored status.
- `mountOAuthProxy(app, { apiBaseUrl, productRef })` → Hono helper that wires the four handlers plus `OPTIONS /oauth/*` preflight under one call. Returns `app` for chaining.
- `createNativeSchemeCorsHeaders(req)` (in `cors.ts`) → returns `Record<string, string>` that mirrors the requesting `Origin` back only if it matches `/^(cursor|vscode|vscode-webview|claude):\/\/.+$/`. Emits `Vary: Origin`. Exported so callers can apply it to their own `/mcp` 401 response too.
- `registerVirtualToolsMcpLite(mcp, definitions, opts?)` → iterates `VirtualToolDefinition[]` from `solvaPay.getVirtualTools()` and calls `mcp.tool(name, { description, inputSchema, handler })` using mcp-lite's signature. This is the mcp-lite analogue of the existing [`registerVirtualToolsMcp`](../../solvapay-sdk/packages/server/src/register-virtual-tools-mcp.ts) which targets the official SDK's `registerTool` shape; neither duplicates the other's behaviour because mcp-lite and the official SDK have different `tool`/`registerTool` signatures.
- `createPaywallTool(payable, def, opts?)` → small helper that wraps a user tool definition with `payable.mcp(def.handler, { getCustomerRef })` and returns the mcp-lite-shaped object, so `mcp.tool(...createPaywallTool(payable, def))` stays one line.

The turnkey `createSolvaPayMcp` is composed entirely from these primitives — zero duplication.

## Dependencies

- **Peer deps**: `mcp-lite ^0.10`, `hono ^4`, `zod ^3`, `@solvapay/server` (workspace), `@solvapay/core` (workspace).
- **Dev deps**: same TypeScript / vitest / biome setup used by `@solvapay/supabase`.
- No direct `@solvapay/auth` dep — OAuth well-known JSON is pure strings, and userinfo is a raw fetch.

## Runtime constraints

- No Node built-ins (`fs`, `path`, etc.) in `src/` so the bundle runs untouched under `npm:@solvapay/supabase-mcp@preview` in Supabase Edge (Deno).
- Use `globalThis.fetch`; never `import 'node:...'`.
- `zod` is a peer dep; `schemaAdapter` is caller-provided when using primitives, defaulted to `(s) => z.toJSONSchema(s as z.ZodType)` in the turnkey factory (dynamic `import('zod')` guarded, mirroring the pattern in [register-virtual-tools-mcp.ts](../../solvapay-sdk/packages/server/src/register-virtual-tools-mcp.ts)).

## Wiring

- Add the package under the existing `pnpm-workspace.yaml` glob (already `packages/*` — confirm in [pnpm-workspace.yaml](../../solvapay-sdk/pnpm-workspace.yaml)).
- Add a changeset so the preview workflow [.github/workflows/publish-preview.yml](../../solvapay-sdk/.github/workflows/publish-preview.yml) picks it up and publishes `@preview`.
- Root `package.json` scripts already glob-build all packages; confirm `typecheck` and `test` pass for the new package.
- `tsconfig.json` extends the shared base used by `packages/supabase/tsconfig.json`.

## Behavioural contract

The package's OAuth surface exists to pass RFC 8414 §3.3 self-consistency while still routing real auth work to SolvaPay. Invariants any future refactor must preserve:

- `issuer` in `/.well-known/oauth-authorization-server` is exactly `mcpPublicBaseUrl` — no trailing slash drift, no scheme swap.
- Every endpoint URL in the discovery doc is a prefix match of `mcpPublicBaseUrl` + `/oauth/*` or `/.well-known/*`.
- `product_ref` is injected **only** in the `/oauth/register` proxy as a query parameter — it never leaks into discovery JSON or downstream authorize/token/revoke requests. Enforced by a negative assertion in `well-known.unit.test.ts` (`expect(JSON.stringify(doc)).not.toContain('product_ref')`), not just positive endpoint checks.
- `/oauth/token` forwards `await req.text()` verbatim. **No `parseBody()`, no header case normalization beyond what `fetch` already does, no re-serialization** — not even the `URLSearchParams.toString()` fallback. This is stricter than the existing Node middleware (see "Relationship to existing Node middleware" below).
- `/oauth/revoke` follows the same byte-for-byte rule as `/oauth/token`.
- CORS preflight mirrors the requesting `Origin` only when it matches the native-scheme regex; any other origin gets zero CORS headers (effectively same-origin only).
- The turnkey factory and the primitives produce **byte-identical** discovery JSON for the same inputs — the factory is a literal composition.

### Relationship to existing Node middleware

[`packages/server/src/mcp/oauth-bridge.ts`](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts) already enforces invariants 1, 2, and the CORS/composition rules (verified in [`oauth-bridge.spec.ts`](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.spec.ts)). This package mirrors those into Fetch-first primitives.

It diverges deliberately on the body-forwarding rule: the Node middleware has a `serializeFormBody()` fallback that re-serializes parsed-object bodies via `URLSearchParams.toString()` when `body-parser` style middleware has already consumed the stream. That fallback happens to work for SolvaPay's current upstream (PKCE verifier characters and Basic-auth-in-header are unaffected) but is a latent compatibility hazard — `+` vs `%20` drift and iteration-order dependence on the parser's output. `@solvapay/supabase-mcp` drops the fallback entirely: the token/revoke handlers require the raw request and will surface a clear error if a consumer has stacked a body parser ahead of them.

Additionally, the Node spec today asserts the discovery document *positively* (every endpoint is on `publicBaseUrl`) but has no *negative* assertion that the string `product_ref` is absent. Adding that assertion to the Node spec as a one-line hardening is tracked separately — out of scope for this plan, but worth doing before this package publishes so both surfaces are protected by the same guard.

## Tests (vitest)

- `auth-middleware.unit.test.ts` — mocks `fetch` to userinfo, asserts `ctx.state.customerRef` set and `_auth` injected for `tools/call` only (not other methods).
- `virtual-tools.unit.test.ts` — feeds three synthetic `VirtualToolDefinition`s, asserts `mcp.tool` called with correct args and handlers unwrapped (no `payable.mcp` wrapping).
- `well-known.unit.test.ts` — snapshots the JSON documents and asserts: `issuer === mcpPublicBaseUrl`; every endpoint starts with `mcpPublicBaseUrl`; no `product_ref` string appears anywhere in either document (negative assertion: `expect(JSON.stringify(doc)).not.toContain('product_ref')`); trailing-slash on input `mcpPublicBaseUrl` is normalized (mirrors the existing Node spec's `'strips trailing slashes'` case).
- `oauth-proxy.unit.test.ts` — mocks upstream `fetch` and asserts:
  - `register` POSTs to `<apiBaseUrl>/v1/customer/auth/register?product_ref=<productRef>` with the exact JSON body forwarded; error responses from upstream are relayed with the same status and body.
  - `authorize` returns a 302 whose `Location` is `<apiBaseUrl>/v1/customer/auth/authorize<qs>` with the original search string including `?` intact.
  - `token` forwards the request body **byte-for-byte**: the test constructs a `new Request(url, { body: 'grant_type=authorization_code&code=a+b&redirect_uri=cursor%3A%2F%2Fcb&code_verifier=... '})` where the body contains both `+` and `%20` and asserts the upstream `fetch` mock receives the **exact same string** (no round-trip through `URLSearchParams`). `authorization` and `content-type` headers pass through.
  - `token` with no body at all still produces a valid upstream `POST` — confirms the handler doesn't synthesize `{}`.
  - `revoke` applies the same byte-for-byte rule and mirrors upstream status (including 204 with empty body).
  - `OPTIONS /oauth/register` with `Origin: cursor://x` returns 204 + `Access-Control-Allow-Origin: cursor://x` + `Vary: Origin`; `Origin: https://evil.com` returns 204 with no CORS headers.
- `cors.unit.test.ts` — unit-tests the origin regex for true/false cases across `cursor://`, `vscode://`, `vscode-webview://`, `claude://`, empty string, `null`, and arbitrary HTTPS origins.
- `factory.unit.test.ts` — end-to-end via the returned `handler(req)`:
  - `GET /.well-known/oauth-authorization-server` → JSON with self-consistent issuer.
  - `POST /oauth/register` → routes through the mocked upstream DCR endpoint (verify `product_ref` query).
  - `GET /oauth/authorize?...` → 302 with preserved query.
  - `POST /mcp` with no auth → 401 with `WWW-Authenticate: Bearer resource_metadata=...`.
  - `POST /mcp` with `tools/list` and mocked userinfo → response includes the user's paid tool plus all virtual tool names.

## Interaction with the existing skill

`skills/lovable-mcp-server/SKILL.md` on the `feature/lovable-mcp-server-skill` branch of `solvapay/skills` already ships a working hand-wired flavour that is RFC 8414 §3.3-compliant and has the four OAuth proxy routes + native-scheme CORS preflight inline. Steps 3 and 7–9 of that skill map directly onto this package's primitives:

| Skill block | Package primitive |
| --- | --- |
| Step 4 middleware | `createAuthMiddleware` |
| Step 7 discovery handlers | `createWellKnownHandlers` |
| Step 8 `/oauth/*` routes | `mountOAuthProxy` |
| Step 8 `NATIVE_CLIENT_ORIGIN` regex + helper | `createNativeSchemeCorsHeaders` |
| Step 9 401 + `WWW-Authenticate` | `createUnauthenticatedResponse` |

Once this package ships to `@preview`, collapse Steps 3–9 of the skill into a single `createSolvaPayMcp(...)` call and keep the hand-wired version in an "Escape hatch" appendix. Net effect: the skill drops from ~470 lines to ~160 and the Lovable agent gets a single obvious API to generate against.

Do not execute the skill-update plan until this package is published to `@preview` — otherwise the skill code would reference imports that don't yet resolve.

## Sequencing

1. Land `@solvapay/supabase-mcp` (this plan) → publish `@preview`.
2. Update `skills/lovable-mcp-server/SKILL.md` to prefer `createSolvaPayMcp` with the current hand-wired flow preserved as the escape hatch.

## Related work

- [`react-mcp-app-adapter_e5a04f19.plan.md`](solvapay-sdk/.cursor/plans/react-mcp-app-adapter_e5a04f19.plan.md) — the **client-side** companion. Ships `createMcpAppAdapter(app)` from `@solvapay/react/mcp` so an MCP App's React UI routes through `app.callServerTool` instead of HTTP, reusing every existing `@solvapay/react` hook and component. No blocking relationship in either direction: the adapter talks to the server via tool names (`check_purchase`, `create_checkout_session`, `create_customer_session`, ...), so any server that exposes those tools — `@solvapay/supabase-mcp`, the Node `registerVirtualToolsMcp` flow, or a hand-wired `@modelcontextprotocol/sdk` server — satisfies the contract. Together the two plans complete the "MCP App with paywalled server" story: `createSolvaPayMcp({...})` on the server + `<SolvaPayProvider {...createMcpAppAdapter(app)}>` in the UI resource.

## Out of scope

- Cloudflare Workers / Node-specific adapters — the package already runs on both because it's Fetch-first; packaging names can come later if we want per-runtime docs.
- Extending `@solvapay/supabase` — stays focused on hosted-checkout Deno handlers.
- Touching `@solvapay/server`'s existing `registerVirtualToolsMcp` — that helper targets the official MCP SDK and continues to work for Node MCP server users.
- MCP Pay hosted monetization — unrelated; that path bypasses user code entirely.
