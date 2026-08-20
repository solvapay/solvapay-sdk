---
'@solvapay/server': minor
---

Virtual MCP tool registration now wraps generated input schemas in `z.object()` so they convert correctly under the MCP SDK v2 schema pipeline. The `zod` peer moves to `^4.2.0` and `engines.node` to `>=20` to match the rest of the MCP surface; nothing in the paywall, nudge, or checkout APIs changes.
