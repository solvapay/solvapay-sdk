---
'@solvapay/server': minor
---

`payable.http()`, `payable.next()` and `payable.gate()` no longer trust the caller to name the customer. Without `getCustomerRef`:

- `Authorization: Bearer` is trusted only when `verifyBearerToken` verifies it (`SOLVAPAY_JWT_SECRET`, `SOLVAPAY_JWKS_URL`, Supabase, or a gateway you opt into). The adapters no longer fall back to the `'test-jwt-secret'` key, `http://localhost:3000` issuer or `test-client-id` audience, which let anyone sign a token for any customer. A token nothing can verify gets a 401.
- `x-customer-ref` is trusted only with `SOLVAPAY_AUTH_TRUST_GATEWAY=true`; sent without it, the request gets a 401.
- `payable.next()` no longer charges an unidentified request to a shared `demo_user` customer: it is anonymous.
- A verified token's subject is always looked up by `externalRef` (new `ensureCustomerForUser`), never used as a customer ref, even when it starts with `cus_`.

If you relied on `x-customer-ref`, pass `getCustomerRef` with the user from your own auth. `AdapterUtils.extractFromJWT` now needs a secret (`options.secret` or `OAUTH_JWKS_SECRET`) and is deprecated.
