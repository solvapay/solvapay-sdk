[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / PaywallToolResult

# Interface: PaywallToolResult

Defined in: [packages/server/src/types/paywall.ts:36](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/paywall.ts#L36)

MCP tool result with optional paywall information

## Properties

### content?

> `optional` **content**: `object`[]

Defined in: [packages/server/src/types/paywall.ts:37](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/paywall.ts#L37)

#### data?

> `optional` **data**: `string`

#### mimeType?

> `optional` **mimeType**: `string`

#### text?

> `optional` **text**: `string`

#### type

> **type**: `"text"` \| `"image"` \| `"resource"`

***

### isError?

> `optional` **isError**: `boolean`

Defined in: [packages/server/src/types/paywall.ts:38](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/paywall.ts#L38)

***

### structuredContent?

> `optional` **structuredContent**: [`PaywallStructuredContent`](PaywallStructuredContent.md)

Defined in: [packages/server/src/types/paywall.ts:39](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/paywall.ts#L39)
