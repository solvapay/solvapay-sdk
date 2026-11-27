---
'@solvapay/python': minor
'@solvapay/go': minor
---

The payment intent's id is now `intentId`, as the platform and the TypeScript SDK name it. The generated API clients follow the platform (`SdkPaymentIntentResponse` and `SdkPaymentIntentListItem` carry `intentId`, with `processorPaymentId` optional and deprecated, and `SdkMerchantResponseDto` no longer has `statementDescriptor`), and the `create_payment_intent` MCP tool and the `create-payment-intent` and `create-topup-payment-intent` web routes answer `intentId` instead of `processorPaymentId`. Adopts the 5 re-recorded payment intent cases.
