# SolvaPay Next.js OpenAI Custom GPT Actions Example

> **⚠️ Work in Progress - Untested**
>
> This example is currently under active development and has not been fully tested. The implementation may contain bugs, incomplete features, or breaking changes. Use at your own risk and expect issues. Contributions and feedback are welcome!

This example demonstrates how to integrate SolvaPay with Next.js App Router to create OpenAI Custom GPT Actions with paywall protection. It provides the same functionality as the Fastify/Vite example but uses Next.js 15 with the latest App Router.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Paywall Protection](#paywall-protection)
- [Setup for OpenAI Custom GPT Actions](#setup-for-openai-custom-gpt-actions)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Key Differences from Fastify Example](#key-differences-from-fastify-example)
- [Configuration](#configuration)
- [Development](#development)
- [Deployment](#deployment)
- [Usage with OpenAI Custom GPT Actions](#usage-with-openai-custom-gpt-actions)
- [Testing](#testing)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

## Features

- **Next.js 15** with App Router
- **SolvaPay Paywall Protection** with usage limits and subscription management
- **Supabase Authentication** for user authentication and session management
- **OAuth 2.0 Endpoints** for OpenAI Custom GPT Actions integration
- **CRUD Operations** for tasks with paywall protection
- **Hosted Checkout Flow** - redirects to SolvaPay hosted checkout page
- **Subscription Management** - check subscription status and manage plans
- **TypeScript** support with Zod validation
- **API Routes** using Next.js App Router
- **Comprehensive Testing** with Vitest
- **OpenAPI Documentation** auto-generated from Zod schemas

## Quick Start

### 1. Install Dependencies

```bash
cd examples/nextjs-openai-custom-gpt-actions
pnpm install
```

### 2. Setup Environment

Copy the example environment file and fill in your values:

```bash
cp env.example .env.local
```

Then edit `.env.local` with your actual values. Required variables:

```env
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=sp_sandbox_your_secret_key_here
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
NEXT_PUBLIC_AGENT_REF=agt_your_agent_ref

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here

# OAuth Configuration (for OpenAI Custom GPT Actions)
OAUTH_ISSUER=https://your-domain.com
OAUTH_JWKS_SECRET=your_jwks_secret_here
OAUTH_CLIENT_ID=your_client_id_here

# Public URL (required for OpenAPI generation)
PUBLIC_URL=http://localhost:3000
```

### 3. Setup Supabase Database

This example uses Supabase for OAuth storage (bare minimum approach). Initialize the database schema:

**Option 1: Using the init script (recommended)**

1. Add your Supabase database connection string to `.env.local`:

   ```env
   SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
   ```

   Get this from: Supabase Dashboard → Settings → Database → Connection string → URI

2. Run the initialization script:
   ```bash
   pnpm init:db
   ```

**Option 2: Manual SQL execution**

1. Go to your Supabase project dashboard: https://supabase.com/dashboard
2. Navigate to SQL Editor
3. Run the migration SQL from `supabase/migrations/001_oauth_refresh_tokens.sql`

**Option 3: Using Supabase CLI**

```bash
# If you have Supabase CLI installed
supabase db push
```

This creates the `oauth_refresh_tokens` table needed for storing OAuth refresh tokens.

**Note**: This is a bare minimum OAuth implementation:

- ✅ Authorization codes are JWT-encoded (no storage needed)
- ✅ Refresh tokens stored in Supabase database
- ✅ Revoked tokens rely on JWT expiration (no blacklist storage)

### 4. Build Dependencies

```bash
pnpm build:deps
```

### 5. Start Development Server

```bash
pnpm dev
```

The application will be available at `http://localhost:3000`.

## 🔒 Paywall Protection

This example demonstrates SolvaPay's paywall functionality with subscription-based access control:

### How It Works

1. **Authentication**: Users authenticate via Supabase (email/password or Google OAuth)
2. **Customer Sync**: On sign-in, the app automatically syncs the user with SolvaPay backend
3. **Subscription Check**: API endpoints check subscription status before allowing access
4. **Usage Limits**: Configured via SolvaPay dashboard per agent/plan
5. **Upgrade Flow**: Users are redirected to hosted checkout page when limits are exceeded

### Subscription Management

- Check subscription status: `GET /api/check-subscription`
- Create checkout session: `POST /api/create-checkout-session`
- Manage subscription: `POST /api/create-customer-session`
- Sync customer: `POST /api/sync-customer` (called automatically on auth)

## 🌐 Setup for OpenAI Custom GPT Actions

To use this with OpenAI Custom GPT Actions, you need to expose your local server publicly using ngrok.

### 1. Install ngrok

```bash
# Download from https://ngrok.com/download
# Or install via package manager
brew install ngrok/ngrok/ngrok
```

### 2. Start ngrok tunnel

```bash
# In a separate terminal (keep your Next.js dev server running)
ngrok http 3000 --url=your-custom-subdomain.ngrok-free.app

# Or use a free random URL
ngrok http 3000
```

### 3. Set the PUBLIC_URL environment variable

Add to your `.env.local`:

```env
PUBLIC_URL=https://your-subdomain.ngrok-free.app
```

Then restart your Next.js server:

```bash
pnpm dev
```

### 4. Configure Custom GPT in ChatGPT

1. Go to [ChatGPT](https://chatgpt.com) → Create GPT
2. In the Actions tab, add your ngrok URL as the server:
   ```
   https://your-subdomain.ngrok-free.app
   ```
3. Import the OpenAPI schema from:
   ```
   https://your-subdomain.ngrok-free.app/api/docs/json
   ```
4. Configure OAuth settings:
   - **Client ID**: `solvapay-demo-client`
   - **Client Secret**: `demo-secret-key`
   - **Authorization URL**: `https://your-subdomain.ngrok-free.app/oauth/authorize`
   - **Token URL**: `https://your-subdomain.ngrok-free.app/api/oauth/token`
   - **Scopes**: `openid email profile`

### 5. Test the Integration

Once configured, your Custom GPT will be able to:

- Create, read, update, and delete tasks
- Enforce usage limits based on subscription plans
- Redirect users to upgrade when limits are exceeded
- Authenticate users via OAuth 2.0 flow for OpenAI Custom GPT Actions

### 6. Troubleshooting

If you encounter issues when importing the OpenAPI schema:

- **Server URL mismatch**: Make sure your `PUBLIC_URL` environment variable matches your ngrok URL exactly
- **Missing operationId**: The schema now includes proper operationIds for all endpoints
- **OAuth issues**: Verify that your OAuth redirect URLs match your ngrok domain

## Project Structure

```
nextjs-openai-custom-gpt-actions/
├── src/                          # Source code
│   ├── app/                      # Next.js App Router
│   │   ├── api/                  # API Routes
│   │   │   ├── auth/             # Authentication endpoints
│   │   │   ├── oauth/            # OAuth 2.0 endpoints (for OpenAI)
│   │   │   ├── tasks/            # CRUD operations for tasks
│   │   │   ├── checkout/         # Checkout completion handler
│   │   │   ├── check-subscription/ # Subscription status
│   │   │   ├── create-checkout-session/ # Create checkout session
│   │   │   ├── create-customer-session/ # Customer portal access
│   │   │   ├── sync-customer/    # Sync user with SolvaPay
│   │   │   └── docs/             # OpenAPI documentation
│   │   ├── auth/                 # Auth callback pages
│   │   ├── checkout/             # Checkout pages
│   │   ├── docs/                 # API documentation page
│   │   ├── oauth/                # OAuth pages
│   │   ├── components/           # React components
│   │   ├── globals.css           # Global styles
│   │   ├── layout.tsx            # Root layout
│   │   └── page.tsx              # Home page
│   ├── lib/                      # Utility libraries
│   │   ├── supabase.ts          # Supabase client
│   │   └── openapi/             # OpenAPI registry
│   ├── services/                 # Business logic
│   ├── types/                    # TypeScript types
│   ├── middleware.ts             # Next.js middleware
│   └── __tests__/                # Test files
├── scripts/                      # Build scripts
│   └── generate-zod-openapi.ts  # OpenAPI generation
├── generated/                    # Generated files
│   └── openapi.json             # Auto-generated OpenAPI spec
├── package.json                 # Dependencies
├── next.config.js               # Next.js configuration
├── tsconfig.json                # TypeScript configuration
├── env.example                  # Environment variables template
└── README.md                    # This file
```

## API Endpoints

### Authentication

- `GET /api/auth/signin-url` - Get Supabase sign-in URL

### Subscription Management

- `GET /api/check-subscription` - Get current user subscription status
- `POST /api/sync-customer` - Sync user with SolvaPay backend (called automatically on auth)
- `POST /api/create-checkout-session` - Create checkout session (redirects to hosted checkout)
- `POST /api/create-customer-session` - Create customer portal session (redirects to hosted portal)
- `GET /api/checkout/complete` - Checkout completion callback

### OAuth 2.0 Flow (for OpenAI Custom GPT Actions)

- `GET /.well-known/openid-configuration` - OpenID Connect discovery
- `GET /api/oauth/jwks` - JSON Web Key Set
- `GET /api/oauth/authorize` - Authorization endpoint
- `POST /api/oauth/token` - Token exchange
- `GET /api/oauth/userinfo` - User information
- `POST /api/oauth/revoke` - Revoke token
- `POST /api/oauth/signout` - Sign out

### CRUD Operations (Tasks)

- `GET /api/tasks` - List tasks with pagination (protected with paywall)
- `POST /api/tasks` - Create a new task (protected with paywall)
- `GET /api/tasks/[id]` - Get specific task (protected with paywall)
- `PUT /api/tasks/[id]` - Update task (protected with paywall)
- `DELETE /api/tasks/[id]` - Delete task (protected with paywall)

### Documentation

- `GET /api/docs` - Interactive Swagger UI
- `GET /api/docs/json` - OpenAPI JSON specification

## Key Differences from Fastify Example

### 1. App Router Structure

Instead of Fastify route handlers, we use Next.js API routes:

**Fastify:**

```typescript
app.get('/tasks', async () => ({ tasks: [] }))
```

**Next.js:**

```typescript
// app/api/tasks/route.ts
export async function GET() {
  return NextResponse.json({ tasks: [] })
}
```

### 2. Middleware

**Fastify:**

```typescript
app.addHook('preHandler', async req => {
  // Add customer reference
})
```

**Next.js:**

```typescript
// src/middleware.ts
export async function middleware(request: NextRequest) {
  // Extract userId from Supabase JWT token
  const authAdapter = new SupabaseAuthAdapter({ jwtSecret })
  const userId = await authAdapter.getUserIdFromRequest(request)

  // Add userId to headers for downstream routes
  requestHeaders.set('x-user-id', userId)
  requestHeaders.set('x-customer-ref', userId) // Legacy support
}
```

### 3. CORS Handling

**Fastify:**

```typescript
await app.register(import('@fastify/cors'), {
  origin: true,
  credentials: true,
})
```

**Next.js:**

```typescript
// next.config.js
async headers() {
  return [
    {
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
      ],
    },
  ]
}
```

### 4. Form Data Handling

**Fastify:**

```typescript
app.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'string' },
  (req, body, done) => {
    // Parse form data
  },
)
```

**Next.js:**

```typescript
// In API route
const formData = await request.formData()
const email = formData.get('email') as string
```

## Configuration

### Environment Variables

Copy `env.example` to `.env.local` and fill in your values:

> **⚠️ Important**: The `PUBLIC_URL` variable is **required** for OpenAPI generation and cannot contain placeholder values like "your-domain" or "your-subdomain". The OpenAPI generation will fail if placeholder URLs are detected to prevent invalid schemas.

```env
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=sp_sandbox_your_secret_key_here
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
NEXT_PUBLIC_AGENT_REF=agt_your_agent_ref

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here

# OAuth Configuration (for OpenAI Custom GPT Actions)
OAUTH_ISSUER=https://your-domain.com
OAUTH_JWKS_SECRET=your_jwks_secret_here
OAUTH_CLIENT_ID=your_client_id_here

# REQUIRED: Public URL (set to your actual ngrok URL - no placeholders allowed!)
PUBLIC_URL=https://your-subdomain.ngrok-free.app
```

### Next.js Configuration

The `next.config.js` file includes:

- CORS headers for API routes
- External packages configuration for SolvaPay
- Server components configuration

## Development

### Running Tests

```bash
pnpm test
```

### Linting

```bash
pnpm lint
```

### Building for Production

```bash
pnpm build
pnpm start
```

## Deployment

### Vercel

This example is configured for easy deployment to Vercel with monorepo support.

#### Setup Instructions

1. **Connect your repository to Vercel**
   - Import the repository in Vercel dashboard
   - Set the root directory to the workspace root (not the example folder)

2. **Configure Build Settings**
   - The `vercel.json` already configures the build command
   - Vercel will automatically detect and use the monorepo setup

3. **Set Required Environment Variables**

   **⚠️ CRITICAL**: You **must** set these environment variables in Vercel's project settings:

   Go to your Vercel project → Settings → Environment Variables and add:

   **Required Variables:**

   ```env
   SOLVAPAY_SECRET_KEY=your-production-secret-key
   NEXT_PUBLIC_AGENT_REF=your-agent-reference
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   SUPABASE_JWT_SECRET=your-supabase-jwt-secret
   PUBLIC_URL=https://your-app.vercel.app
   ```

   **⚠️ IMPORTANT**: `PUBLIC_URL` is critical for OpenAPI generation. Without it, the build will fail. For preview deployments, you can use `https://$VERCEL_URL` as the value.

   **Optional (for OpenAI Custom GPT Actions):**

   ```env
   OAUTH_ISSUER=https://your-app.vercel.app
   OAUTH_JWKS_SECRET=your-jwks-secret
   OAUTH_CLIENT_ID=your-oauth-client-id
   SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
   ```

4. **Deploy**
   - Push to your connected branch
   - Vercel will automatically build and deploy
   - The OpenAPI docs will be generated during build using `PUBLIC_URL`
   - Subscription data is stored in SolvaPay backend (no additional storage needed)

#### Vercel Environment Variables Priority

The OpenAPI generation script uses the following priority:

1. **`PUBLIC_URL`** (recommended for production) - explicitly set in Vercel settings
2. **`VERCEL_URL`** (fallback) - automatically provided by Vercel

We recommend using `PUBLIC_URL` for production to have full control over the server URL in your OpenAPI specification.

#### Architecture

This app uses a modern architecture with:

- **Authentication**: Supabase handles user authentication (email/password, Google OAuth, etc.)
- **Session Management**: Supabase JWT tokens are verified server-side via middleware
- **Paywall**: SolvaPay SDK handles subscription checks and usage limits
- **Storage**: Subscription data is stored in SolvaPay backend (no local storage needed)
- **Hosted Checkout**: Users are redirected to SolvaPay's hosted checkout page for upgrades
- **Customer Portal**: Users can manage subscriptions via SolvaPay's hosted customer portal

This ensures:

- ✅ Secure authentication with Supabase
- ✅ Centralized subscription management via SolvaPay
- ✅ No need to handle payment processing directly
- ✅ Automatic customer sync when users sign in

### Other Platforms

1. Build the application: `pnpm build`
2. Start the production server: `pnpm start`
3. Set environment variables in your hosting platform (including `PUBLIC_URL`)

## Usage with OpenAI Custom GPT Actions

### 1. Configure OpenAI Actions

In your OpenAI Custom GPT configuration:

1. **Authentication**: Use OAuth 2.0 with your OAuth endpoints
2. **Actions**: Add your API endpoints for CRUD operations
3. **Privacy Policy**: Point to your privacy policy URL

### 2. OAuth Configuration

```json
{
  "authorization_url": "https://your-domain.com/api/oauth/authorize",
  "token_url": "https://your-domain.com/api/oauth/token",
  "scope": "openid email profile"
}
```

### 3. Action Configuration

The OpenAPI schema is automatically generated from your API routes. Import it from:

```
https://your-domain.com/api/docs/json
```

The schema includes all CRUD operations for tasks:

- `listTasks` - List all tasks
- `createTask` - Create a new task
- `getTask` - Get a specific task
- `updateTask` - Update a task
- `deleteTask` - Delete a task

All endpoints are protected with paywall checks and include proper OAuth 2.0 authentication requirements.

## 🧪 Testing

> **Note**: This example is currently untested. The test suite may be incomplete or contain failing tests.

### Run All Tests

```bash
npm test           # All tests
npm run test:backend    # Backend API tests only
npm run test:ui-components  # UI component tests only
npm run test:watch     # Watch mode
```

### Test Coverage

- **Test suite status**: ⚠️ Work in progress - tests may be incomplete or failing
- **Backend Tests**: Paywall protection, CRUD operations, OAuth flow, checkout functionality
- **UI Tests**: Component rendering and user interactions
- **SDK Tests**: Core paywall functionality tested in the SDK package

## Best Practices

### 1. Environment Variables

Always use environment variables for sensitive data:

```typescript
// ✅ Good: Environment variables
const apiKey = process.env.SOLVAPAY_SECRET_KEY!

// ❌ Bad: Hardcoded values
const apiKey = 'sp_secret_123...'
```

### 2. OAuth Security

Never expose OAuth secrets in client-side code:

```typescript
// ✅ Good: Server-side only
export async function POST(request: NextRequest) {
  const clientSecret = process.env.OAUTH_CLIENT_SECRET // Server-side only
}

// ❌ Bad: Client-side exposure
const clientSecret = process.env.NEXT_PUBLIC_OAUTH_SECRET // Never do this!
```

### 3. Error Handling

Handle errors gracefully in API routes:

```typescript
export async function POST(request: NextRequest) {
  try {
    // Your logic
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

### 4. OpenAPI Generation

Always set `PUBLIC_URL` for OpenAPI generation:

```bash
# Development
PUBLIC_URL=http://localhost:3000

# Production
PUBLIC_URL=https://your-domain.com
```

### 5. Testing

Use stub client in tests:

```typescript
import { createStubClient } from '../../shared/stub-api-client'

const apiClient = createStubClient({ freeTierLimit: 5 })
```

## Troubleshooting

### CORS Errors

**Problem**: CORS errors when accessing API from OpenAI Custom GPT Actions.

**Solution**:

1. CORS is configured in `next.config.mjs` - ensure your domain is allowed
2. Check that `Access-Control-Allow-Origin` header is set correctly
3. Verify preflight OPTIONS requests are handled
4. Check browser console for specific CORS error messages
5. Ensure OpenAI domain is in allowed origins (if restricting)

### OAuth Issues

**Problem**: OAuth flow not working with OpenAI Custom GPT Actions.

**Solution**:

1. Check that all OAuth environment variables are set:
   - `OAUTH_ISSUER`
   - `OAUTH_JWKS_SECRET`
   - `OAUTH_CLIENT_ID`
2. Verify OAuth endpoints are accessible from OpenAI
3. Check that redirect URIs match OpenAI configuration
4. Verify JWT signing and verification keys match
5. Review OAuth flow logs for specific errors
6. Ensure OpenID Connect discovery endpoint is accessible

### Build Errors

**Problem**: Build fails with various errors.

**Solution**:

1. Run `pnpm build:deps` to build SolvaPay dependencies first
2. Ensure `PUBLIC_URL` is set for OpenAPI generation (no placeholders!)
3. Run `pnpm generate:docs` before building
4. Check that all environment variables are set
5. Verify TypeScript compilation errors are resolved
6. Check build logs for specific error messages
7. Ensure all dependencies are installed: `pnpm install`

### Authentication Issues

**Problem**: Authentication not working.

**Solution**:

1. Verify Supabase credentials are correct:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_JWT_SECRET`
2. Check that `SUPABASE_JWT_SECRET` matches your Supabase project settings
3. Ensure Supabase project has email/password auth enabled
4. Verify middleware is properly extracting user ID
5. Check that access tokens are being sent in Authorization header
6. Review middleware logs for authentication errors
7. Verify Supabase project is active and accessible

### Subscription Issues

**Problem**: Subscription checks failing or incorrect.

**Solution**:

1. Check that `NEXT_PUBLIC_AGENT_REF` matches your SolvaPay agent
2. Verify `SOLVAPAY_SECRET_KEY` is correct and has proper permissions
3. Check network tab for API errors and status codes
4. Verify customer reference is properly set
5. Ensure subscription sync is called after authentication
6. Check SolvaPay dashboard for subscription status
7. Review API logs for detailed error messages

### OpenAPI Schema Issues

**Problem**: OpenAI can't import OpenAPI schema.

**Solution**:

1. Verify `PUBLIC_URL` is set correctly (no placeholders!)
2. Check that `/api/docs/json` endpoint is accessible
3. Verify schema includes proper `operationId` for all endpoints
4. Check that server URL in schema matches your actual domain
5. Ensure schema is valid JSON
6. Review OpenAPI generation script for errors
7. Test schema import in OpenAI Custom GPT Actions interface

### Database Issues

**Problem**: Database operations failing.

**Solution**:

1. Verify Supabase database connection string is correct
2. Check that migration has been run: `pnpm init:db`
3. Verify `oauth_refresh_tokens` table exists
4. Check database permissions
5. Review Supabase logs for errors
6. Ensure database is accessible from your deployment

### Port Already in Use

**Problem**: Port 3000 is already in use.

**Solution**:

1. Stop other processes using port 3000
2. Use a different port: `PORT=3001 pnpm dev`
3. Check what's using the port: `lsof -i :3000`

### Module Not Found Errors

**Problem**: Errors about missing modules.

**Solution**:

1. Run `pnpm install` to install dependencies
2. Run `pnpm build:deps` to build SDK packages
3. Verify workspace dependencies are properly linked
4. Check that you're in the correct directory
5. Clear node_modules and reinstall if needed

### Debug Mode

Enable debug logging by setting:

```env
NODE_ENV=development
```

This will show detailed logs for:

- OAuth flow
- Paywall decisions
- API requests
- Authentication flow

## Related Documentation

### Getting Started

- [Examples Overview](../../docs/examples/overview.md) - Overview of all examples
- [Installation Guide](../../docs/getting-started/installation.md) - SDK installation
- [Quick Start Guide](../../docs/getting-started/quick-start.md) - Quick setup guide
- [Core Concepts](../../docs/getting-started/core-concepts.md) - Understanding agents, plans, and paywalls

### Framework Guides

- [Next.js Integration Guide](../../docs/guides/nextjs.md) - Complete Next.js integration guide
- [MCP Server Integration Guide](../../docs/guides/mcp.md) - MCP server patterns
- [Custom Authentication Adapters](../../docs/guides/custom-auth.md) - Custom auth setup
- [Error Handling Guide](../../docs/guides/error-handling.md) - Error handling patterns
- [Webhook Handling Guide](../../docs/guides/webhooks.md) - Webhook integration

### API Reference

- [Server SDK API Reference](../../docs/api/server/) - Complete backend API documentation
- [Next.js SDK API Reference](../../docs/api/next/) - Next.js helper documentation
- [React SDK API Reference](../../docs/api/react/) - React component documentation

### Additional Resources

- [SolvaPay Documentation](https://docs.solvapay.com) - Official documentation
- [OpenAI Custom GPT Actions](https://platform.openai.com/docs/actions) - OpenAI documentation
- [Next.js Documentation](https://nextjs.org/docs) - Next.js framework docs
- [OAuth 2.0 Specification](https://oauth.net/2/) - OAuth 2.0 reference
- [GitHub Repository](https://github.com/solvapay/solvapay-sdk) - Source code and issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This example is part of the SolvaPay SDK and follows the same license terms.
