---
'create-solvapay': minor
---

Add `apiKey-multi` upstream auth for OpenAPI specs that require two or more static credential headers together (multi-scheme AND, no token exchange). The scaffolder auto-detects supported header schemes, seeds a single `UPSTREAM_API_HEADERS` compact-JSON secret, and generated tools spread parsed headers on upstream calls.
