# OAuth Server Implementation Plan for OpenAI Custom GPT

This document analyzes options for implementing an OAuth 2.0 server to allow OpenAI Custom GPT Actions to authenticate with your API on behalf of your users.

## 📊 Comparison of Providers

We evaluated five potential approaches for serving as the OAuth 2.0 Identity Provider (IdP) for third-party clients (like OpenAI).

| Feature | Supabase Auth (Beta) | Clerk | Auth0 | Custom Implementation | Firebase Auth |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OAuth 2.0 Provider** | ✅ Yes (Beta) | ✅ Yes (GA) | ✅ Yes (GA) | ✅ Yes (DIY) | ❌ No (Client only) |
| **Setup Difficulty** | Medium (Beta Access) | Easy (Built-in) | Easy (Config heavy) | High (Code heavy) | High (Requires custom impl) |
| **Maintenance** | Low (Managed) | Low (Managed) | Low (Managed) | High (Self-hosted) | Low (Managed) |
| **Control** | Medium | Medium | High | High | Low |
| **Recommendation** | **Strong Candidate** | **Top Alternative** | **Enterprise Choice** | **Viable Fallback** | **Not Recommended** |

### 1. Supabase (Current Choice)
- **Pros**: Already integrated into your project; keeps data in one place.
- **Cons**: Feature is in **Beta**; requires manual application for access.

### 2. Clerk (Modern Alternative)
- **Pros**: Native support for "OAuth 2.0 Applications"; excellent developer experience (DX); specialized for B2C/SaaS.
- **Cons**: Adds a separate service; requires migrating user management.

### 3. Auth0 (Industry Standard)
- **Pros**: The enterprise standard; extremely powerful; can federate with *other* providers (e.g. log in with Supabase via Auth0).
- **Cons**: Configuration can be complex; pricing scales steeply; UI is less modern than Clerk.

### 4. Custom Implementation (Self-Hosted OAuth)
- **Pros**: Works with **ANY** auth provider (Supabase, Firebase, Auth0); zero external dependencies for the OAuth layer; full control.
- **Cons**: You must maintain security-critical code; requires a database to store auth codes.

### 5. Firebase Auth
- **Pros**: Familiar ecosystem for some.
- **Cons**: Not designed to act as an OAuth provider for 3rd parties.

---

## 🛠️ Implementation Plan: Custom OAuth Layer

This approach involves building a lightweight OAuth 2.0 server within your Next.js app to bridge OpenAI and your existing auth provider.

### Architecture

1.  **Authorize Endpoint** (`GET /api/oauth/authorize`):
    - Checks if user is logged in (via Supabase/Firebase cookie).
    - If not, redirects to login.
    - If yes, generates a temporary **Authorization Code** and redirects back to OpenAI.
2.  **Token Endpoint** (`POST /api/oauth/token`):
    - Validates the **Authorization Code**.
    - Returns an **Access Token** (user's session token or custom JWT).
3.  **Storage**:
    - Needs a place to store short-lived Authorization Codes (e.g., `auth_codes` table in Postgres or Redis).

*(Detailed code implementation omitted for brevity, see previous version for code snippets)*

---

## 🚀 Implementation Plan: Clerk

### Phase 1: Setup Clerk
1.  Sign up at [clerk.com](https://clerk.com).
2.  Install SDK: `npm install @clerk/nextjs`.
3.  Configure keys in `.env.local`.

### Phase 2: Configure OAuth for OpenAI
1.  In Clerk Dashboard: **Configure** -> **OAuth Applications**.
2.  Add Application:
    - Name: `OpenAI Custom GPT`
    - Callback URL: `https://chatgpt.com/aip/g-<GPT_ID>/oauth/callback`
    - Scopes: `profile`, `email`
3.  Copy **Client ID**, **Client Secret**, and **Discovery Endpoint**.

### Phase 3: Configure OpenAI GPT
1.  **Auth URL**: `https://<your-clerk-domain>.clerk.accounts.dev/oauth/authorize`
2.  **Token URL**: `https://<your-clerk-domain>.clerk.accounts.dev/oauth/token`

---

## 🔐 Implementation Plan: Auth0

If you need an enterprise-grade solution or want to federate multiple identity sources.

### Phase 1: Setup Auth0
1.  **Create Account**: Sign up at [auth0.com](https://auth0.com).
2.  **Create Application**:
    - Go to **Applications** -> **Applications**.
    - Create new **Regular Web App** (this represents your Next.js app).
    - Configure Next.js SDK (`@auth0/nextjs-auth0`).

### Phase 2: Configure API for OpenAI
1.  **Create API**:
    - Go to **Applications** -> **APIs**. 
    - Create New API (e.g., "OpenAI Actions").
    - Identifier (Audience): `https://api.your-app.com`
2.  **Define Permissions (Scopes)**:
    - Add scopes like `read:tasks`, `write:tasks`.

### Phase 3: Configure Machine-to-Machine (M2M) Application
OpenAI acts as a client connecting to your API.

1.  **Create Application**:
    - Go to **Applications** -> **Applications**.
    - Create new **Machine to Machine** App (or use "Regular Web App" if using User Authorization Flow).
    - **Note**: For Custom GPTs acting *on behalf of a user*, you typically use a **Regular Web App** configuration with Authorization Code Flow.
2.  **Settings**:
    - **Allowed Callback URLs**:
        - `https://chatgpt.com/aip/g-<GPT_ID>/oauth/callback`
        - `https://chat.openai.com/aip/g-<GPT_ID>/oauth/callback`
    - **Grant Types**: Ensure `Authorization Code` is enabled.

### Phase 4: Configure OpenAI GPT
In OpenAI GPT Editor -> **Configure** -> **Authentication**:

1.  **Type**: OAuth
2.  **Client ID**: (From Auth0 App)
3.  **Client Secret**: (From Auth0 App)
4.  **Authorization URL**: `https://<your-tenant>.auth0.com/authorize?audience=https://api.your-app.com`
    - *Note*: You often need to append the `audience` query param manually or in the "Extra Parameters" if supported, or ensure it's the default for the tenant.
5.  **Token URL**: `https://<your-tenant>.auth0.com/oauth/token`
6.  **Scope**: `openid profile email offline_access`

### Phase 5: Verify Tokens in Next.js
Use `withApiAuthRequired` or verify the JWT access token in your API routes using the Auth0 SDK.
