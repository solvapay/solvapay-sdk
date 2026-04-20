---
name: oauth revoke verification and hardening
overview: The `/oauth/revoke` proxy shipped alongside the RFC 8414 bridge rewrite ([sdk_oauth_bridge_full_proxy_842b5cd9.plan.md](solvapay-sdk/.cursor/plans/sdk_oauth_bridge_full_proxy_842b5cd9.plan.md)) has unit coverage for body/header forwarding but is not exercised end-to-end — Cursor's "Logout" action clears local tokens without calling revoke, so the upstream token never actually gets invalidated. This plan closes the gap with an end-to-end revoke script, RFC 7009 edge-case unit coverage, an integration test that proves post-revoke tokens fail against `userinfo`, and an example-level surface (docs + a `logout` tool) so MCP hosts that omit revoke still let users explicitly revoke when they want to.
todos:
  - id: oauth-flow-revoke-step
    content: Extend `examples/mcp-oauth-bridge/scripts/run-oauth-flow.ts` with an optional `--revoke` flag that, after the successful tools/call, posts the access token to `/oauth/revoke` via the bridge and then tries `userinfo` with the same token to assert it's actually invalidated
    status: pending
  - id: rfc7009-unit-cases
    content: Add unit coverage in `packages/server/src/mcp/oauth-bridge.spec.ts` for RFC 7009 edge cases — unknown-token still 200, `token_type_hint=refresh_token` forwarded verbatim, Basic `Authorization` header preserved, JSON body accepted alongside form-encoded, upstream 400/401 passthrough, OPTIONS preflight for `cursor://` origin. Only the raw-body Basic-auth forwarding case is currently covered
    status: pending
  - id: backend-revocation-effect-test
    content: "Integration test (or manual verification documented in the example README) that after `POST /oauth/revoke`, calling `GET /v1/customer/auth/userinfo` with the revoked access token returns 401. Confirms the backend actually invalidates — not just echoes `{revoked:true}`. If it doesn't, file a backend bug rather than patching the bridge"
    status: pending
  - id: rfc7009-body-shape-note
    content: "Document (don't fix in this plan) that SolvaPay backend returns `{revoked:true}` for `/v1/customer/auth/revoke`; RFC 7009 §2.2 expects an empty 200 body. Open a backend follow-up issue. No spec-strict MCP client we've seen cares, and the bridge forwards the body verbatim so changing it is backend-owned"
    status: pending
  - id: example-logout-tool
    content: 'Add an optional `logout` tool to `examples/mcp-oauth-bridge/src/index.ts` that calls the upstream revoke with the current bearer token from `extra.authInfo`. Rationale: some MCP hosts (Cursor today) do not call revoke on disconnect, so integrators who care about immediate token invalidation need an in-tool surface. Keep it behind an opt-in env flag so it does not leak into every example by default'
    status: pending
  - id: cursor-logout-behaviour-doc
    content: "Document in `examples/mcp-oauth-bridge/README.md` and `docs/guides/mcp.mdx` that Cursor's Logout is client-local: it clears stored tokens + client credentials and re-initiates DCR but does not call `/oauth/revoke`. Observed in Cursor logs 2026-04-20: `Handling LogoutServer action` → `Clearing stored OAuth data` → immediate `ReloadClient` with fresh DCR, zero bridge hits. Integrators wanting upstream revocation should rely on TTL expiry, explicit tool-triggered revoke (see example-logout-tool), or server-side session invalidation"
    status: pending
  - id: verify-flow
    content: "Re-run the extended `pnpm oauth:flow --revoke` end-to-end, confirm: (1) tokens/call succeeds, (2) /oauth/revoke returns 200 via the bridge, (3) /userinfo with the same token returns 401 after revoke"
    status: pending
isProject: false
---

## Why this plan exists

[`sdk_oauth_bridge_full_proxy_842b5cd9`](solvapay-sdk/.cursor/plans/sdk_oauth_bridge_full_proxy_842b5cd9.plan.md) shipped `createOAuthRevokeHandler` + one unit test that asserts forwarding to `/v1/customer/auth/revoke` with body + Authorization passthrough and mirrored 200 status. The e2e verification pass for that plan covered DCR, authorize, token, `/mcp` tools/call, and Cursor reconnect — but not revoke.

Cursor's Logout action turned out to be client-local:

```34:37:anysphere.cursor-mcp.MCP user-solvapay-oauth-bridge.workspaceId-b840c0033eadfaa54e51ee5678f52f4c
2026-04-20 16:13:15.365 [info] [V2] Handling LogoutServer action
2026-04-20 16:13:15.365 [info] Clearing stored OAuth data
2026-04-20 16:13:15.388 [info] Successfully cleared OAuth tokens
2026-04-20 16:13:15.389 [info] [V2] Removing client, reason: logout_server
```

Immediately followed by a fresh DCR, zero bridge hits. Consequence: the access token and refresh token issued to that session remain valid on the SolvaPay backend until natural TTL expiry (observed `expires_in: 3600` for access_token). This is fine behaviour for a local dev tool but surprising for anyone who expects "Logout" to invalidate server-side state.

