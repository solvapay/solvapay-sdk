---
'@solvapay/mcp-core': patch
---

The account tool names who is signed in. `BootstrapCustomer` carries `email` and `name` from the customer record, and the text summary adds `Signed in as: email · customer ref` so a host that only reads the text can quote the ref.

An anonymous caller is not a customer. A `getCustomerRef` that returns `'anonymous'` is treated as unauthenticated, and the bootstrap no longer tries to mint a hosted checkout session for it; `checkoutUrl` is `null`, which is what the backend already produced by rejecting the ref.
