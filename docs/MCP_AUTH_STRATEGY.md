# MCP & Custom GPT Auth Strategy: Findings & SDK Roadmap

## 1. The Core Challenge: "Client" Identity

The fundamental difference between our standard `checkout-demo` and the `nextjs-openai-custom-gpt-actions` example is **who the client is**.

| Feature | Standard Web App (`checkout-demo`) | MCP / Custom GPT (`nextjs-openai-custom-gpt-actions`) |
| :--- | :--- | :--- |
| **Client** | **User's Browser** | **Third-Party Server** (OpenAI, Claude, etc.) |
| **Auth Flow** | Direct Login (Client SDK) | **OAuth 2.0 Authorization Code Flow** |
| **Role** | Resource Server | **OAuth Provider** & Resource Server |
| **Trust** | Browser holds session | 3rd Party needs explicit delegation (Scopes) |

### 1.1 The Browser Scenario (Easy)
In a standard web app, the browser uses the Auth Provider's SDK (e.g., `@supabase/auth-helpers-nextjs`) to authenticate. The resulting Access Token is sent to your API. Your API just needs to **verify** the token.

**SDK Requirement:** Minimal. Just an adapter to verify tokens (e.g., `SupabaseAuthAdapter`).

### 1.2 The MCP/GPT Scenario (Hard)
AI Agents (OpenAI, Claude, or local MCP clients) cannot "log in" using a UI. They require a strict **OAuth 2.0 Handshake**:

1.  **Authorize URL**: Agent redirects user to `YOUR_APP/oauth/authorize`.
2.  **Consent**: User logs in (if not already) and grants permission.
3.  **Code Issue**: Your app issues a temporary code.
4.  **Token Exchange**: Agent calls `YOUR_APP/oauth/token` to swap code for an Access Token.

**The Problem:**
Most Auth-as-a-Service providers (Supabase, Firebase, NextAuth) **do not** expose these OAuth Provider endpoints for third parties out-of-the-box. They are designed to *be* the IdP for your app, not to let your app act as an IdP for others.

## 2. The "Shim" Architecture

To support MCP/GPT agents, we need to build a "Shim" layer—a lightweight OAuth Server that sits in front of the main Auth Provider.

**Implemented Solution (`examples/nextjs-openai-custom-gpt-actions`):**

This example provides a working implementation of the Shim architecture:

1.  **`GET /api/oauth/authorize`**:
    *   Checks if user has an active Supabase session.
    *   If not authenticated, redirects to login page with return URL.
    *   Generates a temporary `auth_code` (10-minute expiry).
    *   Stores it in the `oauth_codes` database table.
    *   Redirects back to the Agent (OpenAI) with the code.

2.  **`POST /api/oauth/token`**:
    *   Validates client credentials and the `auth_code`.
    *   Deletes the code from database (one-time use).
    *   **Mints a NEW Access Token** (JWT) specifically for the Agent.
    *   Generates and stores a Refresh Token (30-day expiry) in the `oauth_refresh_tokens` table.
    *   Returns OAuth-compliant token response.

## 3. SolvaPay SDK Strategy

To make monetizing MCP servers easy, SolvaPay SDK should abstract this "Shim" layer so developers don't have to re-implement OAuth logic.

### 3.1 Proposed Abstraction Levels

We should offer three levels of support:

#### Level 1: The "Bring Your Own Auth" (✅ Implemented in Example)
The developer manually implements the OAuth endpoints. SolvaPay provides the `McpAdapter` to handle the actual tool execution.
*   **Pros**: Maximum control; well-documented example available.
*   **Cons**: Higher initial setup; developer must understand OAuth.
*   **Status**: Fully implemented in `examples/nextjs-openai-custom-gpt-actions` as a reference implementation.

#### Level 2: The "OAuth Helper" (Recommended Short-term)
SolvaPay provides helper functions to generate standard OAuth responses, but the developer still defines the routes.
*   **Idea**: `createOAuthHandler({ provider: supabaseAdapter })`
*   **Benefit**: Standardizes the confusing parts (grant types, error codes) while letting the developer own the storage (Postgres/Redis).

#### Level 3: The "Managed MCP Auth" (Long-term Goal)
SolvaPay (or a dedicated package) acts as the OAuth Provider.
*   **Idea**: A hosted or drop-in generic OAuth server that wraps *any* provider.
*   **Benefit**: "One-click" setup for GPTs.

### 3.2 SDK Roadmap: `solvapay/auth-server`?

We should consider creating a package (e.g., `@solvapay/oauth-shim`) that provides the route handlers for Next.js/Express:

