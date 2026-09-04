---
'@solvapay/server-native': patch
---

Remove the napi WASI fallback. `@solvapay/server-native` now loads only a platform `.node` prebuild. Unsupported Node platforms fail to load instead of falling back to sync-only WASM. Edge and browser continue to use `@solvapay/server-wasm`.
