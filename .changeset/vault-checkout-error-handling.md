---
"@solvapay/react": patch
"@solvapay/server": patch
"@solvapay/next": patch
"@solvapay/mcp-core": patch
---

Vault checkout hardening:

- react: a `requires_action` confirm without a `redirectUrl` now fails with the new `errors.authenticationUnavailable` copy instead of showing the raw `Payment status: requires_action` text.
- react: `PaymentForm` and `TopupForm` vault submits now call `onError` for `pending` and `other` confirm results, not only for `error`.
- react: `PaymentForm.CardFields` shows the `required` message for a touched-empty field even when the vault reports a specific error code.
- server: `confirmPaymentCore` returns distinct 400 messages for a body with neither cardId nor paymentMethodId (`Provide cardId or paymentMethodId`) and for one with both (`Provide either cardId or paymentMethodId, not both`).
- mcp-core: `create_capture_grant` and `confirm_payment` reject a missing or non-string `paymentIntentId`, and a non-string or empty `cardId` / `paymentMethodId` / `returnUrl`, with a 400 tool error instead of coercing or dropping them.
