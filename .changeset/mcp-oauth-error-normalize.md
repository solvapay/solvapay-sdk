---
'@solvapay/mcp': patch
---

`createOAuthTokenHandler` + `createOAuthRevokeHandler` on both the
fetch bridge (`@solvapay/mcp/fetch`) and the Express bridge
(`@solvapay/mcp/express`) now only pass an upstream error body through
unchanged when its `error` field is one of the nine RFC 6749 error
codes accepted at the token endpoint (`invalid_request`,
`invalid_client`, `invalid_grant`, `unauthorized_client`,
`unsupported_grant_type`, `invalid_scope`, `server_error`,
`temporarily_unavailable`, `access_denied`).

Previously any upstream body with a string `error` field was treated
as RFC-compliant and proxied verbatim. NestJS' default exception
filter produces `{ error: "Unauthorized", message: "...", statusCode: 401 }`
on 401 responses — the literal `"Unauthorized"` leaked through that
gate, so strict MCP OAuth clients surfaced the token exchange as an
opaque "auth failed" instead of the expected `invalid_client`.

With this change, non-RFC bodies fall through to `deriveOAuthErrorCode`

- `buildErrorDescription` which map the upstream status + message
  into a valid RFC 6749 code (e.g. `401 Unauthorized` →
  `{ error: 'invalid_client', error_description: 'Invalid or inactive client' }`).

See Phase 2b of `.cursor/plans/preview_iteration_+_promote_roadmap_88a4eaa0.plan.md`
for the original failure mode (SolvaPay API NestJS 401 surfacing as
`Unauthorized` in the MCP Inspector smoke).
