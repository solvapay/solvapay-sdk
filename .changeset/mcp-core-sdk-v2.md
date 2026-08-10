---
'@solvapay/mcp-core': minor
---

`hideToolsByAudience` now reads `User-Agent` from Web `Request` headers, which is the primary ChatGPT detection path for 2026-era connections where `initialize` never runs. It uses the public `setRequestHandler` where available instead of only reaching into the private handler map.

The `zod` peer narrows to `^4.2.0` and `engines.node` is now `>=20`. Consumers still on zod 3 must upgrade — this is why the release takes the `0.3.0` boundary rather than a patch, so `^0.2.x` installs are not silently pulled onto it.