So the revoke path has three distinct coverage gaps:

1. We've never proven the full pipeline works against a real token (unit test uses a dummy).
2. We've never proven the backend actually invalidates the token (vs. echoing `{revoked:true}` and leaving state untouched).
3. The example doesn't give integrators any path to trigger revoke themselves when their host client skips it.

## What is already shipped

From PR #105 / the OAuth bridge plan:

- [`packages/server/src/mcp/oauth-bridge.ts`](solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts) — `createOAuthRevokeHandler({ apiBaseUrl, path? })` forwards raw body + content-type + optional Authorization header to `${apiBaseUrl}/v1/customer/auth/revoke`, mirrors status and body, CORS preflight handled on `OPTIONS /oauth/revoke`, 502 on network failure.
- [`packages/server/src/mcp/oauth-bridge.spec.ts`](solvapay-sdk/packages/server/src/mcp/oauth-bridge.spec.ts) — one test at `createOAuthRevokeHandler > forwards to upstream /revoke and mirrors status` (form-encoded body, Basic auth header, 200 passthrough).
- Discovery doc advertises `revocation_endpoint: "${publicBaseUrl}/oauth/revoke"` in `getOAuthAuthorizationServerResponse`.

Smoke-tested today with a dummy token via the bridge on `localhost:3004`:

```
POST /oauth/revoke (form, dummy token) → 200 { "revoked": true }
```

So the proxy pipeline is healthy — the missing piece is end-to-end proof that a real revoked token actually stops working.

## Scope

Changes are confined to the SDK:

- [`examples/mcp-oauth-bridge/scripts/run-oauth-flow.ts`](solvapay-sdk/examples/mcp-oauth-bridge/scripts/run-oauth-flow.ts) — add `--revoke` step (parses argv, runs the revoke POST + userinfo assertion at the end).
- [`packages/server/src/mcp/oauth-bridge.spec.ts`](solvapay-sdk/packages/server/src/mcp/oauth-bridge.spec.ts) — add the six edge cases in the `rfc7009-unit-cases` todo under a new `createOAuthRevokeHandler` describe block.
- [`examples/mcp-oauth-bridge/src/index.ts`](solvapay-sdk/examples/mcp-oauth-bridge/src/index.ts) — optional `logout` tool behind `EXAMPLE_EXPOSE_LOGOUT_TOOL=true`, calls `fetch(apiBaseUrl + '/v1/customer/auth/revoke')` with the request's bearer token read from `extra.authInfo`.
- [`examples/mcp-oauth-bridge/README.md`](solvapay-sdk/examples/mcp-oauth-bridge/README.md) — new "Logout and revoke" section documenting Cursor's local-only logout + how to use the `logout` tool.
- [`docs/guides/mcp.mdx`](solvapay-sdk/docs/guides/mcp.mdx) — short note in the OAuth section about client-local logout semantics, linking back to the example.

## Out of scope

- Changing SolvaPay backend's revoke response body (tracked in the `rfc7009-body-shape-note` todo as a backend follow-up, not a blocker here).
- Adding the `logout` tool to `examples/mcp-time-app` or `examples/mcp-checkout-app`. The bridge example is the canonical "how the OAuth surface works" reference; the others are vertical-slice demos.
- Cursor behaviour. We cannot make Cursor call revoke on Logout. The docs update is the mitigation.
- Automatic session invalidation on the SolvaPay backend triggered by MCP `/mcp` disconnect events. That is a real feature but belongs in a backend plan, not this one.
- Revoking refresh tokens separately. `token_type_hint=refresh_token` is covered at the forwarding layer; whether the backend treats the hint correctly is the `backend-revocation-effect-test` todo's job to verify.

## Verification

Extended end-to-end flow (after the `--revoke` flag lands):

```bash
cd examples/mcp-oauth-bridge
pnpm dev &
pnpm oauth:flow -- --revoke
# expected:
# 7) tool call succeeded
# 8) POST /oauth/revoke → HTTP 200
# 9) GET /v1/customer/auth/userinfo with revoked token → HTTP 401  ✓
```

Unit tests:

```bash
pnpm --filter @solvapay/server test
# expect new cases under createOAuthRevokeHandler — 6 new, plus existing 1
```

Existing smoke regression:

```bash
curl -s -X POST http://localhost:3004/oauth/revoke \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'token=dummy&token_type_hint=access_token' -w '\nHTTP %{http_code}\n'
# → HTTP 200 (upstream currently returns {"revoked":true})
```

## Sequencing

Not blocking the `@preview` MCP-app release. The revoke proxy is already in the shipped bridge; this plan hardens and verifies it. Land any time after PR #105 merges.

Ordering suggestion:

1. `rfc7009-unit-cases` — smallest, closes the easy coverage gap.
2. `oauth-flow-revoke-step` + `backend-revocation-effect-test` + `verify-flow` — one sitting.
3. `example-logout-tool` — opt-in behind env flag, lands with the README update.
4. `cursor-logout-behaviour-doc` — doc-only, can piggyback on any PR.
5. `rfc7009-body-shape-note` — file backend issue, no SDK code change.
