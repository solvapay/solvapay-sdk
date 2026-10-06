---
'@solvapay/mcp-core': patch
'@solvapay/mcp': minor
'@solvapay/auth': minor
---

`@solvapay/mcp/fetch` servers can now sit behind a third-party OIDC authorization server (Auth0 first; any RS256/ES256 issuer with a JWKS works) instead of SolvaPay's customer OAuth.

**`@solvapay/mcp/fetch`**

- New `verifyToken(token, req) → VerifiedBearer | null` option on `createSolvaPayMcpFetchHandler` / `createSolvaPayMcpFetch`: the one bearer-verification seam. `null` → `401` with `error="invalid_token"`; a thrown error → `500` (never masked). Usable in SolvaPay mode too.
- New `authorizationServer: { issuers, scopesSupported, resource? }` option. When set, only the RFC 9728 protected-resource document is served (`authorization_servers = issuers`, `resource = ${publicBaseUrl}${mcpPath}`); `/.well-known/oauth-authorization-server` and the SolvaPay `/oauth/*` proxy are not mounted. Requires `verifyToken` and a non-empty `scopesSupported`; validated at construction with messages that name the fix.
- `createSolvaPayMcpFetch` bridges a verified non-`cus_` subject to a SolvaPay customer via `solvaPay.ensureCustomer(subject, subject, { email, name })`, forwarding `email` only when the issuer asserted `emailVerified === true`. Exported as `bridgeVerifiedBearerToCustomer` for BYO-handler setups.
- The missing-token challenge no longer carries an `error` attribute (RFC 6750 §3.1); rejected tokens carry `error="invalid_token"`. In the SolvaPay decode path only `McpBearerAuthError` maps to `401`; other errors now surface as `500` instead of being swallowed.
- New exports: `createExternalDiscoveryRouter`, `VerifyBearerToken`, `ExternalAuthorizationServerOptions`, `BearerChallengeError`.

**`@solvapay/auth`**

- New `createJwksBearerVerifier({ issuer, audience, jwksUri?, claims? | userinfoEndpoint?, audienceMismatchHint? })` (root entry): verifies signature, `iss` (compared verbatim, trailing slash and path included) and `aud` against the issuer's JWKS via lazily imported `jose`; profile from mapped access-token claims or an OIDC userinfo endpoint (memoised per token until `exp`). Rejections return `null`; unreachable JWKS, non-2xx userinfo and configuration problems throw.
- New `createAuth0BearerVerifier({ domain, audience, claimNamespace? })` on `@solvapay/auth/auth0`: Auth0 preset over the generic verifier (issuer `https://{domain}/`, namespaced claims from a post-login Action). `domain` is the token-issuing hostname (custom domain when configured).

**`@solvapay/mcp-core`**

- `getOAuthProtectedResourceResponse(publicBaseUrl, { authorizationServers?, scopesSupported?, resource? })`; default output unchanged.
- New `VerifiedBearer` type, `toAuthInfo` envelope builder and `buildAuthInfoFromVerifiedBearer`; `buildAuthInfoFromBearer` now routes through `toAuthInfo` with identical output.
- `logMcpConfigOnce` accepts `authMode` / `authorizationServers` and names the auth mode on the config line.
