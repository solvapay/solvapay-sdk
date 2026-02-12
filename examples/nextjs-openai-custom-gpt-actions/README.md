# OpenAI Custom GPT Actions with Supabase Auth

This example demonstrates how to build a production-ready backend for OpenAI Custom GPTs using Next.js and Supabase.

## Features

- **OpenAPI Specification**: Automatically generated from Zod schemas
- **Authentication**: Supabase Auth (OAuth 2.0)
- **Database**: Supabase Postgres with RLS
- **Monetization**: SolvaPay Integration (optional)
- **Minimal Footprint**: No unnecessary UI code

## Setup

1. **Install Dependencies**
   ```bash
   pnpm install
   ```

2. **Configure Environment**
   Copy `.env.example` to `.env.local` and fill in your Supabase credentials:
   ```bash
   cp env.example .env.local
   ```

3. **Initialize Database**
   Run the database migration to create the `tasks` table:
   ```bash
   pnpm init:db
   ```

4. **Run Development Server**
   ```bash
   pnpm dev
   ```

## API Documentation

The API documentation is available at:
- **JSON Spec**: http://localhost:3000/api/docs/json (Use this for ChatGPT configuration)

## Connecting to OpenAI Custom GPT

### Step 1: Enable Supabase OAuth Server (Beta)

Supabase's OAuth 2.1 server capabilities are currently in beta. Apply for access here:
- [Supabase OAuth Server Beta](https://github.com/orgs/supabase/discussions/38022)

Once enabled in your Supabase project, you can configure OpenAI to authenticate directly with Supabase.

### Step 2: Create OAuth Client in Supabase

After beta access is granted:

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **Authentication** → **OAuth**
3. Create a new OAuth client for OpenAI
4. Save your **Client ID** and **Client Secret** (you'll need these for OpenAI)
5. Add OpenAI's redirect URIs:
   - `https://chatgpt.com/aip/g-<GPT_ID>/oauth/callback`
   - `https://chat.openai.com/aip/g-<GPT_ID>/oauth/callback`

### Step 3: Configure OpenAI Custom GPT

1. Go to [ChatGPT](https://chat.openai.com) and create a new GPT
2. In the "Configure" tab, select "Create new action"
3. Import your OpenAPI schema:
   - **Local**: http://localhost:3000/api/docs/json
   - **Deployed**: https://your-domain.com/api/docs/json
4. Set up Authentication:
   - **Authentication Type**: OAuth
   - **Client ID**: `<from Supabase OAuth client>`
   - **Client Secret**: `<from Supabase OAuth client>`
   - **Authorization URL**: `https://<PROJECT_REF>.supabase.co/auth/v1/authorize`
   - **Token URL**: `https://<PROJECT_REF>.supabase.co/auth/v1/token`
   - **Scope**: `openid email profile`
   - **Token Exchange Method**: Default (POST request)

Replace `<PROJECT_REF>` with your Supabase project reference (e.g., `aadmielekvmoikgxhxmr`)

### Step 4: Test Your GPT

Try asking your GPT to:
- "List my tasks"
- "Create a new task called 'Test task'"
- "Show me my subscription plan"

The GPT will prompt you to authenticate with Supabase on first use.

## License

MIT
