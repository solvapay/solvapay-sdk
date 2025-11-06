# Custom Authentication Adapters Guide

This guide shows you how to create custom authentication adapters for SolvaPay SDK to integrate with your authentication system.

## Table of Contents

- [Overview](#overview)
- [Server-Side Adapters](#server-side-adapters)
- [Client-Side Adapters](#client-side-adapters)
- [Common Patterns](#common-patterns)
- [Testing Adapters](#testing-adapters)
- [Complete Examples](#complete-examples)

## Overview

SolvaPay SDK uses authentication adapters to extract user IDs from requests. There are two types of adapters:

1. **Server-Side Adapters** (`@solvapay/auth`) - Extract user IDs from HTTP requests in API routes
2. **Client-Side Adapters** (`@solvapay/react`) - Extract user IDs and tokens from client-side auth state

## Server-Side Adapters

Server-side adapters are used with `@solvapay/server` to extract user IDs from HTTP requests in API routes, Express endpoints, and other server-side contexts.

### Interface

```typescript
import type { AuthAdapter } from '@solvapay/auth';

interface AuthAdapter {
  /**
   * Extract the authenticated user ID from a request.
   * Should never throw - return null if authentication fails or is missing.
   */
  getUserIdFromRequest(req: Request | RequestLike): Promise<string | null>;
}
```

### Basic Example: JWT Token Adapter

```typescript
import type { AuthAdapter } from '@solvapay/auth';
import jwt from 'jsonwebtoken';

class JWTAuthAdapter implements AuthAdapter {
  constructor(private secret: string) {}
  
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.get?.('authorization') || 
                        (req.headers as any).authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }
      
      const token = authHeader.replace('Bearer ', '');
      
      // Verify and decode token
      const decoded = jwt.verify(token, this.secret) as { userId: string };
      
      return decoded.userId || null;
    } catch (error) {
      // Never throw - return null on error
      return null;
    }
  }
}

// Usage
const authAdapter = new JWTAuthAdapter(process.env.JWT_SECRET!);
const userId = await authAdapter.getUserIdFromRequest(request);
```

### Example: Session-Based Adapter

```typescript
import type { AuthAdapter } from '@solvapay/auth';
import { getSession } from 'your-session-library';

class SessionAuthAdapter implements AuthAdapter {
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    try {
      // Extract session from request
      const session = await getSession(req);
      
      if (!session || !session.userId) {
        return null;
      }
      
      return session.userId;
    } catch (error) {
      return null;
    }
  }
}
```

### Example: Custom Header Adapter

```typescript
import type { AuthAdapter } from '@solvapay/auth';

class HeaderAuthAdapter implements AuthAdapter {
  constructor(private headerName: string = 'x-user-id') {}
  
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    const userId = req.headers.get?.(this.headerName) || 
                  (req.headers as any)[this.headerName];
    
    return userId || null;
  }
}

// Usage
const authAdapter = new HeaderAuthAdapter('x-customer-id');
```

### Using with SolvaPay Server SDK

```typescript
import { createSolvaPay } from '@solvapay/server';
import type { AuthAdapter } from '@solvapay/auth';

const authAdapter: AuthAdapter = {
  async getUserIdFromRequest(req) {
    // Your custom logic
    return userId || null;
  },
};

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY });
const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' });

// Use with Express
app.post('/api/tasks', payable.http(createTask, {
  getCustomerRef: async (req) => {
    const userId = await authAdapter.getUserIdFromRequest(req);
    if (!userId) throw new Error('Unauthorized');
    return userId;
  },
}));

// Use with Next.js
export const POST = payable.next(createTask, {
  getCustomerRef: async (req) => {
    const userId = await authAdapter.getUserIdFromRequest(req);
    if (!userId) throw new Error('Unauthorized');
    return userId;
  },
});
```

## Client-Side Adapters

Client-side adapters are used with `@solvapay/react` to extract user IDs and tokens from client-side authentication state.

### Interface

```typescript
import type { AuthAdapter } from '@solvapay/react';

interface AuthAdapter {
  /**
   * Get the authentication token
   */
  getToken(): Promise<string | null>;
  
  /**
   * Get the user ID (for cache key)
   */
  getUserId(): Promise<string | null>;
}
```

### Basic Example: LocalStorage Adapter

```typescript
import type { AuthAdapter } from '@solvapay/react';

class LocalStorageAuthAdapter implements AuthAdapter {
  async getToken(): Promise<string | null> {
    return localStorage.getItem('auth-token');
  }
  
  async getUserId(): Promise<string | null> {
    const token = await this.getToken();
    if (!token) return null;
    
    try {
      // Decode JWT token (client-side)
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.userId || null;
    } catch {
      return null;
    }
  }
}

// Usage with SolvaPayProvider
import { SolvaPayProvider } from '@solvapay/react';

function App() {
  const adapter = new LocalStorageAuthAdapter();
  
  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>
      <YourApp />
    </SolvaPayProvider>
  );
}
```

### Example: Context-Based Adapter

```typescript
import type { AuthAdapter } from '@solvapay/react';
import { useContext } from 'react';
import { AuthContext } from './AuthContext';

function createContextAuthAdapter(): AuthAdapter {
  return {
    async getToken() {
      // Access auth context
      const { token } = useContext(AuthContext);
      return token || null;
    },
    
    async getUserId() {
      const { user } = useContext(AuthContext);
      return user?.id || null;
    },
  };
}

// Usage
function App() {
  const adapter = createContextAuthAdapter();
  
  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>
      <YourApp />
    </SolvaPayProvider>
  );
}
```

### Example: Async Storage Adapter (React Native)

```typescript
import type { AuthAdapter } from '@solvapay/react';
import AsyncStorage from '@react-native-async-storage/async-storage';

class AsyncStorageAuthAdapter implements AuthAdapter {
  async getToken(): Promise<string | null> {
    return await AsyncStorage.getItem('auth-token');
  }
  
  async getUserId(): Promise<string | null> {
    const token = await this.getToken();
    if (!token) return null;
    
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.userId || null;
    } catch {
      return null;
    }
  }
}
```

## Common Patterns

### Pattern 1: JWT Token with User ID Extraction

```typescript
// Server-side
class JWTAdapter implements AuthAdapter {
  constructor(private secret: string) {}
  
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    const token = this.extractToken(req);
    if (!token) return null;
    
    try {
      const decoded = jwt.verify(token, this.secret) as { userId: string };
      return decoded.userId;
    } catch {
      return null;
    }
  }
  
  private extractToken(req: Request | RequestLike): string | null {
    const authHeader = req.headers.get?.('authorization') || 
                      (req.headers as any).authorization;
    return authHeader?.replace('Bearer ', '') || null;
  }
}
```

### Pattern 2: Cookie-Based Authentication

```typescript
// Server-side
class CookieAuthAdapter implements AuthAdapter {
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    // Extract from cookies
    const cookies = this.parseCookies(req);
    const sessionId = cookies['session-id'];
    
    if (!sessionId) return null;
    
    // Look up session in database/cache
    const session = await this.getSession(sessionId);
    return session?.userId || null;
  }
  
  private parseCookies(req: Request | RequestLike): Record<string, string> {
    const cookieHeader = req.headers.get?.('cookie') || 
                        (req.headers as any).cookie;
    if (!cookieHeader) return {};
    
    return cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
  }
  
  private async getSession(sessionId: string): Promise<{ userId: string } | null> {
    // Your session lookup logic
    return null;
  }
}
```

### Pattern 3: API Key with User Mapping

```typescript
// Server-side
class APIKeyAuthAdapter implements AuthAdapter {
  constructor(private keyToUserId: Map<string, string>) {}
  
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    const apiKey = req.headers.get?.('x-api-key') || 
                   (req.headers as any)['x-api-key'];
    
    if (!apiKey) return null;
    
    return this.keyToUserId.get(apiKey) || null;
  }
}
```

## Testing Adapters

### Mock Adapter for Testing

```typescript
// Server-side mock
class MockAuthAdapter implements AuthAdapter {
  constructor(private mockUserId: string | null = 'test-user-123') {}
  
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    // Allow override via header
    const headerUserId = req.headers.get?.('x-mock-user-id') || 
                        (req.headers as any)['x-mock-user-id'];
    
    return headerUserId || this.mockUserId;
  }
}

// Client-side mock
class MockClientAuthAdapter implements AuthAdapter {
  constructor(private mockUserId: string | null = 'test-user-123') {}
  
  async getToken(): Promise<string | null> {
    return 'mock-token';
  }
  
  async getUserId(): Promise<string | null> {
    return this.mockUserId;
  }
}
```

### Testing with Adapters

```typescript
import { describe, it, expect } from 'vitest';
import { MockAuthAdapter } from './MockAuthAdapter';

describe('AuthAdapter', () => {
  it('should extract user ID from request', async () => {
    const adapter = new MockAuthAdapter('user-123');
    const request = new Request('http://localhost', {
      headers: { 'x-mock-user-id': 'user-123' },
    });
    
    const userId = await adapter.getUserIdFromRequest(request);
    expect(userId).toBe('user-123');
  });
  
  it('should return null for missing auth', async () => {
    const adapter = new MockAuthAdapter(null);
    const request = new Request('http://localhost');
    
    const userId = await adapter.getUserIdFromRequest(request);
    expect(userId).toBeNull();
  });
});
```

## Complete Examples

### Example 1: Firebase Auth Adapter (Client-Side)

```typescript
import type { AuthAdapter } from '@solvapay/react';
import { getAuth } from 'firebase/auth';

class FirebaseAuthAdapter implements AuthAdapter {
  async getToken(): Promise<string | null> {
    const auth = getAuth();
    const user = auth.currentUser;
    
    if (!user) return null;
    
    return await user.getIdToken();
  }
  
  async getUserId(): Promise<string | null> {
    const auth = getAuth();
    return auth.currentUser?.uid || null;
  }
}

// Usage
function App() {
  const adapter = new FirebaseAuthAdapter();
  
  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>
      <YourApp />
    </SolvaPayProvider>
  );
}
```

### Example 2: Auth0 Adapter (Server-Side)

```typescript
import type { AuthAdapter } from '@solvapay/auth';
import { initAuth0 } from '@auth0/nextjs-auth0';

class Auth0Adapter implements AuthAdapter {
  private auth0: any;
  
  constructor() {
    this.auth0 = initAuth0({
      secret: process.env.AUTH0_SECRET,
      baseURL: process.env.AUTH0_BASE_URL,
      clientID: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
    });
  }
  
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    try {
      const session = await this.auth0.getSession(req);
      return session?.user?.sub || null;
    } catch {
      return null;
    }
  }
}
```

### Example 3: Custom OAuth Adapter

```typescript
import type { AuthAdapter } from '@solvapay/auth';

class OAuthAdapter implements AuthAdapter {
  constructor(
    private tokenEndpoint: string,
    private clientId: string,
    private clientSecret: string
  ) {}
  
  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    const token = this.extractToken(req);
    if (!token) return null;
    
    try {
      // Verify token with OAuth provider
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          token,
        }),
      });
      
      const data = await response.json();
      return data.user_id || null;
    } catch {
      return null;
    }
  }
  
  private extractToken(req: Request | RequestLike): string | null {
    const authHeader = req.headers.get?.('authorization') || 
                      (req.headers as any).authorization;
    return authHeader?.replace('Bearer ', '') || null;
  }
}
```

## Best Practices

1. **Never Throw**: Adapters should never throw exceptions. Return `null` if authentication fails.

2. **Handle Errors Gracefully**: Catch all errors and return `null` instead of throwing.

3. **Cache When Possible**: Cache expensive operations (like token verification) when appropriate.

4. **Type Safety**: Use TypeScript for better type safety and developer experience.

5. **Test Thoroughly**: Write tests for your adapters, including edge cases.

6. **Documentation**: Document your adapter's behavior and requirements.

## Next Steps

- [Express.js Integration Guide](./express.md) - Use adapters with Express
- [Next.js Integration Guide](./nextjs.md) - Use adapters with Next.js
- [React Integration Guide](./react.md) - Use adapters with React
- [Error Handling Strategies](./error-handling.md) - Handle authentication errors
- [API Reference](/api/auth/) - Full API documentation

