---
'@solvapay/server': minor
'@solvapay/core': minor
---

Every error the server SDK raises on a known path now carries a stable `code` (and the API's `status`), matching the Python SDK, so callers can branch on `error.code` instead of the message:

- An API failure is coded with the API's own `code` when its JSON body has one, else `http_<status>`; a body that is not JSON is `non_json_response`.
- A missing product ref is `missing_product`; a missing secret key is `missing_secret`.
- A customer creation conflict the SDK cannot resolve is now a `SolvaPayError` coded `customer_conflict`, with status 409 (it was a plain `Error`).

`createSolvaPayClient` has `cancelPurchase` again (`POST /v1/sdk/purchases/{purchaseRef}/cancel`). It went missing in 2.10.0, so `cancelPurchaseCore` and the MCP widget's `set_renewal` cancel answered 500 "Cancel purchase method not available on SDK client". `attachBusinessDetails` again returns the API's answer as is and names itself when it fails (it had been reporting "Cancel purchase failed").
