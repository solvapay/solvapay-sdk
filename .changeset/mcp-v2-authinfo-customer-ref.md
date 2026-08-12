---
'@solvapay/mcp-core': patch
'@solvapay/server': patch
---

Fix `customer_ref` never resolving on the official MCP SDK v2, which left every authenticated tool call unauthenticated.

SDK v2 moved the auth envelope on the tool-handler context from the flat `extra.authInfo` to `extra.http.authInfo` (`BaseContext.http.authInfo`, populated by HTTP transports). The customer-ref extractors still read the v1 location, so `getCustomerRef` always resolved to `null` even when the OAuth bridge had authenticated the request correctly.

The failure was silent in most paths: intent tools returned a bootstrap payload with `customer: null` (rendering an empty "no active plan" account panel for paying customers), and `registerPayable` tools billed against `'anonymous'`. Only `create_checkout_session` failed loudly, with `customer_ref missing from MCP auth context`.

`defaultGetCustomerRef`, the MCP paywall adapter, and the virtual-tools extractor now read `extra.http.authInfo` first and fall back to the flat `extra.authInfo` still emitted by some third-party adapters. `McpToolExtra` gained a typed `http.authInfo` member — the interface's index signature had absorbed the new key, which is why the original migration typechecked cleanly and broke only at runtime.
