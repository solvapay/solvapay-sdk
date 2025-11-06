[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / getAuthenticatedUser

# Function: getAuthenticatedUser()

> **getAuthenticatedUser**(`request`, `options`): `Promise`\<[`AuthenticatedUser`](../../../server/src/interfaces/AuthenticatedUser.md) \| `NextResponse`\<`unknown`\>\>

Defined in: [packages/next/src/helpers/auth.ts:48](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/auth.ts#L48)

Get authenticated user information from a Next.js request.

This is a Next.js-specific wrapper around `getAuthenticatedUserCore` that
returns NextResponse for errors instead of ErrorResult. Extracts user ID,
email, and name from authenticated requests.

## Parameters

### request

`Request`

Next.js request object (NextRequest or Request)

### options

Configuration options

#### includeEmail?

`boolean`

Whether to extract email from JWT token (default: true)

#### includeName?

`boolean`

Whether to extract name from JWT token (default: true)

## Returns

`Promise`\<[`AuthenticatedUser`](../../../server/src/interfaces/AuthenticatedUser.md) \| `NextResponse`\<`unknown`\>\>

Authenticated user info or NextResponse error

## Example

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const userResult = await getAuthenticatedUser(request);
  
  if (userResult instanceof NextResponse) {
    return userResult; // Error response
  }
  
  const { userId, email, name } = userResult;
  return NextResponse.json({ userId, email, name });
}
```

## See

[getAuthenticatedUserCore](../../../server/src/functions/getAuthenticatedUserCore.md) for the core implementation

## Since

1.0.0
