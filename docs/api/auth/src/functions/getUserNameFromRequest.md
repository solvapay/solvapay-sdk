[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [auth/src](../README.md) / getUserNameFromRequest

# Function: getUserNameFromRequest()

> **getUserNameFromRequest**(`request`, `options?`): `Promise`\<`string` \| `null`\>

Defined in: [packages/auth/src/next-utils.ts:157](https://github.com/solvapay/solvapay-sdk/blob/main/packages/auth/src/next-utils.ts#L157)

Extract user name from Supabase JWT token in Authorization header.

Parses and validates a Supabase JWT token from the Authorization header
and extracts the name from user metadata. Checks multiple possible locations:
- `user_metadata.full_name`
- `user_metadata.name`
- `name` claim

Returns null if the token is missing, invalid, or name is not found.

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

User name string or null if not found

## Example

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getUserNameFromRequest } from '@solvapay/auth';

export async function GET(request: NextRequest) {
  const name = await getUserNameFromRequest(request);
  
  return NextResponse.json({ name: name || 'Guest' });
}
```

## See

[getUserEmailFromRequest](getUserEmailFromRequest.md) for extracting user email

## Since

1.0.0
