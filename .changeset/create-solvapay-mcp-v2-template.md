---
'create-solvapay': minor
---

The `mcp` scaffold now generates an SDK v2 project: templates depend on `@modelcontextprotocol/core` and `@modelcontextprotocol/server` instead of `@modelcontextprotocol/sdk`, the generated worker builds its server through a per-request factory, and the pinned `@solvapay/mcp` runtime dependency moves to the `0.3.x` line.
