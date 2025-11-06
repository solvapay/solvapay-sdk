[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / UsePlansReturn

# Interface: UsePlansReturn

Defined in: [packages/react/src/types/index.ts:243](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L243)

Return type for usePlans hook

## Properties

### error

> **error**: `Error` \| `null`

Defined in: [packages/react/src/types/index.ts:246](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L246)

***

### loading

> **loading**: `boolean`

Defined in: [packages/react/src/types/index.ts:245](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L245)

***

### plans

> **plans**: [`Plan`](Plan.md)[]

Defined in: [packages/react/src/types/index.ts:244](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L244)

***

### refetch()

> **refetch**: () => `Promise`\<`void`\>

Defined in: [packages/react/src/types/index.ts:251](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L251)

#### Returns

`Promise`\<`void`\>

***

### selectedPlan

> **selectedPlan**: [`Plan`](Plan.md) \| `null`

Defined in: [packages/react/src/types/index.ts:248](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L248)

***

### selectedPlanIndex

> **selectedPlanIndex**: `number`

Defined in: [packages/react/src/types/index.ts:247](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L247)

***

### selectPlan()

> **selectPlan**: (`planRef`) => `void`

Defined in: [packages/react/src/types/index.ts:250](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L250)

#### Parameters

##### planRef

`string`

#### Returns

`void`

***

### setSelectedPlanIndex()

> **setSelectedPlanIndex**: (`index`) => `void`

Defined in: [packages/react/src/types/index.ts:249](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L249)

#### Parameters

##### index

`number`

#### Returns

`void`
