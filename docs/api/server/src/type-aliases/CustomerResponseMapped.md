[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / CustomerResponseMapped

# Type Alias: CustomerResponseMapped

> **CustomerResponseMapped** = `object`

Defined in: [packages/server/src/types/client.ts:21](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L21)

Extended CustomerResponse with proper field mapping

Note: The backend API may return subscriptions with additional fields beyond SubscriptionInfo
(e.g., amount, endDate, cancelledAt, cancellationReason) as defined in SubscriptionResponse.
These additional fields are preserved in the subscriptions array.

## Properties

### customerRef

> **customerRef**: `string`

Defined in: [packages/server/src/types/client.ts:22](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L22)

***

### email?

> `optional` **email**: `string`

Defined in: [packages/server/src/types/client.ts:23](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L23)

***

### externalRef?

> `optional` **externalRef**: `string`

Defined in: [packages/server/src/types/client.ts:25](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L25)

***

### name?

> `optional` **name**: `string`

Defined in: [packages/server/src/types/client.ts:24](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L24)

***

### plan?

> `optional` **plan**: `string`

Defined in: [packages/server/src/types/client.ts:26](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L26)

***

### subscriptions?

> `optional` **subscriptions**: `components`\[`"schemas"`\]\[`"SubscriptionInfo"`\] & `Partial`\<`Pick`\<`components`\[`"schemas"`\]\[`"SubscriptionResponse"`\], `"amount"` \| `"currency"` \| `"endDate"` \| `"cancelledAt"` \| `"cancellationReason"` \| `"paidAt"` \| `"nextBillingDate"`\>\>[]

Defined in: [packages/server/src/types/client.ts:27](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L27)