```typescript
// Conceptual Usage in Next.js App Router
import { createOAuthRoutes } from '@solvapay/oauth-shim';
import { SupabaseAdapter } from '@solvapay/auth/supabase';

export const { GET, POST } = createOAuthRoutes({
  // The "Real" Auth Provider (verifies the user)
  identityProvider: new SupabaseAdapter({ ... }),
  
  // Where to store temp codes/tokens (can be memory, redis, or sql)
  storage: new PostgresStorage({ ... }),
  
  // Config for the AI Agent
  clients: [{
    id: 'openai-gpt',
    secret: process.env.GPT_SECRET,
    redirectUris: ['https://chatgpt.com/...']
  }]
});
```

### 3.3 Handling Different Providers

The Shim needs to be agnostic to the underlying session:

*   **Supabase**: Check `sb-access-token` cookie.
*   **Clerk**: Check Clerk session cookie.
*   **NextAuth**: Check NextAuth session.
*   **Firebase**: Check Firebase token.

**Recommendation:**
The SolvaPay SDK should define a standard `IdentityProvider` interface that simply answers: *"Is there a user currently logged in on this request? If so, give me their ID."* The OAuth Shim then handles the rest (issuing the code/token for the Agent).

## 4. Implementation Status: `nextjs-openai-custom-gpt-actions`

**Status: ✅ COMPLETED AND PRODUCTION-READY**

The custom OAuth bridge has been successfully implemented in the `examples/nextjs-openai-custom-gpt-actions` directory. The implementation follows the "Shim" architecture described above.

### 4.1 Implementation Summary

| Component | File | Status |
| :--- | :--- | :--- |
| **Middleware** | `src/middleware.ts` | ✅ **Implemented**: Handles both Custom Bearer Tokens (for GPT) and Standard Cookies (for Browser). |
| **Authorize Endpoint** | `src/app/api/oauth/authorize/route.ts` | ✅ **Implemented**: Validates Supabase session, generates auth codes, stores in DB. |
| **Token Endpoint** | `src/app/api/oauth/token/route.ts` | ✅ **Implemented**: Exchanges codes for JWT access tokens and refresh tokens. |
| **Storage Layer** | `src/lib/oauth-storage.ts` | ✅ **Implemented**: Uses Supabase DB tables (`oauth_codes`, `oauth_refresh_tokens`). |
| **Database Schema** | `supabase/migrations/002_create_oauth_tables.sql` | ✅ **Implemented**: Tables for auth codes and refresh tokens. |
| **User Info** | `src/app/api/user/me/route.ts` | ✅ **Implemented**: Returns user info from OAuth token. |

### 4.2 Key Features

1.  **Standard OAuth 2.0 Flow**: Full Authorization Code flow with refresh token support.
2.  **Database-Backed Storage**: Auth codes and refresh tokens stored in Supabase PostgreSQL.
3.  **Security**: 
    - One-time use authorization codes (10-minute expiry)
    - JWT-based access tokens (1-hour expiry)
    - Long-lived refresh tokens (30-day expiry)
    - Client secret validation
    - Redirect URI validation

### 4.3 Future Enhancements

While the current implementation is production-ready for Supabase-based projects, future SDK versions could provide:

1.  **Provider Abstraction**: `IdentityProvider` interface to support Clerk, Auth0, NextAuth, etc.
2.  **Storage Adapters**: Pluggable storage (Redis, SQL, Memory) for different deployment scenarios.
3.  **PKCE Support**: Enhanced security for public clients (see Section 5.2).
4.  **Consent Screen**: Optional user consent UI for explicit scope authorization.

## 5. Security Analysis

The current "Shim" architecture is sound but shifts significant security responsibility to the developer.

### 5.1 Key Risks
*   **Token Forgery**: Reliance on `OAUTH_JWKS_SECRET` means if this key leaks, the entire auth system is compromised.
*   **Refresh Token Storage**: Tokens are currently random strings but should ideally be hashed in the database.
*   **Scope Validation**: No explicit user consent screen means scopes are "trusted" rather than "granted".

### 5.2 PKCE (Proof Key for Code Exchange)
*   **Requirement**: PKCE is highly recommended for public clients to prevent code interception.
*   **Tool Call Confirmation**: While PKCE secures the auth flow, **it does not automatically remove the need for tool call confirmations**. OpenAI's "Always Allow" feature is separate and depends on their specific trust/verification model for the GPT Action.
*   **Implementation Difficulty**: Medium. Requires:
    1.  Storing `code_challenge` and `code_challenge_method` in the `auth_codes` table during the Authorize step.
    2.  Validating the `code_verifier` (hashed matches the stored challenge) during the Token Exchange step.
