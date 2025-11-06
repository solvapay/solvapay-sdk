[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [auth/src](../README.md) / AuthAdapter

# Interface: AuthAdapter

Defined in: [packages/auth/src/adapter.ts:47](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/adapter.ts#L47)

Authentication adapter interface for extracting user IDs from requests.

This interface defines the contract for authentication adapters that can
extract user IDs from various authentication systems (Supabase, custom JWT,
session-based auth, etc.). Adapters should never throw - return null if
authentication fails or is missing.

## Example

```typescript
import type { AuthAdapter } from '@solvapay/auth';

// Custom adapter implementation
const myAdapter: AuthAdapter = {
  async getUserIdFromRequest(req) {
    // Extract user ID from request (JWT, session, etc.)
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return null;
    
    // Validate and extract user ID
    const payload = await verifyToken(token);
    return payload.userId || null;
  }
};
```

## See

 - SupabaseAuthAdapter for Supabase implementation
 - [MockAuthAdapter](../classes/MockAuthAdapter.md) for testing implementation

## Since

1.0.0

## Methods

### getUserIdFromRequest()

> **getUserIdFromRequest**(`req`): `Promise`\<`string` \| `null`\>

Defined in: [packages/auth/src/adapter.ts:63](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/adapter.ts#L63)

Extract the authenticated user ID from a request.

This method should:
- Never throw exceptions (return null on failure)
- Handle missing/invalid authentication gracefully
- Work with both Request objects and objects with headers

#### Parameters

##### req

Request object or object with headers

`Request` | [`RequestLike`](RequestLike.md)

#### Returns

`Promise`\<`string` \| `null`\>

The user ID string if authenticated, null otherwise

#### Remarks

This method should never throw. If authentication fails or is missing,
return null and let the caller decide how to handle unauthenticated requests.
