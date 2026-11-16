---
'@solvapay/server': patch
---

The generated API types follow the platform: a product (`SdkProductResponse`, from `getProduct`, `listProducts`, `createProduct`, `updateProduct`, `cloneProduct` and the MCP bootstrap) no longer has `balance` or `totalTransactions`. The platform stopped writing them in March 2026 and now drops them; merchant revenue lives in the SolvaPay Console's Financials.
