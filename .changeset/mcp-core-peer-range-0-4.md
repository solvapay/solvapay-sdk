---
'@solvapay/react': patch
'@solvapay/mcp': patch
---

Widen the `@solvapay/mcp-core` peer range to accept `^0.4.0`. Existing installs pinned to `^0.3.0` keep resolving to 0.3.x and are unaffected; moving to mcp-core 0.4.x is now an explicit opt-in that no longer forces a peer conflict.
