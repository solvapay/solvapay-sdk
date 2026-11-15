---
'@solvapay/agents': patch
---

Fixes found by the conformance coverage of the agents package:

- The prompt excerpt never ends up starting with half of a character: when the 1,500-unit cut goes through an emoji, its lone half is dropped.
- A cost of 1e21 or more is sent as plain digits, not `1e+21`.
- A resource at the origin gets the metadata path `/.well-known/oauth-protected-resource`, without a trailing slash.
- A numeric `jti` comes back as a string token id.
- In a batch from a host that has not signed in, the challenge carries the id of the paid call that needs sign-in, not of the first call.
- `refusalStatus` throws a `SolvaPayError` with code `unknown_refusal_reason` for a reason it doesn't know.
