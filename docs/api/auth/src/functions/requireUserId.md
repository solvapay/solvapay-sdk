[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [auth/src](../README.md) / requireUserId

# Function: requireUserId()

> **requireUserId**(`request`, `options?`): `string` \| `Response`

Defined in: [packages/auth/src/next-utils.ts:235](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/next-utils.ts#L235)

Require user ID from request headers or return an error response.

This is a convenience function that combines `getUserIdFromRequest()` with
error handling. If the user ID is not found, it returns a Response object
with a 401 status that can be directly returned from Next.js route handlers.

Returns a standard Response object that works with Next.js (NextResponse
extends Response, so this is fully compatible).

## Parameters

### request

`Request`

Request object (works with NextRequest from next/server)

### options?

Configuration options

#### errorDetails?

`string`

Custom error details (default: 'User ID not found. Ensure middleware is configured.')

#### errorMessage?

`string`

Custom error message (default: 'Unauthorized')

#### headerName?

`string`

Custom header name (default: 'x-user-id')

## Returns

`string` \| `Response`

Either the user ID string or a Response error object with 401 status

## Example

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@solvapay/auth';

export async function GET(request: NextRequest) {
  const userIdOrError = requireUserId(request);
  
  if (userIdOrError instanceof Response) {
    return userIdOrError; // Returns 401 error
  }
  
  // userIdOrError is now a string
  const userId = userIdOrError;
  // Use userId...
}
```

## See

[getUserIdFromRequest](getUserIdFromRequest.md) for a version that returns null instead of error

## Since

1.0.0
