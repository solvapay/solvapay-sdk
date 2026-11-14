---
'@solvapay/server': patch
---

The API client encodes customer and purchase references in URL paths (`getCustomer`, `getCustomerBalance`, `reactivatePurchase`); the customer reference can come from the client's `x-solvapay-customer-ref` header. The fetch handlers' CORS preflight now allows `PUT` and `DELETE`, so a cross-origin React app can save and disable auto-recharge.
