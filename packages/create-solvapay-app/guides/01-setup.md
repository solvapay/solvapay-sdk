# Prerequisites: Account Setup and Configuration

Before implementing the SolvaPay subscription integration, you need to set up your accounts and configure environment variables.

## Step 1: Create SolvaPay Account

1. Go to [solvapay.com](https://solvapay.com) and create an account
2. Complete the onboarding process
3. **Connect your Stripe account** (if you have one) - this allows SolvaPay to process payments through Stripe
4. Navigate to your dashboard and create a **Secret Key**:
   - Go to Settings → API Keys
   - Create a new secret key
   - Copy the secret key (starts with `sp_sandbox_` or `sp_live_`)
5. Copy your **Agent Reference** (starts with `agt_`) from the dashboard

## Step 2: Create Supabase Account

1. Go to [supabase.com](https://supabase.com) and create an account
2. Create a new project
3. Wait for the project to finish provisioning
4. Go to Project Settings → API
5. Copy the following values:
   - **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`)
   - **anon/public key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
6. Go to Project Settings → API → JWT Settings
7. Copy the **JWT Secret** (`SUPABASE_JWT_SECRET`)

## Step 3: Update Environment Variables

Open `.env.local` in your project root and update it with your actual credentials:

```env
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=sp_sandbox_your_secret_key_here
SOLVAPAY_API_BASE_URL=https://api.solvapay.com
NEXT_PUBLIC_AGENT_REF=agt_your_agent_ref

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here
```

Replace the placeholder values with your actual credentials from the steps above.

## Step 4: Verify Project Setup

Verify that your project has been properly set up by `create-solvapay-app`:

1. **Project structure** - Should have `src/app/` directory
2. **Packages installed** - Check `package.json` includes:
   - `@solvapay/auth@preview`
   - `@solvapay/server@preview`
   - `@solvapay/next@preview`
   - `@solvapay/react@preview`
   - `@solvapay/react-supabase@preview`
   - `@supabase/supabase-js`
3. **Environment file** - `.env.local` exists and contains all required variables

## Step 5: Implement Integration with Cursor

Once your accounts are set up and environment variables are configured, copy the following implementation guides into Cursor:

**Copy this prompt into Cursor (or IDE of your choice) to implement:**

```
Add subscription and auth to my app using these instructions
```

**Then drag these guide files into the chat as references:**
- `02-authentication.md` - Supabase authentication setup
- `03-payments.md` - SolvaPay hosted checkout setup
- `04-styling.md` - UI components and styling
- `05-complete-example.md` - Complete working implementation


Cursor will help you implement each step automatically. Sit back and relax while it builds your subscription integration!

