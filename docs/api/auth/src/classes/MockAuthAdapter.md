[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [auth/src](../README.md) / MockAuthAdapter

# Class: MockAuthAdapter

Defined in: [packages/auth/src/mock.ts:29](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/mock.ts#L29)

Mock authentication adapter

Extracts user ID from `x-mock-user-id` header or `MOCK_USER_ID` environment variable.
Useful for testing, examples, and development where real authentication isn't needed.

## Example

```ts
import { MockAuthAdapter } from '@solvapay/auth/mock';

const auth = new MockAuthAdapter();

// In tests or examples:
// Set header: x-mock-user-id: user_123
// Or set env: MOCK_USER_ID=user_123

const userId = await auth.getUserIdFromRequest(request);
```

## Implements

- [`AuthAdapter`](../interfaces/AuthAdapter.md)

## Constructors

### Constructor

> **new MockAuthAdapter**(): `MockAuthAdapter`

#### Returns

`MockAuthAdapter`

## Methods

### getUserIdFromRequest()

> **getUserIdFromRequest**(`req`): `Promise`\<`string` \| `null`\>

Defined in: [packages/auth/src/mock.ts:30](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/mock.ts#L30)

Extract the authenticated user ID from a request.

This method should:
- Never throw exceptions (return null on failure)
- Handle missing/invalid authentication gracefully
- Work with both Request objects and objects with headers

#### Parameters

##### req

Request object or object with headers

`Request` | [`RequestLike`](../interfaces/RequestLike.md)

#### Returns

`Promise`\<`string` \| `null`\>

The user ID string if authenticated, null otherwise

#### Remarks

This method should never throw. If authentication fails or is missing,
return null and let the caller decide how to handle unauthenticated requests.

#### Implementation of

[`AuthAdapter`](../interfaces/AuthAdapter.md).[`getUserIdFromRequest`](../interfaces/AuthAdapter.md#getuseridfromrequest)
