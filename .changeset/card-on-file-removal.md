---
'@solvapay/server': minor
'@solvapay/next': minor
'@solvapay/mcp-core': minor
'@solvapay/react': minor
---

Remove the customer's card on file.

- server: `removePaymentMethod({ customerRef })` on the API client and `removePaymentMethodCore(request)` (`DELETE /v1/sdk/payment-method`). The card is detached on the payment rail; the next saved card becomes the default; auto-recharge on the removed card waits for a new card (`autoRechargePaused`). The `./fetch` subpath adds a `removePaymentMethod` handler, and CORS allows `DELETE`.
- next: `removePaymentMethod(request)` route helper, for `export const DELETE` next to `getPaymentMethod`.
- mcp-core: UI-only `remove_payment_method` tool.
- react: `transport.removePaymentMethod()` (HTTP `DELETE /api/payment-method`, MCP `remove_payment_method`) and `usePaymentMethod().remove()`, which reloads the new default card.
- react: `<VaultCardFields>` lists the SolvaPay test cards in sandbox (`testCards`, default `true`; never shown in live). `SANDBOX_TEST_CARDS` is exported.
