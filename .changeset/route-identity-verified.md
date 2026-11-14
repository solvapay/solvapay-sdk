---
'@solvapay/auth': minor
'@solvapay/server': minor
---

Route helpers now trust a bearer token only after verifying it. `getAuthenticatedUserCore` (behind every `@solvapay/server` route helper, the `@solvapay/server/fetch` handlers and the `@solvapay/next` helpers) and `getUserEmailFromRequest` / `getUserNameFromRequest` used to read an unverified JWT's `sub`, email and name when no `SOLVAPAY_JWT_SECRET` / `SUPABASE_JWT_SECRET` was set, so anyone could name another user. A token is now verified by the new `verifyBearerToken` from `@solvapay/auth`:

- HS256 with `SOLVAPAY_JWT_SECRET` or `SUPABASE_JWT_SECRET`, as before;
- ES256/RS256 against `SOLVAPAY_JWKS_URL`, or Supabase's JWKS derived from `SUPABASE_URL` (set automatically in Supabase Edge Functions);
- or, only when you opt in with `SOLVAPAY_AUTH_TRUST_GATEWAY=true`, a gateway that verified it already (Supabase Edge with `verify_jwt = true`).

With none of these, the routes answer `401` with a message naming the three options. `SOLVAPAY_AUTH_STRICT=true` now forbids gateway trust. The `@solvapay/server/fetch` handlers also drop a client-sent `x-user-id` header: they have no middleware in front of them, so identity comes from the verified token alone.

**Action needed** if your routes ran without a JWT secret: on Supabase Edge, nothing for projects on asymmetric signing keys; otherwise set `SOLVAPAY_JWT_SECRET`, `SOLVAPAY_JWKS_URL`, or `SOLVAPAY_AUTH_TRUST_GATEWAY=true`.
