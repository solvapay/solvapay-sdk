# Step 1: Project Setup

This guide covers initializing a Next.js project and installing all required dependencies.

## Initialize Next.js Project

Create a new Next.js project with TypeScript and Tailwind CSS:

```bash
npx create-next-app@latest my-app --typescript --tailwind --app
cd my-app
```

**Options explained:**
- `--typescript` - Enables TypeScript support
- `--tailwind` - Installs and configures Tailwind CSS
- `--app` - Uses the App Router (required for this guide)

## Install Dependencies

Install all required SolvaPay packages and Supabase:

```bash
npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview @solvapay/react-supabase@preview @supabase/supabase-js
```

**Important:** Always use the `@preview` tag when installing SolvaPay packages to ensure you get the latest preview versions.

**Package explanations:**
- `@solvapay/auth` - Authentication helpers and adapters
- `@solvapay/server` - Server-side SolvaPay SDK
- `@solvapay/next` - Next.js-specific helpers (checkSubscription, etc.)
- `@solvapay/react` - React hooks and components
- `@solvapay/react-supabase` - Supabase adapter for React provider
- `@supabase/supabase-js` - Supabase client library

## Environment Variables

Create a `.env.local` file in your project root:

```env
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=sp_sandbox_your_secret_key_here
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
NEXT_PUBLIC_AGENT_REF=agt_your_agent_ref

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here
```

**Getting your credentials:**

1. **SolvaPay Secret Key:**
   - Log in to https://solvapay.com
   - Go to Dashboard → Settings → API Keys
   - Copy your secret key (starts with `sp_sandbox_` or `sp_live_`)

2. **SolvaPay Agent Reference:**
   - In SolvaPay Dashboard → Agents
   - Copy the agent reference (starts with `agt_`)

3. **Supabase URL and Anon Key:**
   - Log in to https://supabase.com
   - Go to your project → Settings → API
   - Copy "Project URL" and "anon public" key

4. **Supabase JWT Secret:**
   - In Supabase → Settings → API
   - Scroll to "JWT Settings"
   - Copy the "JWT Secret" (click "Reveal" if needed)

**Security Note:** Never commit `.env.local` to version control. It's already in `.gitignore` by default.

## Verify Installation

Test that everything is installed correctly:

```bash
# Start development server
npm run dev
```

Visit http://localhost:3000 - you should see the default Next.js welcome page.

## Project Structure

Your project should now have this structure:

```
my-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── public/
├── .env.local          # Your environment variables (not committed)
├── next.config.mjs
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── postcss.config.js
```

## Next Steps

Now that your project is set up, proceed to:
- **[Step 2: Authentication](./02-authentication.md)** - Set up Supabase authentication

