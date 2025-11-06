[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / PlanSelectorProps

# Interface: PlanSelectorProps

Defined in: [packages/react/src/types/index.ts:257](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L257)

Props for headless PlanSelector component

## Properties

### agentRef?

> `optional` **agentRef**: `string`

Defined in: [packages/react/src/types/index.ts:261](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L261)

Agent reference to fetch plans for

***

### autoSelectFirstPaid?

> `optional` **autoSelectFirstPaid**: `boolean`

Defined in: [packages/react/src/types/index.ts:277](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L277)

Auto-select first paid plan on load

***

### children()

> **children**: (`props`) => `ReactNode`

Defined in: [packages/react/src/types/index.ts:281](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L281)

Render prop function

#### Parameters

##### props

[`UsePlansReturn`](UsePlansReturn.md) & `object`

#### Returns

`ReactNode`

***

### fetcher()

> **fetcher**: (`agentRef`) => `Promise`\<[`Plan`](Plan.md)[]\>

Defined in: [packages/react/src/types/index.ts:265](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L265)

Fetcher function to retrieve plans

#### Parameters

##### agentRef

`string`

#### Returns

`Promise`\<[`Plan`](Plan.md)[]\>

***

### filter()?

> `optional` **filter**: (`plan`) => `boolean`

Defined in: [packages/react/src/types/index.ts:269](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L269)

Optional filter function

#### Parameters

##### plan

[`Plan`](Plan.md)

#### Returns

`boolean`

***

### sortBy()?

> `optional` **sortBy**: (`a`, `b`) => `number`

Defined in: [packages/react/src/types/index.ts:273](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L273)

Optional sort function

#### Parameters

##### a

[`Plan`](Plan.md)

##### b

[`Plan`](Plan.md)

#### Returns

`number`
