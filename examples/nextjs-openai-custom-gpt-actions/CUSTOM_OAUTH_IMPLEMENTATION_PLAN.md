# Custom OAuth Bridge Implementation Plan

This document outlines the plan to implement a self-hosted "OAuth Bridge" within the Next.js application. This allows OpenAI Custom GPT Actions to authenticate with your API using standard OAuth 2.0, while your users continue to use Supabase Auth (Google, Email, etc.) for login.

## 🏗️ Architecture

The bridge consists of three main components:

1.  **Database Layer** (Supabase Postgres):
    -   `oauth_codes`: Stores short-lived authorization codes (valid for ~10 mins).
    -   `oauth_refresh_tokens`: Stores long-lived refresh tokens.
2.  **OAuth Endpoints**:
    -   `GET /api/oauth/authorize`: Handles the OAuth handshake and user consent (via Supabase session).
    -   `POST /api/oauth/token`: Exchanges codes for access tokens.
3.  **Middleware**:
    -   Validates the custom Access Tokens issued by our bridge to protect API routes.

## 📝 Step-by-Step Plan

### Phase 1: Database Schema

We need to create two tables in Supabase. We will add this to the `scripts/init-db.ts` or creating a new SQL migration file.

```sql
-- Table for temporary authorization codes
create table if not exists oauth_codes (
  code text primary key,
  user_id uuid not null,
  client_id text not null,
  redirect_uri text not null,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Table for long-lived refresh tokens
create table if not exists oauth_refresh_tokens (
  token text primary key,
  user_id uuid not null,
  client_id text not null,
  scope text,
  expires_at timestamptz not null,
  issued_at timestamptz default now(),
  last_used_at timestamptz
);

-- Enable RLS but keep it simple for service role access
alter table oauth_codes enable row level security;
alter table oauth_refresh_tokens enable row level security;
```

### Phase 2: Restore & Update OAuth Routes

We will restore the files from the `dev` branch but modify them to use the `oauth_codes` table instead of stateless JWTs for the authorization code.

1.  **`src/app/api/oauth/authorize/route.ts`**:
    -   **Step 1**: Check if user has a Supabase session (cookie).
    -   **Step 2 (No Session)**: Redirect to `/login` with `redirect_to` param set to current URL.
    -   **Step 3 (Has Session)**:
        -   Generate a random 32-char code.
        -   Insert into `oauth_codes` table.
        -   Redirect to OpenAI's `redirect_uri` with `code` and `state`.

2.  **`src/app/api/oauth/token/route.ts`**:
    -   **Step 1**: Validate `client_id` and `client_secret`.
    -   **Step 2**: Look up code in `oauth_codes`.
    -   **Step 3**: If valid and not expired:
        -   Delete code (one-time use).
        -   Generate **Access Token** (JWT signed with `OAUTH_JWKS_SECRET`).
        -   Generate **Refresh Token** and store in `oauth_refresh_tokens`.
        -   Return JSON response.

3.  **`src/lib/oauth-storage.ts`**:
    -   Update to handle DB operations for both codes and refresh tokens.

### Phase 3: Middleware Update

The `middleware.ts` needs to be able to verify *two* types of tokens:
1.  Standard Supabase Access Tokens (for your frontend app).
2.  Custom Bridge Access Tokens (for OpenAI).

We will update `src/middleware.ts` to attempt verification of our Custom JWT using `jose` if the standard Supabase auth fails or if the token format differs.

### Phase 4: Environment Setup

Ensure `.env.local` has:
-   `OAUTH_CLIENT_ID`: Your defined client ID (e.g., `openai-gpt`).
-   `OAUTH_CLIENT_SECRET`: Your defined secret.
-   `OAUTH_JWKS_SECRET`: A strong random string for signing tokens.

## ✅ Benefits

-   **Zero External Dependencies**: No Auth0/Clerk needed.
-   **Immediate Availability**: Works with Supabase today (no Beta required).
-   **Full Control**: You own the data and the flow.

