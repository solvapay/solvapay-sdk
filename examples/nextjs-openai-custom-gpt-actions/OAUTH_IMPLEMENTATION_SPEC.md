# OAuth 2.0 Implementation Specification for OpenAI Custom GPT Actions

## 1. Overview
This document specifies the OAuth 2.0 flow implemented for the OpenAI Custom GPT Actions integration. The goal is to allow OpenAI to authenticate users securely against our system using the Authorization Code flow.

## 2. Architecture & Flow

### High-Level Sequence
1. **OpenAI** initiates request to `/api/oauth/authorize`.
2. **Server** validates params and checks for active session.
3. **If not authenticated**:
   - Server redirects to `/login` with `redirect_to` and `force_login=true`.
   - User signs in.
   - Frontend redirects user back to `/api/oauth/authorize` with `confirmed=true`.
4. **Server** generates Authorization Code (stored in DB) and redirects to OpenAI's `redirect_uri` with the `code`.
5. **OpenAI** exchanges `code` for `access_token` via `/api/oauth/token`.

## 3. Frontend Specifications

### 3.1. Login Page (`/login`)
**Requirements:**
- Must handle `redirect_to` query parameter.
- Must handle `force_login=true` parameter (triggering a sign-out if a session exists but the user wants to switch accounts).
- Must support standard email/password and social login (Google).

**Security Requirement:**
- **Strict Redirect Validation:** The `redirect_to` parameter must be validated before redirection. It should only allow relative paths (starting with `/`) or absolute URLs matching the application's own origin.

### 3.2. Authentication Component (`Auth.tsx`)
**Logic Flow:**
1. **Initialization:**
   - Read `force_login` param. If true, sign out the current user immediately.
   - Read `redirect_to` param.
2. **On Submit (Sign In / Sign Up):**
   - Perform Supabase Auth (signIn/signUp).
   - On success:
     - **Sync Customer:** Call `/api/sync-customer` to ensure backend records exist.
     - **Redirect:**
       - If `redirect_to` is present and valid (relative path), `window.location.href = redirect_to`.
       - Else, `router.push('/')`.

## 4. Backend Specifications

### 4.1. Authorization Endpoint (`/api/oauth/authorize`)
**Method:** `GET`

**Parameters:**
- `client_id` (Required): Must match env `OAUTH_CLIENT_ID`.
- `redirect_uri` (Required): Must match allowed domains (e.g., `chat.openai.com`, `chatgpt.com`).
- `response_type` (Required): Must be `code`.
- `state` (Optional): Opaque value to prevent CSRF.
- `scope` (Optional): e.g., `openid email profile`.

**Logic:**
1. **Validation:** Check all params. return 400/401 on failure.
2. **Session Check:**
   - Check `confirmed` param.
   - If `false/missing` -> Redirect to `/login?force_login=true&redirect_to=...`.
   - If `true` -> Verify Supabase session cookies.
3. **Code Generation:**
   - Generate secure random 32-byte hex string.
   - Store in `oauth_codes` table (expires in 10m).
4. **Redirect:**
   - Redirect to `redirect_uri?code=CODE&state=STATE`.

### 4.2. Token Endpoint (`/api/oauth/token`)
**Method:** `POST`

**Parameters:**
- `grant_type`: `authorization_code` or `refresh_token`.
- `code` (for auth code flow).
- `refresh_token` (for refresh flow).
- `client_id` & `client_secret`.
- `redirect_uri`.

**Logic:**
1. **Validate Client:** Check ID and Secret.
2. **Grant: Authorization Code:**
   - Retrieve code from DB.
   - Verify expiry and `redirect_uri`.
   - **Consume Code:** Delete from DB (One-time use).
   - Generate `access_token` (JWT) and `refresh_token` (opaque).
   - Store `refresh_token` in DB.
3. **Grant: Refresh Token:**
   - Validate and rotate refresh token.
4. **Response:** JSON with `access_token`, `token_type: "Bearer"`, `expires_in`, `refresh_token`.

## 5. Data Model (Supabase)

### Table: `oauth_codes`
- `code`: text (PK)
- `user_id`: uuid
- `client_id`: text
- `redirect_uri`: text
- `expires_at`: timestamptz

### Table: `oauth_refresh_tokens`
- `token`: text (PK)
- `user_id`: uuid
- `client_id`: text
- `expires_at`: timestamptz

## 6. Security Checklist & Best Practices
- [ ] **Redirect Validation:** Frontend must validate `redirect_to` to prevent Open Redirect vulnerabilities.
- [ ] **State Parameter:** Always pass `state` through to prevent OAuth CSRF.
- [ ] **One-Time Use Codes:** Auth codes must be deleted immediately after use.
- [ ] **Short Expiration:** Auth codes should expire quickly (e.g., 10 mins).
- [ ] **Scopes:** Validate scopes strictly.
- [ ] **HTTPS:** All endpoints must be served over HTTPS.
- [ ] **PKCE (Recommended):** Add support for `code_challenge` and `code_verifier` (S256) for enhanced security.

## 7. Step-by-Step Implementation Guide

1.  **Database Setup:** Create the `oauth_codes` and `oauth_refresh_tokens` tables in Supabase.
2.  **Environment Variables:** Configure `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and allowed redirect domains.
3.  **Frontend Auth Component:** Update `Auth.tsx` to handle `redirect_to` with strict validation.
4.  **Backend Authorize Route:** Implement logic to pause flow, redirect to login, and resume upon `confirmed=true`.
5.  **Backend Token Route:** Implement code exchange and JWT generation.
6.  **Testing:**
    - Test happy path (Login -> Consent -> Redirect).
    - Test session expiry.
    - Test invalid client IDs/Secrets.
    - Test open redirect attacks on `/login`.

