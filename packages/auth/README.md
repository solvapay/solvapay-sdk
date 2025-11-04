# @solvapay/auth

Authentication adapters for extracting user IDs from requests. Provides adapters for Supabase and mock/testing scenarios.

## Installation

```bash
pnpm add @solvapay/auth
```

If using SupabaseAuthAdapter, also install `jose`:

```bash
pnpm add jose
```

## Usage

### SupabaseAuthAdapter

Extract user ID from Supabase JWT tokens:

```ts
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

const auth = new SupabaseAuthAdapter({
  jwtSecret: process.env.SUPABASE_JWT_SECRET!
});

// In your API route
export async function POST(request: Request) {
  const userId = await auth.getUserIdFromRequest(request);
  
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Use userId as cache key and externalRef
  // The ensureCustomer method returns the SolvaPay backend customer reference
  const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY! });
  const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId);
  const customer = await solvaPay.getCustomer({ customerRef: ensuredCustomerRef });
  
  return Response.json({ userId, customer });
}
```

### MockAuthAdapter

For testing and examples:

```ts
import { MockAuthAdapter } from '@solvapay/auth/mock';

const auth = new MockAuthAdapter();

// Set header: x-mock-user-id: user_123
// Or set env: MOCK_USER_ID=user_123

const userId = await auth.getUserIdFromRequest(request);
```

### Integration with SolvaPay Server SDK

Use auth adapters with the `getCustomerRef` option:

```ts
import { createSolvaPay } from '@solvapay/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

const auth = new SupabaseAuthAdapter({
  jwtSecret: process.env.SUPABASE_JWT_SECRET!
});

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY! });

// Use with Next.js adapter
export const POST = solvaPay.payable({ agent: 'my-api' }).next(
  async (args) => {
    return { result: 'success' };
  },
  {
    getCustomerRef: async (req) => {
      const userId = await auth.getUserIdFromRequest(req);
      return userId ?? 'anonymous';
    }
  }
);
```

## Next.js Route Utilities

The package also provides helper functions for extracting user information in Next.js API routes:

### getUserIdFromRequest

Extract user ID from request headers (commonly set by middleware):

```ts
import { getUserIdFromRequest } from '@solvapay/auth';

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Use userId...
}
```

### requireUserId

Require user ID or return error response:

```ts
import { requireUserId } from '@solvapay/auth';

export async function GET(request: Request) {
  const userIdOrError = requireUserId(request);
  
  if (userIdOrError instanceof Response) {
    return userIdOrError; // Returns 401 error
  }
  
  // userIdOrError is now a string
  const userId = userIdOrError;
}
```

### getUserEmailFromRequest

Extract email from Supabase JWT token in Authorization header:

```ts
import { getUserEmailFromRequest } from '@solvapay/auth';

export async function GET(request: Request) {
  const email = await getUserEmailFromRequest(request);
  // Returns email string or null
}
```

### getUserNameFromRequest

Extract name from Supabase JWT token in Authorization header:

```ts
import { getUserNameFromRequest } from '@solvapay/auth';

export async function GET(request: Request) {
  const name = await getUserNameFromRequest(request);
  // Returns name string or null
}
```

**Note:** `getUserEmailFromRequest` and `getUserNameFromRequest` require the `SUPABASE_JWT_SECRET` environment variable to be set, or you can pass it as an option:

```ts
const email = await getUserEmailFromRequest(request, {
  jwtSecret: process.env.SUPABASE_JWT_SECRET!
});
```

## API Reference

### AuthAdapter Interface

```ts
interface AuthAdapter {
  getUserIdFromRequest(req: Request | RequestLike): Promise<string | null>;
}
```

### SupabaseAuthAdapter

```ts
class SupabaseAuthAdapter implements AuthAdapter {
  constructor(config: { jwtSecret: string });
  getUserIdFromRequest(req: Request | RequestLike): Promise<string | null>;
}
```

**Configuration:**
- `jwtSecret`: Supabase JWT secret from dashboard (Settings → API → JWT Secret)

**Returns:** User ID from `sub` claim or `null` if missing/invalid

### MockAuthAdapter

```ts
class MockAuthAdapter implements AuthAdapter {
  getUserIdFromRequest(req: Request | RequestLike): Promise<string | null>;
}
```

**Behavior:**
1. Checks `x-mock-user-id` header
2. Falls back to `MOCK_USER_ID` environment variable
3. Returns `null` if neither is found

## Requirements

- **Node.js**: >=18.17
- **jose**: >=5.0.0 (peer dependency, required only for SupabaseAuthAdapter)

## Edge Runtime Support

Both adapters and Next.js utilities work in Edge runtimes (Vercel Edge Functions, Cloudflare Workers, etc.). SupabaseAuthAdapter and JWT utilities use dynamic imports for `jose` to ensure Edge compatibility.

## Next.js Integration

These utilities work seamlessly with Next.js middleware. Typically, you'll set the `x-user-id` header in your middleware after authentication:

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Extract user ID from your auth system (Supabase, Auth0, etc.)
  const userId = await getUserIdFromAuth(request);
  
  // Clone the request and add user ID header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', userId);
  
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
```

Then in your API routes, use the utilities:

```ts
import { requireUserId } from '@solvapay/auth';

export async function GET(request: Request) {
  const userId = requireUserId(request);
  // userId is guaranteed to exist or an error response is returned
}
```

