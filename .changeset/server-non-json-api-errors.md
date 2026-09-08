---
'@solvapay/server': patch
'@solvapay/server-native': patch
'@solvapay/server-wasm': patch
---

API errors now say when the response was not JSON. A `SolvaPayError` raised from a non-JSON body (an offline tunnel, a proxy error page) carries `code: 'non_json_response'`, and its message names the content type and truncates the body instead of pasting a whole HTML page. `verifyProductConfiguration` uses that code to report an unreachable `SOLVAPAY_API_BASE_URL` rather than claiming the product does not exist.

Every client method now raises through one shared error path, so `cancelPurchase` and `reactivatePurchase` no longer emit their own bespoke 400/404 messages. Statuses are unchanged; only the message text differs.
