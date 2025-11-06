[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / PaymentFormProps

# Interface: PaymentFormProps

Defined in: [packages/react/src/types/index.ts:321](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L321)

Payment form props - simplified and minimal

## Properties

### agentRef?

> `optional` **agentRef**: `string`

Defined in: [packages/react/src/types/index.ts:330](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L330)

Agent reference. Required for processing payment after confirmation.

***

### buttonClassName?

> `optional` **buttonClassName**: `string`

Defined in: [packages/react/src/types/index.ts:354](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L354)

Optional className for the submit button

***

### className?

> `optional` **className**: `string`

Defined in: [packages/react/src/types/index.ts:350](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L350)

Optional className for the form container

***

### onError()?

> `optional` **onError**: (`error`) => `void`

Defined in: [packages/react/src/types/index.ts:338](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L338)

Callback when payment fails

#### Parameters

##### error

`Error`

#### Returns

`void`

***

### onSuccess()?

> `optional` **onSuccess**: (`paymentIntent`) => `void`

Defined in: [packages/react/src/types/index.ts:334](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L334)

Callback when payment succeeds

#### Parameters

##### paymentIntent

`PaymentIntent`

#### Returns

`void`

***

### planRef

> **planRef**: `string`

Defined in: [packages/react/src/types/index.ts:326](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L326)

Plan reference to checkout. PaymentForm handles the entire checkout flow internally
including Stripe initialization and payment intent creation.

***

### returnUrl?

> `optional` **returnUrl**: `string`

Defined in: [packages/react/src/types/index.ts:342](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L342)

Return URL after payment completion. Defaults to current page URL if not provided.

***

### submitButtonText?

> `optional` **submitButtonText**: `string`

Defined in: [packages/react/src/types/index.ts:346](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L346)

Text for the submit button. Defaults to "Pay Now"
