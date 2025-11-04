# Next.js Integration Guide

Complete step-by-step guide for integrating SolvaPay hosted checkout and Supabase authentication into a vanilla Next.js App Router project.

## Overview

This guide will help you build a Next.js application with:
- ✅ **Supabase Authentication** - Email/password and Google OAuth sign-in
- ✅ **SolvaPay Hosted Checkout** - Secure subscription payments hosted on SolvaPay
- ✅ **Modern UI Components** - Beautiful, accessible components with Tailwind CSS
- ✅ **Subscription Management** - Hosted customer portal for managing subscriptions

## Guide Structure

Follow these guides in order:

1. **[Setup](./01-setup.md)** - Project initialization and dependencies
2. **[Authentication](./02-authentication.md)** - Supabase auth integration
3. **[Payments](./03-payments.md)** - SolvaPay hosted checkout setup
4. **[Styling](./04-styling.md)** - UI components and styling system
5. **[Complete Example](./05-complete-example.md)** - Full working implementation

## Prerequisites

Before starting, ensure you have:

1. **SolvaPay Account**
   - Sign up at https://solvapay.com
   - Get your secret API key from the dashboard
   - Create at least one agent and plan

2. **Supabase Account**
   - Sign up at https://supabase.com
   - Create a new project
   - Get your project URL and anon key from Settings → API
   - Get your JWT secret from Settings → API → JWT Secret

3. **Node.js Environment**
   - Node.js 18+ installed
   - npm, pnpm, or yarn package manager

## Quick Start

If you're experienced and want a quick reference:

```bash
# 1. Create Next.js project
npx create-next-app@latest my-app --typescript --tailwind --app
cd my-app

# 2. Install dependencies
npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview @solvapay/react-supabase@preview @supabase/supabase-js

# 3. Follow the guides in order:
# - 01-setup.md
# - 02-authentication.md
# - 03-payments.md
# - 04-styling.md
# - 05-complete-example.md
```

## Architecture Overview

### Authentication Flow
1. User signs in with Supabase (email/password or Google OAuth)
2. Middleware extracts user ID from Supabase JWT token
3. User ID is passed to API routes via `x-user-id` header
4. SolvaPay customer is created/updated using user ID

### Payment Flow
1. User clicks "Upgrade" or "View Plans"
2. Frontend calls `/api/create-checkout-session`
3. Server creates SolvaPay checkout session
4. User is redirected to hosted checkout page
5. After payment, user returns to app
6. Subscription status is checked and displayed

### Key Concepts

- **Hosted Checkout**: Users are redirected to `app.solvapay.com` for checkout (similar to Stripe Checkout)
- **Middleware Pattern**: Authentication handled in middleware, making user ID available to all API routes
- **Supabase Adapter**: React provider automatically handles Supabase session management and subscription checking
- **Automatic Subscription Checking**: The Supabase adapter automatically calls `/api/check-subscription` - no manual setup needed
- **Customer Sync**: Customer is created in SolvaPay when user signs up

## Support

For issues or questions:
- Check the troubleshooting sections in each guide
- Review the example implementation in `examples/hosted-checkout-demo`
- GitHub Issues: https://github.com/solvapay/solvapay-sdk/issues

## Next Steps

Start with [Setup Guide](./01-setup.md) →

