[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [auth/src](../README.md) / getUserIdFromRequest

# Function: getUserIdFromRequest()

> **getUserIdFromRequest**(`request`, `options?`): `string` \| `null`

Defined in: [packages/auth/src/next-utils.ts:44](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/next-utils.ts#L44)

Extract user ID from request headers.

Checks for the 'x-user-id' header which is commonly set by authentication
middleware after successful authentication. This header is typically set
by Next.js middleware that validates JWT tokens or session cookies.

## Parameters

### request

`Request`

Request object (works with NextRequest from next/server)

### options?

Configuration options

#### headerName?

`string`

Custom header name (default: 'x-user-id')

## Returns

`string` \| `null`

User ID string or null if not found

## Example

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@solvapay/auth';

export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Use userId...
  return NextResponse.json({ userId });
}
```

## See

[requireUserId](requireUserId.md) for a version that returns an error response

## Since

1.0.0
