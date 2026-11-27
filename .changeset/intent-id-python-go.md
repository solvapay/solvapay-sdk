---
'@solvapay/python': minor
'@solvapay/go': minor
---

The payment intent's id is now `intentId`, as the platform and the TypeScript SDK name it. The generated API clients follow the platform (`SdkPaymentIntentResponse` and `SdkPaymentIntentListItem` carry `intentId`, `SdkMerchantResponseDto` no longer has `statementDescriptor`), and the `create_payment_intent` MCP tool and the `create-payment-intent` and `create-topup-payment-intent` web routes answer `intentId` instead of `processorPaymentId`. The 0.1.1 Python model required `processorPaymentId`, so `create_payment_intent` failed validation against the new API. Adopts the 5 re-recorded payment intent cases.
