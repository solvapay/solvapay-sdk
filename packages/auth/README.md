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
  
  // Use userId as customerRef for SolvaPay
  const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY! });
  const customer = await solvaPay.getCustomer({ customerRef: userId });
  
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

Both adapters work in Edge runtimes (Vercel Edge Functions, Cloudflare Workers, etc.). SupabaseAuthAdapter uses dynamic imports for `jose` to ensure Edge compatibility.

