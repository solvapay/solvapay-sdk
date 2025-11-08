# Documentation Structure

## 2.1. Getting Started Guide

**Location**: `docs/getting-started.md` or `docs/getting-started/index.md`

**Sections**:

1. **Introduction**
   - What is SolvaPay SDK?
   - Key features and benefits
   - Use cases (API monetization, AI agents, MCP servers)

2. **Installation**
   - Prerequisites
   - Package installation (`@solvapay/server`, `@solvapay/react`, etc.)
   - Environment setup (API keys, environment variables)

3. **Quick Start Examples**
   - **Express.js**: Protect an API endpoint (5 minutes)
   - **Next.js**: Add payment flow to a Next.js app (10 minutes)
   - **MCP Server**: Protect MCP tools (5 minutes)
   - **React**: Add payment UI components (10 minutes)

4. **Core Concepts**
   - Agents and Plans
   - Customer references
   - Paywall protection flow
   - Subscription lifecycle

5. **Next Steps**
   - Link to full API reference
   - Link to examples
   - Link to architecture guide

## 2.2. API Reference Documentation

**Location**: Auto-generated from source code with TypeDoc

**Structure** (per package):

### `@solvapay/server`

- **Main Exports**
  - `createSolvaPay(config?)` - Factory function
  - `createSolvaPayClient(options)` - Direct client creation
  - `verifyWebhook(options)` - Webhook verification
- **Types**
  - `SolvaPay` - Main instance interface
  - `PayableFunction` - Payable handler interface
  - `CreateSolvaPayConfig` - Configuration options
  - `PaywallError` - Error class
- **Adapters**
  - `payable().http()` - HTTP adapter (Express/Fastify)
  - `payable().next()` - Next.js adapter
  - `payable().mcp()` - MCP adapter
  - `payable().function()` - Pure function adapter
- **Methods**
  - `ensureCustomer()` - Ensure customer exists
  - `createPaymentIntent()` - Create payment intent
  - `processPayment()` - Process payment
  - `checkLimits()` - Check usage limits
  - `trackUsage()` - Track usage
  - `getCustomer()` - Get customer details
  - `createCheckoutSession()` - Create checkout session
  - `createCustomerSession()` - Create customer portal session

### `@solvapay/react`

- **Components**
  - `SolvaPayProvider` - Context provider
  - `PaymentForm` - Payment form component
  - `PlanSelector` - Plan selection component
  - `SubscriptionGate` - Subscription gate component
  - `PlanBadge` - Plan badge component
  - `Spinner` - Loading spinner
  - `StripePaymentFormWrapper` - Stripe integration wrapper
- **Hooks**
  - `useSubscription()` - Get subscription status
  - `useSubscriptionStatus()` - Get subscription status details
  - `useCustomer()` - Get customer information
  - `useCheckout()` - Handle checkout flow
  - `usePlans()` - Get available plans
  - `useSolvaPay()` - Access SolvaPay context
- **Types**
  - `SolvaPayConfig` - Provider configuration
  - `SubscriptionStatus` - Subscription status type
  - `PaymentFormProps` - Payment form props
  - All component and hook types

### `@solvapay/next`

- **Helpers**
  - `checkSubscription()` - Check subscription with caching
  - `syncCustomer()` - Sync customer data
  - `createPaymentIntent()` - Create payment intent
  - `processPayment()` - Process payment
  - `createCheckoutSession()` - Create hosted checkout
  - `createCustomerSession()` - Create customer portal
  - `cancelSubscription()` - Cancel subscription
  - `listPlans()` - List available plans
  - `getAuthenticatedUser()` - Get authenticated user
- **Cache Management**
  - `clearSubscriptionCache()` - Clear cache for user
  - `clearAllSubscriptionCache()` - Clear all cache
  - `getSubscriptionCacheStats()` - Get cache statistics
- **Middleware**
  - `createAuthMiddleware()` - Create auth middleware
  - `createSupabaseAuthMiddleware()` - Create Supabase auth middleware

### `@solvapay/auth`

- **Adapters**
  - `MockAuthAdapter` - Mock adapter for testing
  - `SupabaseAuthAdapter` - Supabase adapter (from `@solvapay/auth/supabase`)
- **Utilities**
  - `getUserIdFromRequest()` - Extract user ID from request
  - `requireUserId()` - Require user ID or return error
  - `getUserEmailFromRequest()` - Extract email from Supabase JWT
  - `getUserNameFromRequest()` - Extract name from Supabase JWT

### `@solvapay/react-supabase`

- **Exports**
  - `createSupabaseAuthAdapter()` - Create Supabase auth adapter

### `@solvapay/core`

- **Types & Schemas**
  - All shared types and schemas
  - Error classes

## 2.3. Guides & Tutorials

**Location**: `docs/guides/` directory

1. **Server-Side Protection**
   - Express.js paywall protection
   - Next.js API route protection
   - MCP server integration
   - Edge runtime support
   - Webhook handling

2. **Client-Side Integration**
   - React component setup
   - Payment flow implementation
   - Subscription management UI
   - Supabase authentication integration

3. **Advanced Topics**
   - Custom authentication adapters
   - Request deduplication and caching
   - Error handling strategies
   - Testing with stub mode
   - Multi-tenant setups
   - Usage tracking and analytics

4. **Framework-Specific Guides**
   - Next.js App Router integration
   - Express.js middleware setup
   - Fastify integration
   - MCP server setup

## 2.4. Examples Documentation

**Location**: Enhanced examples with detailed READMEs

Each example should include:

- **Purpose**: What the example demonstrates
- **Setup Instructions**: Step-by-step setup
- **Key Features**: Highlighted features
- **Code Walkthrough**: Explanation of key code sections
- **Running the Example**: How to run and test

## 2.5. Best Practices

**Location**: `docs/best-practices.md`

Topics:

- Security best practices
- Performance optimization
- Error handling patterns
- Testing strategies
- Code organization
- TypeScript usage tips
