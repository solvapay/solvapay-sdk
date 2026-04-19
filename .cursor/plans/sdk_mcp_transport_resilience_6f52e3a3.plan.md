---
name: sdk mcp transport resilience
overview: "Close the two residual Cursor-side failures seen after the OAuth bridge authenticates successfully: (1) the Streamable HTTP SSE back-channel `GET /mcp` returning 400 lands the client FSM in `failed`, and (2) a catch-all `/.well-known/openid-configuration` returning a non-OIDC JSON doc trips Cursor's OIDC validator. Fix (1) in the SDK bridge so every integrator is protected, and document (2) as a router guideline in the SDK guide and the Lovable skill."
todos:
  - id: sdk_get_405
    content: 'In oauth-bridge.ts mcpAuthMiddleware, add a method guard that returns 405 + Allow: POST, OPTIONS (with CORS headers mirrored) for any request on mcpPath that is not POST or OPTIONS'
    status: completed
  - id: sdk_401_cors
    content: 'In oauth-bridge.ts mcpAuthMiddleware, apply applyCorsHeaders + Access-Control-Expose-Headers: WWW-Authenticate, Mcp-Session-Id before setMcpChallengeHeader on the 401 branch'
    status: completed
  - id: sdk_tests
    content: 'Add oauth-bridge.spec.ts cases: GET /mcp → 405 with Allow header; native-scheme Origin echoed on the 405; WWW-Authenticate exposed via CORS on 401 POST with native origin'
    status: completed
  - id: sdk_docs
    content: In docs/guides/mcp.mdx, add a 'Streamable HTTP transport tips' subsection covering GET /mcp → 405 and /.well-known/openid-configuration → 404 guidance for integrators
    status: completed
  - id: skill_step9
    content: In lovable-mcp-server/SKILL.md Step 9, replace app.all('/mcp') with explicit app.get('/mcp') returning 405 + Allow header, and keep app.post for the bearer-gated transport delegation
    status: completed
  - id: skill_openid_404
    content: In lovable-mcp-server/SKILL.md, add an explicit app.get('/.well-known/openid-configuration', → 404) route before the /mcp routes with a one-line explanation of why
    status: completed
  - id: skill_troubleshoot_verify
    content: In lovable-mcp-server/SKILL.md, add two troubleshooting rows (SSE 400 and OIDC Zod validation error) and two sandbox verification steps (curl GET /mcp expecting 405, curl openid-configuration expecting 404)
    status: completed
  - id: release
    content: Release a new @solvapay/server preview tag containing the SDK changes so the Lovable skill's @preview-pinned integrators pick it up (published as 1.0.8-preview.7)
    status: completed
isProject: false
---

## Scope

- SDK: [packages/server/src/mcp/oauth-bridge.ts](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts) + [packages/server/src/mcp/oauth-bridge.spec.ts](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.spec.ts).
- SDK docs: [docs/guides/mcp.mdx](../../solvapay-sdk/docs/guides/mcp.mdx).
- Integrator skill: [skills/skills/lovable-mcp-server/SKILL.md](../../skills/skills/lovable-mcp-server/SKILL.md).

No backend, no nginx, no `solvapay-mcp` changes — those are covered by separate plans.

## Root cause (from the Cursor log)

After OAuth completes, Cursor opens a second request:

```
GET <mcp-url>
Accept: text/event-stream
```

This is the Streamable HTTP back-channel for server-initiated messages. Stateless MCP servers (which is what every integrator using `@solvapay/server` + `mcp-lite` / FastMCP-in-stateless / most Supabase Edge setups runs) don't accept it. The correct response is **405 Method Not Allowed**; Cursor treats 405 as "no SSE, POST-only" and stays connected. Lovable's Supabase function currently returns 400, which trips `Client error: ... Failed to open SSE stream: Bad Request` and transitions `conn=connected → conn=failed` (see log lines 279-281).

