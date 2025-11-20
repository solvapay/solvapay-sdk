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

To support MCP/GPT agents, we currently have to build a "Shim" layer—a lightweight OAuth Server that sits in front of the main Auth Provider.

**Current Implementation (`examples/nextjs-openai-custom-gpt-actions`):**

1.  **`GET /api/oauth/authorize`**:
    *   Checks if user has a session with the underlying provider (Supabase).
    *   Generates a temporary `auth_code`.
    *   Stores it in a custom DB table (`oauth_codes`).
    *   Redirects back to the Agent.

2.  **`POST /api/oauth/token`**:
    *   Validates the `auth_code`.
    *   **Mints a NEW Access Token** (JWT) specifically for the Agent.
    *   (Optional) Issues a Refresh Token.

## 3. SolvaPay SDK Strategy

To make monetizing MCP servers easy, SolvaPay SDK should abstract this "Shim" layer so developers don't have to re-implement OAuth logic.

### 3.1 Proposed Abstraction Levels

We should offer three levels of support:

#### Level 1: The "Bring Your Own Auth" (Current)
The developer manually implements the OAuth endpoints. SolvaPay just provides the `McpAdapter` to handle the actual tool execution.
*   **Pros**: Maximum control.
*   **Cons**: High friction; developer must understand OAuth deeply.

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

## 4. Verification of Current Implementation

I have reviewed the implementation in `examples/nextjs-openai-custom-gpt-actions` and confirmed it aligns with the "Shim" architecture described above.

### 4.1 Component Mapping

| Component | File | Implementation Status |
| :--- | :--- | :--- |
| **Middleware** | `src/middleware.ts` | **Hybrid**: Handles both Custom Bearer Tokens (for GPT) and Standard Cookies (for Browser). Correctly decouples auth logic. |
| **Authorize Endpoint** | `src/app/api/oauth/authorize/route.ts` | **Coupled**: Directly accesses `sb-access-token` cookie. Needs abstraction for other providers. |
| **Token Endpoint** | `src/app/api/oauth/token/route.ts` | **Decoupled**: Uses standard JWT signing with `OAUTH_JWKS_SECRET`. |
| **Storage Layer** | `src/lib/oauth-storage.ts` | **Coupled**: Uses Supabase DB (`oauth_codes` table). Needs abstraction (e.g. Redis/SQL adapters). |
| **User Info** | `src/app/api/me/route.ts` | **Decoupled**: Uses standard OAuth token for user identification. |

> **Note:** The `/api/gpt-auth/*` routes mentioned in earlier versions have been deprecated and removed. The current implementation uses the standard OAuth flow with `/api/oauth/authorize` and `/api/oauth/token` endpoints.

### 4.2 Identified Issues / Action Items

1.  **Tight Coupling**: The current example is tightly coupled to Supabase for storage and initial session verification. This confirms the need for the `IdentityProvider` and `StorageAdapter` interfaces proposed in Section 3.2.
2.  **Security Model**: The middleware correctly prioritizes the Bearer token verification, ensuring that the custom JWTs minted by our Shim are respected even when Supabase sessions aren't present.

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
