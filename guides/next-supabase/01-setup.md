# Step 1: Project Setup

This guide covers initializing a Next.js project and installing all required dependencies.

## Initialize Next.js Project

Create a new Next.js project with TypeScript and Tailwind CSS:

```bash
npx create-next-app@latest my-app --typescript --eslint --tailwind --app --import-alias "@/*" --yes
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

Create a `.env.local` file in your project root with the required environment variables:

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

## Verify Installation

Test that everything is installed correctly:

```bash
# Start development server
npm run dev
```

Visit http://localhost:3000 - you should see the default Next.js welcome page.

**Note:** This guide assumes your project uses a `src` folder structure. If `create-next-app` created your project without a `src` folder, you'll need to create one and move the `app` folder into it:

```bash
mkdir src
mv app src/
```

## Project Structure

Your project should now have this structure:

```
my-app/
├── src/
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx
│       └── globals.css
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

