[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / PayableOptions

# Interface: PayableOptions

Defined in: [packages/server/src/types/options.ts:49](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L49)

Options for configuring payable protection

## Properties

### agent?

> `optional` **agent**: `string`

Defined in: [packages/server/src/types/options.ts:53](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L53)

Agent identifier (auto-detected from package.json if not provided)

***

### agentRef?

> `optional` **agentRef**: `string`

Defined in: [packages/server/src/types/options.ts:58](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L58)

Agent reference (alias for agent, preferred for consistency with backend API)

***

### getCustomerRef()?

> `optional` **getCustomerRef**: (`context`) => `string` \| `Promise`\<`string`\>

Defined in: [packages/server/src/types/options.ts:73](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L73)

Optional function to extract customer reference from context

#### Parameters

##### context

`any`

#### Returns

`string` \| `Promise`\<`string`\>

***

### plan?

> `optional` **plan**: `string`

Defined in: [packages/server/src/types/options.ts:63](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L63)

Plan identifier (defaults to agent name if not provided)

***

### planRef?

> `optional` **planRef**: `string`

Defined in: [packages/server/src/types/options.ts:68](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L68)

Plan reference (alias for plan, preferred for consistency with backend API)
