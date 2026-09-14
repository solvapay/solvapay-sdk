---
'@solvapay/server': patch
'@solvapay/core': patch
---

Concurrent `checkLimits` overlay now lives in core, so Ruby and Rust gates match TypeScript / Go / Python when multiple in-flight claims share a cache.
