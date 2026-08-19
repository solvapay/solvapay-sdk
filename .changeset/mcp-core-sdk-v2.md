---
'@solvapay/mcp-core': minor
---

`hideToolsByAudience` now reads `User-Agent` from Web `Request` headers. This is the primary ChatGPT detection path for 2026-era connections, where `initialize` never runs and the previous detection had nothing to key off.

The `zod` peer narrows to `^4.2.0` and `engines.node` moves to `>=20`. Consumers still on zod 3 or Node 18 must upgrade.
