---
'@solvapay/server': major
'@solvapay/react': major
---

The payment intent's id is now `intentId`, as the platform names it. `processorPaymentId` is gone from the API (`SdkPaymentIntentResponse`, `SdkPaymentIntentListItem` and the `{intentId}` path parameter of `/process` and `/business-details`), from what `createPaymentIntentCore` and `createTopupPaymentIntentCore` return, and from `PaymentIntentResult`, `TopupPaymentResult`, `useCheckout` and `useTopup` in `@solvapay/react`. The `create_payment_intent` MCP tool answers `intentId` too. Read `intentId` wherever you read `processorPaymentId`.

The generated types also drop `statementDescriptor` from `SdkMerchantResponseDto`, as the platform no longer returns it.
