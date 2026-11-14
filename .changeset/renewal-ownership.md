---
'@solvapay/server': minor
---

`cancelPurchaseCore` and `reactivatePurchaseCore` now act only on the caller's own purchase. They used to cancel or reactivate any purchase reference they were given, without a verified user on the web routes, and for any signed-in customer through the MCP widget's `set_renewal` tool. They now resolve the verified user's customer, fetch the purchase (`GET /v1/sdk/purchases/{purchaseRef}`, the new `apiClient.getPurchase`), and answer `403 Forbidden` ("This purchase belongs to another customer") when it isn't theirs, or `401` with no verified user.
