---
'@solvapay/server': patch
---

Facade config is explicit option > env > default (base URL only). `createSolvaPay({ apiKey })` now reads `SOLVAPAY_API_BASE_URL`. `SOLVAPAY_DEBUG` is off unless it is exactly `true`. The Rust client rejects an empty secret at construction (`missing_api_key`). Ruby reads `SOLVAPAY_API_BASE_URL`. See `docs/contributing/configuration.md`.
