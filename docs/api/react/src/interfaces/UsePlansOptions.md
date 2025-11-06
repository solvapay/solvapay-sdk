[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / UsePlansOptions

# Interface: UsePlansOptions

Defined in: [packages/react/src/types/index.ts:217](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L217)

Options for usePlans hook

## Properties

### agentRef?

> `optional` **agentRef**: `string`

Defined in: [packages/react/src/types/index.ts:225](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L225)

Agent reference to fetch plans for

***

### autoSelectFirstPaid?

> `optional` **autoSelectFirstPaid**: `boolean`

Defined in: [packages/react/src/types/index.ts:237](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L237)

Auto-select first paid plan on load

***

### fetcher()

> **fetcher**: (`agentRef`) => `Promise`\<[`Plan`](Plan.md)[]\>

Defined in: [packages/react/src/types/index.ts:221](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L221)

Fetcher function to retrieve plans

#### Parameters

##### agentRef

`string`

#### Returns

`Promise`\<[`Plan`](Plan.md)[]\>

***

### filter()?

> `optional` **filter**: (`plan`) => `boolean`

Defined in: [packages/react/src/types/index.ts:229](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L229)

Optional filter function to filter plans

#### Parameters

##### plan

[`Plan`](Plan.md)

#### Returns

`boolean`

***

### sortBy()?

> `optional` **sortBy**: (`a`, `b`) => `number`

Defined in: [packages/react/src/types/index.ts:233](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L233)

Optional sort function to sort plans

#### Parameters

##### a

[`Plan`](Plan.md)

##### b

[`Plan`](Plan.md)

#### Returns

`number`
