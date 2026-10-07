---
'@solvapay/core': patch
'@solvapay/server': patch
'@solvapay/next': patch
'@solvapay/react': patch
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

Vault checkout: keyed errors, 3DS returns, billing details.

- core: `SolvaPayError` carries `code`, `reason` and `declineCode`.
- server: the API client reads a keyed error body (`error`, `message`, `reason`, `declineCode`) into `SolvaPayError`; a plain NestJS body keeps its `message`. `ErrorResult` carries `code`, `reason` and `declineCode`; `handleRouteError` copies them and the `@solvapay/server/fetch` error body carries them next to `error`. `parseApiErrorBody` is exported.
- server: `confirmPayment` and `confirmPaymentCore` take `billingDetails` (`CardBillingDetails`). `SaveAutoRechargeInput` equals `AutoRechargeInput`; the `deferSetupIntent` flag is gone, a top-up payment intent created with `autoRecharge` stages the config.
- server: `@solvapay/server/fetch` exports `createCaptureGrant`, `confirmPayment`, `createCardSetupGrant` and `saveCard`.
- next: `confirmPayment` takes `billingDetails`; the JSON error envelope carries `code`, `reason` and `declineCode`.
- react: the HTTP transport and the MCP adapter throw `TransportError` (`status`, `code`, `reason`, `declineCode`) for a refusal. `PaymentForm`, `TopupForm` and `AutoRecharge.CardSetup` show payer copy by key (`copy.vaultErrors`, the hosted checkout's keys); `paymentErrorMessage`, `paymentFailureMessage`, `declineMessage` and `PAYMENT_ERROR_CODES` are exported. `confirmVaultPayment` returns `code` on an error result.
- react: a `pending` confirm is reconciled through the backend; a payment still settling shows in the new `PaymentForm.Notice` / `TopupForm.Notice` slot (`role="status"`, in the default trees) and does not fire `onError`.
- react: a 3DS return resumes the payment the payer left for. The forms tag `returnUrl` with `solvapay_payment=<id>` and remember the payment in `sessionStorage`; on return they create no new payment and report that payment's ids. `buildPaymentReturnUrl`, `readPaymentReturn`, `rememberPaymentReturn`, `takePaymentReturn` and `stripPaymentReturnParams` replace `readPaymentIntentId` and `stripPaymentIntentParams`. A return without a remembered payment reports `copy.errors.paymentReturnUnresolved`.
- react: inside an MCP host the forms open the 3DS page through the host (`ui/open-link`), stay mounted with `copy.errors.paymentAwaitingAuthentication` and poll the backend until the payment settles. `useCanOpenExternal` is exported.
- react: the forms send `billingDetails` on every confirm (customer name, email, buyer country, state and postal code; `buildBillingDetails`). `SaveCardParams` takes `billingDetails` with a card.
- react: `AutoRecharge` with `deferCardSetup` validates the form and hands the config to `onPendingConfig` without saving it.
- mcp-core: the bootstrap's `returnUrl` is the return page at `publicBaseUrl` + `/solvapay/payment-return` (`PAYMENT_RETURN_PATH`, `paymentReturnUrl`, `renderPaymentReturnPage`, `paymentReturnResponse`, `isPaymentReturnPath`). `confirm_payment` takes `billingDetails`. `publicBaseUrl` must share its origin with the website registered for the SolvaPay account, or every confirm answers 400.
- mcp: `createMcpOAuthBridge` and the fetch handler serve `GET /solvapay/payment-return`.
