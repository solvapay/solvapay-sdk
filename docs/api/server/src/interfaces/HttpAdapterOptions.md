[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / HttpAdapterOptions

# Interface: HttpAdapterOptions

Defined in: [packages/server/src/types/options.ts:79](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L79)

HTTP adapter options for Express/Fastify

## Properties

### extractArgs()?

> `optional` **extractArgs**: (`req`) => `any`

Defined in: [packages/server/src/types/options.ts:83](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L83)

Extract arguments from HTTP request

#### Parameters

##### req

`any`

#### Returns

`any`

***

### getCustomerRef()?

> `optional` **getCustomerRef**: (`req`) => `string` \| `Promise`\<`string`\>

Defined in: [packages/server/src/types/options.ts:88](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L88)

Extract customer reference from HTTP request

#### Parameters

##### req

`any`

#### Returns

`string` \| `Promise`\<`string`\>

***

### transformResponse()?

> `optional` **transformResponse**: (`result`, `reply`) => `any`

Defined in: [packages/server/src/types/options.ts:93](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L93)

Transform the response before sending

#### Parameters

##### result

`any`

##### reply

`any`

#### Returns

`any`
