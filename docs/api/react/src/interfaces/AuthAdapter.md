[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / AuthAdapter

# Interface: AuthAdapter

Defined in: [packages/react/src/adapters/auth.ts:15](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/adapters/auth.ts#L15)

Auth adapter interface for client-side authentication

Used by SolvaPayProvider to get auth tokens and user IDs.
Adapters should handle their own error cases and return null when
authentication is not available or fails.

## Properties

### getToken()

> **getToken**: () => `Promise`\<`string` \| `null`\>

Defined in: [packages/react/src/adapters/auth.ts:25](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/adapters/auth.ts#L25)

Get the authentication token

#### Returns

`Promise`\<`string` \| `null`\>

The auth token string if available, null otherwise

#### Remarks

This method should never throw. If authentication fails or is missing,
return null and let the caller decide how to handle unauthenticated requests.

***

### getUserId()

> **getUserId**: () => `Promise`\<`string` \| `null`\>

Defined in: [packages/react/src/adapters/auth.ts:36](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/adapters/auth.ts#L36)

Get the authenticated user ID

#### Returns

`Promise`\<`string` \| `null`\>

The user ID string if authenticated, null otherwise

#### Remarks

This method should never throw. If authentication fails or is missing,
return null and let the caller decide how to handle unauthenticated requests.
