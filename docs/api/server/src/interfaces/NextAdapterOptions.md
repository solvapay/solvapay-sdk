[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / NextAdapterOptions

# Interface: NextAdapterOptions

Defined in: [packages/server/src/types/options.ts:99](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L99)

Next.js adapter options for App Router

## Properties

### extractArgs()?

> `optional` **extractArgs**: (`request`, `context?`) => `any`

Defined in: [packages/server/src/types/options.ts:103](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L103)

Extract arguments from Web Request

#### Parameters

##### request

`Request`

##### context?

`any`

#### Returns

`any`

***

### getCustomerRef()?

> `optional` **getCustomerRef**: (`request`) => `string` \| `Promise`\<`string`\>

Defined in: [packages/server/src/types/options.ts:108](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L108)

Extract customer reference from Web Request

#### Parameters

##### request

`Request`

#### Returns

`string` \| `Promise`\<`string`\>

***

### transformResponse()?

> `optional` **transformResponse**: (`result`) => `any`

Defined in: [packages/server/src/types/options.ts:113](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L113)

Transform the response before returning

#### Parameters

##### result

`any`

#### Returns

`any`
