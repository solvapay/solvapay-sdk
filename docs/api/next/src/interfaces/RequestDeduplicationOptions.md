[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / RequestDeduplicationOptions

# Interface: RequestDeduplicationOptions

Defined in: [packages/next/src/index.ts:21](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L21)

Request deduplication and caching options

## Properties

### cacheErrors?

> `optional` **cacheErrors**: `boolean`

Defined in: [packages/next/src/index.ts:38](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L38)

Whether to cache error results (default: true)
When false, only successful results are cached

***

### cacheTTL?

> `optional` **cacheTTL**: `number`

Defined in: [packages/next/src/index.ts:26](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L26)

Time-to-live for cached results in milliseconds (default: 2000)
Set to 0 to disable caching (only deduplicate concurrent requests)

***

### maxCacheSize?

> `optional` **maxCacheSize**: `number`

Defined in: [packages/next/src/index.ts:32](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L32)

Maximum cache size before cleanup (default: 1000)
When exceeded, oldest entries are removed
