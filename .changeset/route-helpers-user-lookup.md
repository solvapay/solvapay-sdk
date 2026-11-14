---
'@solvapay/server': minor
'@solvapay/mcp-core': patch
---

The route helpers (`checkPurchaseCore`, `syncCustomerCore` and the routes built on them) always look the caller's user up by `externalRef`. Before, a user id starting with `cus_` was used as that customer, so a user whose id was `cus_<someone>` acted for them.

Server code that already knows the customer marks the request with the new `withCustomerRef(request, customerRef)`; the helpers then act for that customer as `ensureCustomer` does. `@solvapay/mcp-core`'s `buildSolvaPayRequest` marks the requests the widget tools build with the signed-in `customer_ref`, so MCP servers need no change.
