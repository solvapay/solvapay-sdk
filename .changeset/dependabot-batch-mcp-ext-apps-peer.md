---
'@solvapay/mcp': patch
---

Bump the `@modelcontextprotocol/ext-apps` peer-dep range from `^1.5.0` to `^1.7.1`. Consumers pinned to the old range will now resolve to a compatible 1.7 build during install; the SDK's own behaviour is unchanged. Pair with `@solvapay/react@1.1.4` (or later) so the iframe-side `McpAppFull` interface accepts the tightened ext-apps event-listener generics.
