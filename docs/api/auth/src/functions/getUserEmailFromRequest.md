[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [auth/src](../README.md) / getUserEmailFromRequest

# Function: getUserEmailFromRequest()

> **getUserEmailFromRequest**(`request`, `options?`): `Promise`\<`string` \| `null`\>

Defined in: [packages/auth/src/next-utils.ts:87](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/next-utils.ts#L87)

Extract user email from Supabase JWT token in Authorization header.

Parses and validates a Supabase JWT token from the Authorization header
and extracts the email claim. Returns null if the token is missing, invalid,
or expired.

Uses dynamic imports for Edge runtime compatibility.

## Parameters

### request

`Request`

Request object (works with NextRequest from next/server)

### options?

Configuration options

#### jwtSecret?

`string`

Supabase JWT secret (defaults to SUPABASE_JWT_SECRET env var)

## Returns

`Promise`\<`string` \| `null`\>

User email string or null if not found

## Example

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getUserEmailFromRequest } from '@solvapay/auth';

export async function GET(request: NextRequest) {
  const email = await getUserEmailFromRequest(request);
  
  if (!email) {
    return NextResponse.json({ error: 'Email not found' }, { status: 401 });
  }
  
  return NextResponse.json({ email });
}
```

## See

[getUserNameFromRequest](getUserNameFromRequest.md) for extracting user name

## Since

1.0.0
