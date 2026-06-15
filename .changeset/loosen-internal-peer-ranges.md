---
"@solvapay/react": patch
"@solvapay/server": patch
"@solvapay/mcp": patch
---

Loosen internal `@solvapay/*` peerDependency ranges from `workspace:*` (exact) to `workspace:^` so a patch/minor bump of a peer no longer forces a major bump on its dependents. Affects `@solvapay/react` → `@solvapay/mcp-core`, `@solvapay/server` → `@solvapay/auth`, and `@solvapay/mcp` → `@solvapay/mcp-core`. This is a widening of the published peer range and is non-breaking for consumers.
