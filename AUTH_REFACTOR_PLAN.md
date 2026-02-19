# SolvaPay OAuth Refactor Plan

This document outlines the plan to refactor the `examples/nextjs-openai-custom-gpt-actions` project to use the SolvaPay Hosted OAuth Server and the necessary updates to the SolvaPay SDK.

## 1. Overview

The goal is to replace the custom-built OAuth implementation (where the example app acts as the OAuth server) and the local Supabase Auth flow with SolvaPay's Hosted OAuth solution.

**Current Flow:**
- User logs in via Supabase Auth (local pages).
- OpenAI Custom GPT performs OAuth dance with the Example App.
- Example App issues tokens to OpenAI.

**New Flow:**
- **User Login:** User is redirected to SolvaPay Hosted Login. SolvaPay handles authentication and redirects back with a code.
- **OpenAI OAuth:** OpenAI Custom GPT is configured to use SolvaPay's Hosted OAuth endpoints directly. OpenAI gets a SolvaPay Access Token.
- **API Protection:** OpenAI calls Example App APIs with the SolvaPay Access Token. Example App validates this token using the SolvaPay SDK.

## 2. SolvaPay SDK Requirements

To support this flow, the SolvaPay SDK (`packages/auth` and `packages/server`) needs the following additions:

### 2.1. `SolvapayAuthAdapter`
A new auth adapter in `@solvapay/auth` that implements `AuthAdapter`.
- **Function:** `getUserIdFromRequest(req)`
- **Logic:**
  - Extracts `Authorization: Bearer <token>`.
  - Verifies the JWT signature using SolvaPay's JWKS (or shared secret if applicable, but JWKS is standard).
  - Validates claims (`iss`, `aud`, `exp`).
  - Returns the `sub` (User ID).

### 2.2. OAuth Client Helpers
New helpers to manage the client-side OAuth flow (Authorization Code Flow).
- **`createAuthClient(config)`**:
  - `clientId`: string
  - `clientSecret`: string (optional, for backend code exchange)
  - `redirectUri`: string
  - `authUrl`: string (SolvaPay Auth URL)
  - `tokenUrl`: string (SolvaPay Token URL)
- **Methods:**
  - `getAuthorizationUrl({ scope, state })`: Generates the redirect URL for the "Sign In" button.
  - `exchangeCodeForToken(code)`: Exchanges the authorization code for `access_token` and `refresh_token`.
  - `getUserInfo(accessToken)`: Fetches user profile (email, name, id) from SolvaPay.
  - `revokeToken(token)`: Handles sign-out.

## 3. Example Project Refactoring

### 3.1. Cleanup
- **Remove** local auth pages:
  - `src/app/login/`
  - `src/app/signup/`
- **Remove** OAuth Server endpoints (OpenAI now talks to SolvaPay):
  - `src/app/api/oauth/authorize/`
  - `src/app/api/oauth/token/`
  - `src/lib/oauth-storage.ts` (and related DB tables if no longer needed).

### 3.2. Authentication Flow (Frontend)
- **Sign In:**
  - Update `src/components/Auth.tsx` or create a simple `LoginButton`.
  - Action: Redirect to `authClient.getAuthorizationUrl()`.
- **Callback (`src/app/auth/callback/page.tsx`):**
  - Extract `code` from URL.
  - Call `authClient.exchangeCodeForToken(code)`.
  - Fetch user details via `authClient.getUserInfo()`.
  - **Sync:** Upsert user details into local Supabase DB (to keep `users` table in sync for other app logic).
  - **Session:** Store the `access_token` (or a session cookie) for the client.
  - Redirect to Dashboard (`/`).
- **Sign Out (`src/components/SignOutButton.tsx`):**
  - Call `authClient.revokeToken()`.
  - Clear local session/cookies.
  - Redirect to `/` or SolvaPay logout endpoint.

### 3.3. API Protection (Backend)
- Update `src/app/api/*` routes.
- Replace Supabase token validation with `SolvapayAuthAdapter`.
- Ensure the API accepts the `Authorization` header containing the SolvaPay Access Token (sent by OpenAI).

### 3.4. Landing Page (`src/app/page.tsx`)
- Check for active session (cookie/token).
- If logged in: Show "Welcome, [Name]" and "Sign Out" button.
- If logged out: Show "Sign In" button.

## 4. Configuration Changes

- **`.env.local`**:
  - Remove custom OAuth server keys (`OAUTH_JWKS_SECRET`, etc.).
  - Add SolvaPay OAuth Client keys:
    - `SOLVAPAY_CLIENT_ID`
    - `SOLVAPAY_CLIENT_SECRET`
    - `SOLVAPAY_AUTH_URL`
    - `SOLVAPAY_TOKEN_URL`

## 5. Migration Steps

1.  **SDK Implementation**: Add `SolvapayAuthAdapter` and OAuth helpers to `@solvapay/auth`.
2.  **Env Setup**: Configure `.env` with new SolvaPay credentials.
3.  **Route Updates**: Remove old OAuth routes, implement new Callback route.
4.  **Component Updates**: Replace Login/Signup forms with Hosted Auth redirect.
5.  **Testing**:
    - Test User Login (Redirection -> SolvaPay -> App).
    - Test OpenAI Connection (OpenAI -> SolvaPay -> OpenAI -> App API).

