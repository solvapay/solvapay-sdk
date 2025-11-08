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

0. **[App Description](./00-app-description.md)** - (Optional) Customize your app description template before implementing
1. **[Setup](./01-setup.md)** - Prerequisites and setup verification (copy into Cursor first)
2. **[Authentication](./02-authentication.md)** - Supabase auth integration (copy into Cursor)
3. **[Payments](./03-payments.md)** - SolvaPay hosted checkout setup (copy into Cursor)
4. **[Styling](./04-styling.md)** - UI components and styling system (copy into Cursor)
5. **[Complete Example](./05-complete-example.md)** - Full working implementation (copy into Cursor, includes app description customization)

## Prerequisites

Before starting, ensure you have:

1. **Node.js Environment**
   - Node.js 18+ installed
   - npm, pnpm, or yarn package manager

2. **Environment Variables**
   - SolvaPay credentials configured in `.env.local`
   - Supabase credentials configured in `.env.local`

## Quick Start

### Step 1: Create Project

Create your project with `create-solvapay-app`:

```bash
# Create project (handles Next.js setup, dependencies, and configuration)
npx create-solvapay-app my-app
cd my-app
```

### Step 2: (Optional) Customize App Description

Before implementing, you can optionally customize your app description:

1. **Open `guides/00-app-description.md`** - Review the template
2. **Customize it** (optional) - Edit to match your app's features, branding, and requirements
3. **Or leave as-is** - The default generic example works fine

**Why customize?** When implementing `05-complete-example.md`, the AI will use this description to customize the HomePage, feature cards, and messaging to match your app.

### Step 3: Use Guides with Cursor

After creating your project, use these guides with Cursor AI:

1. **First, copy the setup verification instructions** (`01-setup.md`) into Cursor with:

   ```
   Verify my project setup matches these requirements
   ```

   Then paste the contents of `01-setup.md`

2. **Then, copy the implementation guides** into Cursor with:
   ```
   Add subscription to my app using these instructions
   ```
   Then paste the contents of:
   - `00-app-description.md` - Your app description (for customizing HomePage)
   - `02-authentication.md` - Supabase auth integration
   - `03-payments.md` - SolvaPay hosted checkout setup
   - `04-styling.md` - UI components and styling
   - `05-complete-example.md` - Complete implementation (will use app description)

The guides are designed to be copied directly into Cursor, where the AI assistant will help you implement each step.

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
