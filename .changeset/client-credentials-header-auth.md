---
'create-solvapay': minor
---

Add `client-credentials-header` upstream auth for OpenAPI specs that declare a client-id + client-secret header pair (no token exchange). The scaffolder auto-detects the pair, seeds `UPSTREAM_CLIENT_ID` / `UPSTREAM_CLIENT_SECRET`, and generated tools send both headers on upstream calls.
