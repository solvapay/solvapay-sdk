[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / CheckSubscriptionOptions

# Interface: CheckSubscriptionOptions

Defined in: [packages/next/src/index.ts:61](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L61)

Options for checking subscriptions

## Properties

### deduplication?

> `optional` **deduplication**: [`RequestDeduplicationOptions`](RequestDeduplicationOptions.md)

Defined in: [packages/next/src/index.ts:66](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L66)

Request deduplication options
Default: `{ cacheTTL: 2000, maxCacheSize: 1000, cacheErrors: true }`

***

### includeEmail?

> `optional` **includeEmail**: `boolean`

Defined in: [packages/next/src/index.ts:78](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L78)

Whether to include user email in customer data
Default: true

***

### includeName?

> `optional` **includeName**: `boolean`

Defined in: [packages/next/src/index.ts:84](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L84)

Whether to include user name in customer data
Default: true

***

### solvaPay?

> `optional` **solvaPay**: [`SolvaPay`](../../../server/src/interfaces/SolvaPay.md)

Defined in: [packages/next/src/index.ts:72](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L72)

Custom SolvaPay instance (optional)
If not provided, a new instance will be created
