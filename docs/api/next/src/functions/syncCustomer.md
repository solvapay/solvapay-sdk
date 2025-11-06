[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / syncCustomer

# Function: syncCustomer()

> **syncCustomer**(`request`, `options`): `Promise`\<`string` \| `NextResponse`\<`unknown`\>\>

Defined in: [packages/next/src/helpers/customer.ts:22](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/customer.ts#L22)

Sync customer - Next.js wrapper

## Parameters

### request

`Request`

Next.js request object

### options

Configuration options

#### includeEmail?

`boolean`

#### includeName?

`boolean`

#### solvaPay?

[`SolvaPay`](../../../server/src/interfaces/SolvaPay.md)

## Returns

`Promise`\<`string` \| `NextResponse`\<`unknown`\>\>

Customer reference or NextResponse error
