# TODO: Complete Setup for OpenAI Custom GPT Actions Example

This document outlines the remaining steps to complete the setup and testing of the Next.js OpenAI Custom GPT Actions example.

## Prerequisites

- [x] Project dependencies installed (`pnpm install`)
- [x] Environment variables configured (`.env.local` file)
- [x] Supabase project created and configured
- [x] OAuth storage refactored to use Supabase database (bare minimum approach)

## Setup Steps

### 1. Database Setup

- [ ] **Complete Supabase Database Initialization**
  - [ ] Ensure `SUPABASE_DB_URL` is set in `.env.local` with correct connection string
    - Get from: Supabase Dashboard → Settings → Database → Connection string → **URI** (not Transaction/Session mode)
    - Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres`
  - [ ] Run the database initialization script:
    ```bash
    pnpm init:db
    ```
  - [ ] Verify the script completes successfully:
    - ✅ `oauth_refresh_tokens` table created
    - ✅ Indexes created
    - ✅ RLS policies created
    - ✅ Cleanup function created
  - [ ] If connection fails, verify:
    - Connection string is using "URI" format (direct connection)
    - Password is properly URL-encoded (script handles this automatically)
    - Project reference matches your Supabase project

### 2. OpenAPI Schema Generation

- [ ] **Generate OpenAPI Schema**
  - [ ] Run the schema generation script:
    ```bash
    pnpm generate:docs
    ```
  - [ ] Verify `generated/openapi.json` is created/updated
  - [ ] Check that all endpoints are documented:
    - OAuth endpoints (`/api/oauth/*`)
    - Task CRUD endpoints (`/api/tasks/*`)
    - Subscription endpoints (`/api/check-subscription`, etc.)
  - [ ] Verify schema is valid JSON (no syntax errors)

### 3. Application Startup

- [ ] **Start Development Server**
  - [ ] Ensure all environment variables are set in `.env.local`:
    - `SOLVAPAY_SECRET_KEY`
    - `NEXT_PUBLIC_AGENT_REF`
    - `NEXT_PUBLIC_SUPABASE_URL`
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - `SUPABASE_JWT_SECRET`
    - `OAUTH_ISSUER`
    - `OAUTH_JWKS_SECRET`
    - `OAUTH_CLIENT_ID`
    - `PUBLIC_URL`
  - [ ] Start the development server:
    ```bash
    pnpm dev
    ```
  - [ ] Verify server starts on `http://localhost:3000`
  - [ ] Check for any startup errors in console

### 4. Local Testing

- [ ] **Test OAuth Endpoints**
  - [ ] Test authorization endpoint: `GET /api/oauth/authorize`
  - [ ] Test token exchange: `POST /api/oauth/token`
  - [ ] Test userinfo endpoint: `GET /api/oauth/userinfo`
  - [ ] Verify refresh tokens are stored in Supabase database

- [ ] **Test API Endpoints**
  - [ ] Test OpenAPI docs: `GET http://localhost:3000/api/docs`
  - [ ] Test OpenAPI JSON: `GET http://localhost:3000/api/docs/json`
  - [ ] Verify all endpoints are accessible

### 5. Public Access Setup (for Custom GPT)

- [ ] **Set Up Public Tunnel**
  - [ ] Install ngrok (if not already installed):
    ```bash
    brew install ngrok/ngrok/ngrok
    # or download from https://ngrok.com/download
    ```
  - [ ] Start ngrok tunnel:
    ```bash
    ngrok http 3000
    # or with custom domain:
    ngrok http 3000 --url=your-custom-subdomain.ngrok-free.app
    ```
  - [ ] Copy the ngrok HTTPS URL (e.g., `https://xxxx-xxxx.ngrok-free.app`)
  - [ ] Update `.env.local`:
    ```env
    PUBLIC_URL=https://xxxx-xxxx.ngrok-free.app
    ```
  - [ ] Restart the Next.js server
  - [ ] Verify public URL is accessible:
    - `https://xxxx-xxxx.ngrok-free.app/api/docs/json`

### 6. Custom GPT Configuration

- [ ] **Configure OpenAI Custom GPT**
  - [ ] Go to [ChatGPT](https://chatgpt.com) → Create GPT
  - [ ] In the "Actions" tab:
    - [ ] Add server URL: `https://xxxx-xxxx.ngrok-free.app` (your ngrok URL)
    - [ ] Import OpenAPI schema from: `https://xxxx-xxxx.ngrok-free.app/api/docs/json`
  - [ ] Configure OAuth settings:
    - [ ] **Client ID**: Value from `OAUTH_CLIENT_ID` env var
    - [ ] **Client Secret**: Set a secret (or leave empty if not required)
    - [ ] **Authorization URL**: `https://xxxx-xxxx.ngrok-free.app/api/oauth/authorize`
    - [ ] **Token URL**: `https://xxxx-xxxx.ngrok-free.app/api/oauth/token`
    - [ ] **Scope**: `openid email profile`
  - [ ] Add privacy policy URL (if you have one)
  - [ ] Save the Custom GPT configuration

### 7. Testing Custom GPT Integration

- [ ] **Test OAuth Flow**
  - [ ] In ChatGPT, try to use the Custom GPT
  - [ ] Verify OAuth authorization flow works:
    - [ ] User is redirected to Supabase Google OAuth
    - [ ] After authentication, redirected back to OpenAI
    - [ ] Authorization code is exchanged for access token
    - [ ] Refresh token is stored in Supabase database
  - [ ] Verify user can access protected endpoints

- [ ] **Test Custom GPT Actions**
  - [ ] Test listing tasks: Ask GPT to "list my tasks"
  - [ ] Test creating a task: Ask GPT to "create a new task"
  - [ ] Test retrieving a task: Ask GPT to "get task [id]"
  - [ ] Test updating a task: Ask GPT to "update task [id]"
  - [ ] Test deleting a task: Ask GPT to "delete task [id]"
  - [ ] Verify paywall protection works (subscription checks)

### 8. Production Deployment (Optional)

- [ ] **Deploy to Production**
  - [ ] Set up hosting (Vercel, Railway, etc.)
  - [ ] Configure production environment variables
  - [ ] Update `PUBLIC_URL` to production domain
  - [ ] Run database migration on production
  - [ ] Test production endpoints
  - [ ] Update Custom GPT configuration with production URLs

## Troubleshooting

### Database Connection Issues

- **Error: `ENOTFOUND`** - Hostname cannot be resolved
  - Verify you're using "URI" connection string (not Transaction/Session mode)
  - Check project reference matches your Supabase project
  - Ensure Supabase project is active (not paused)

- **Error: `EHOSTUNREACH`** - Connection refused
  - Verify connection string format
  - Check if password contains special characters (script should auto-encode)
  - Ensure IP is allowed in Supabase connection settings

### OAuth Issues

- **Authorization flow fails**
  - Check Supabase OAuth provider is configured (Google OAuth)
  - Verify callback URLs are set correctly
  - Check cookies are being set properly

- **Token exchange fails**
  - Verify authorization code is JWT-encoded correctly
  - Check refresh token is stored in Supabase database
  - Verify database table exists and has correct schema

### Custom GPT Issues

- **Schema import fails**
  - Verify OpenAPI schema is accessible at `/api/docs/json`
  - Check schema is valid JSON
  - Ensure ngrok tunnel is active

- **OAuth not working**
  - Verify OAuth endpoints are accessible publicly
  - Check redirect URIs match exactly
  - Verify client ID/secret configuration

## Notes

- The OAuth implementation uses a **bare minimum approach**:
  - ✅ Authorization codes are JWT-encoded (no storage needed)
  - ✅ Refresh tokens stored in Supabase database
  - ✅ Revoked tokens rely on JWT expiration (no blacklist storage)

- This example demonstrates:
  - Supabase authentication integration
  - SolvaPay paywall protection
  - OAuth 2.0 for OpenAI Custom GPT Actions
  - Minimal storage requirements using only Supabase

## Completion Checklist

- [ ] Database initialized successfully
- [ ] OpenAPI schema generated
- [ ] Application running locally
- [ ] Public tunnel configured
- [ ] Custom GPT configured
- [ ] OAuth flow tested
- [ ] API endpoints tested
- [ ] Custom GPT actions working

---

**Last Updated**: See git history for latest changes