Separately, Cursor's first discovery attempt is OIDC at `/.well-known/openid-configuration`. Lovable's Supabase router appears to return the OAuth AS doc as a catch-all for any `/.well-known/*` path — that JSON passes "is JSON" but fails Cursor's strict OIDC schema (missing `jwks_uri`, `subject_types_supported`, `id_token_signing_alg_values_supported`). Cursor retries with RFC 8414 and succeeds, but logs a noisy validation error on cold start.

## Changes

### 1. SDK — `mcpAuthMiddleware` returns 405 on non-POST `/mcp`

In [oauth-bridge.ts:475-507](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts), replace the current middleware's single "gate POSTs" branch with an explicit method switch:

```ts
const mcpAuthMiddleware: Middleware = (req, res, next) => {
  if (req.path !== mcpPath) {
    next()
    return
  }

  if (req.method && req.method !== 'POST') {
    applyCorsHeaders(req, res)
    res.setHeader('Allow', 'POST, OPTIONS')
    res.status(405)
    if (typeof res.end === 'function') {
      res.end()
    } else {
      res.json({ error: 'method_not_allowed' })
    }
    return
  }

  // existing auth / 401 logic unchanged
}
```

Rationale:

- `OPTIONS /mcp` preflight should still be handled by whatever CORS wrapper the integrator mounts (Lovable has its own `app.options('/mcp', ...)`), so the 405 branch intentionally does NOT short-circuit `OPTIONS`. Leave the `req.method !== 'POST'` check; restrict 405 to `GET` / `HEAD` / `DELETE` / etc. by adding `&& req.method !== 'OPTIONS'`.
- `Allow: POST, OPTIONS` header is RFC 7231 §7.4.1-required on 405.
- `applyCorsHeaders` is already in-file and returns harmlessly when the origin isn't native-scheme, so adding it here is free and makes the 405 readable to Electron clients.

Final guard shape: `if (req.method && req.method !== 'POST' && req.method !== 'OPTIONS')`.

### 2. SDK — also add CORS + `Expose-Headers` to the 401 branch

While we're in `mcpAuthMiddleware`, call `applyCorsHeaders(req, res)` before `setMcpChallengeHeader(...)` and set `Access-Control-Expose-Headers: WWW-Authenticate` so the 401 challenge reaches native-scheme clients that don't have a framework-level CORS layer. Today [oauth-bridge.ts:498-506](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts) writes `WWW-Authenticate` but without CORS the Electron renderer can't read it.

```ts
} catch {
  applyCorsHeaders(req, res)
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id')
  setMcpChallengeHeader(res, publicBaseUrl, protectedResourcePath)
  // rest unchanged
}
```

This is the "small follow-up" I flagged after the SDK bridge landed and pairs naturally with change (1). Supabase Edge integrators get it for free without relying on Hono's CORS middleware being mounted before the `/mcp` handler.

### 3. SDK spec — new test cases

In [oauth-bridge.spec.ts](../../solvapay-sdk/packages/server/src/mcp/oauth-bridge.spec.ts), add:

- `it('returns 405 with Allow: POST, OPTIONS on GET /mcp')` — assert status 405, `Allow` header present, body empty or minimal. Use the existing mock req/res helpers.
- `it('mirrors native-scheme Origin on GET /mcp 405')` — `Origin: cursor://test` echoed back.
- `it('exposes WWW-Authenticate via CORS on 401 POST /mcp with native origin')` — `Access-Control-Allow-Origin: cursor://test` + `Access-Control-Expose-Headers` contains `WWW-Authenticate`.

Keep the existing POST auth tests untouched.

### 4. SDK docs — add "Streamable HTTP transport tips" section

In [docs/guides/mcp.mdx](../../solvapay-sdk/docs/guides/mcp.mdx), after the existing OAuth bridge section (around line 276 where the endpoints table lives), add a short subsection:

```md
### Streamable HTTP transport tips

- **`GET /mcp` must return 405, not 400.** Cursor opens a Streamable HTTP back-channel with `GET /mcp` + `Accept: text/event-stream`. Stateless MCP servers can't serve it; respond `405 Method Not Allowed` and Cursor stays connected. `createMcpOAuthBridge` does this for you; if your router forwards GETs to a different transport, make sure the fallback returns 405 (not 400).
- **`/.well-known/openid-configuration` must return 404.** Cursor tries OIDC Discovery before RFC 8414. If your router serves a catch-all for `/.well-known/*`, exclude this path — a JSON response missing `jwks_uri`, `subject_types_supported`, `id_token_signing_alg_values_supported` fails Cursor's OIDC validator and logs a noisy error. Only serve `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` from your MCP origin.
```

### 5. Lovable skill — two fixes in Step 9 + troubleshooting rows

In [skills/lovable-mcp-server/SKILL.md](../../skills/skills/lovable-mcp-server/SKILL.md):

(a) Replace the `app.all('/mcp', ...)` block at lines 441-455 with a version that explicitly handles the three methods:

```ts
app.get('/mcp', c => new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } }))

app.post('/mcp', async c => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(null, {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`,
      },
    })
  }
  return httpHandler(c.req.raw)
})
```

Add a short paragraph explaining why: `GET /mcp` is the Streamable HTTP SSE back-channel probe; stateless mcp-lite doesn't serve it and returning 400 breaks Cursor's transport state machine — respond 405 and Cursor stays connected.

(b) Before the `/mcp` routes (roughly after Step 8's `/oauth/*` block), add a one-liner route to swallow OIDC discovery probes:

```ts
app.get('/.well-known/openid-configuration', c => new Response(null, { status: 404 }))
```

With a sentence of context: Cursor tries OIDC Discovery first; without this explicit 404, Supabase Edge's catch-all returns a non-OIDC-compliant JSON blob that trips Cursor's validator. Returning 404 makes Cursor skip OIDC and use RFC 8414.

(c) Append two troubleshooting rows to the table at line 513:

```
| Cursor auth succeeds but FSM lands in `failed` with "Failed to open SSE stream: Bad Request" | mcp-lite's transport returns 400 on `GET /mcp`; Cursor's Streamable HTTP probe trips `transport_error` | Add the explicit `app.get('/mcp', ...)` 405 branch from Step 9 |
| Cursor logs Zod validation error on `jwks_uri` / `subject_types_supported` at first connect | Supabase Edge catch-all returned OAuth metadata for `/.well-known/openid-configuration`; Cursor's OIDC validator rejects it | Add `app.get('/.well-known/openid-configuration', ...)` returning 404 from Step 9 |
```

(d) Add a verification step to the Sandbox verification list at line 481:

```
6b. `curl -i https://<project>.supabase.co/functions/v1/mcp/mcp` returns 405 with `Allow: POST, OPTIONS` (no SSE back-channel).
6c. `curl -i https://<project>.supabase.co/functions/v1/mcp/.well-known/openid-configuration` returns 404.
```

## Verification

1. `pnpm --filter @solvapay/server test` — new spec cases green.
2. Rebuild the `mcp-oauth-bridge` example and hit it with curl:
   - `curl -i https://<ngrok>/mcp` → `405` + `Allow: POST, OPTIONS`.
   - `curl -i -H 'Origin: cursor://smoke' https://<ngrok>/mcp` → `405` + `Access-Control-Allow-Origin: cursor://smoke`.
   - `curl -i -X POST -H 'Origin: cursor://smoke' https://<ngrok>/mcp` (no bearer) → `401` + `WWW-Authenticate` + `Access-Control-Expose-Headers: WWW-Authenticate, Mcp-Session-Id`.
3. Lovable / Supabase Edge: after applying the skill diff, rerun the Cursor connect flow end-to-end. Expect:
   - No OIDC Zod validation error at discovery time.
   - FSM lands in `conn=connected,auth=unknown` and stays there (no `transport_error` 400 SSE line).
4. Release a new `@solvapay/server` preview tag carrying commits (1) + (2) + (3) so Lovable picks them up via the `@preview` pins already in the skill.

## Out of scope

- Full OIDC support at the MCP origin (would need a real `jwks_uri` — separate, much larger project).
- The mcp-pay nginx plan and the provider-MCP CORS plan — independent fixes covered elsewhere.
- Restructuring `mcpAuthMiddleware` into per-method middlewares — deferred; the inline method switch stays small.
