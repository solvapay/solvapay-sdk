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

## Connecting to OpenAI

1. Go to [ChatGPT](https://chat.openai.com) and create a new GPT.
2. In the "Configure" tab, select "Create new action".
3. Paste the contents of your local OpenAPI spec (or deployed URL).
4. Set up Authentication:
   - **Type**: OAuth
   - **Client ID**: From Supabase Auth settings
   - **Client Secret**: From Supabase Auth settings
   - **Authorization URL**: `https://<PROJECT_REF>.supabase.co/auth/v1/authorize`
   - **Token URL**: `https://<PROJECT_REF>.supabase.co/auth/v1/token`
   - **Scope**: `email profile openid`

## License

MIT
