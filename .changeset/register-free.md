---
'@solvapay/release-train': minor
'@solvapay/react': patch
'create-solvapay': minor
---

Add `registerFree` for capped free MCP tools. Decision logic lives in solvapay-core (`limit_reached`, free-meter gate copy, `freeAllowance` on checkLimits, identity-required 401). Facades only thread `freeLimit`. TypeScript `from-openapi` scaffolding emits the `free-capped` tier as `registerFree`.
