[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / McpAdapterOptions

# Interface: McpAdapterOptions

Defined in: [packages/server/src/types/options.ts:119](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L119)

MCP adapter options for MCP servers

## Properties

### getCustomerRef()?

> `optional` **getCustomerRef**: (`args`) => `string` \| `Promise`\<`string`\>

Defined in: [packages/server/src/types/options.ts:123](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L123)

Extract customer reference from MCP args

#### Parameters

##### args

`any`

#### Returns

`string` \| `Promise`\<`string`\>

***

### transformResponse()?

> `optional` **transformResponse**: (`result`) => `any`

Defined in: [packages/server/src/types/options.ts:128](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L128)

Transform the response before wrapping in MCP format

#### Parameters

##### result

`any`

#### Returns

`any`
