# SolvaPay Next.js OpenAI Custom GPT Actions Example

This example demonstrates how to integrate SolvaPay with Next.js App Router to create OpenAI Custom GPT Actions with paywall protection. It provides the same functionality as the Fastify/Vite example but uses Next.js 15 with the latest App Router.

## Features

- **Next.js 15** with App Router
- **SolvaPay Paywall Protection** with usage limits and plan upgrades
- **OAuth 2.0 Flow** for user authentication
- **CRUD Operations** with different limits for free/pro users
- **Checkout Flow** for seamless plan upgrades
- **TypeScript** support with Zod validation
- **API Routes** using Next.js App Router
- **Comprehensive Testing** with Vitest (88 tests passing)
- **OpenAPI Documentation** auto-generated from Zod schemas

## Quick Start

### 1. Install Dependencies

```bash
cd examples/nextjs-openai-custom-gpt-actions
pnpm install
```

### 2. Setup Environment

```bash
pnpm setup:env
```

This creates a `.env.local` file with the following variables:

```env
SOLVAPAY_SECRET_KEY=demo-key-for-development
SOLVAPAY_AGENT=custom-gpt-actions
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### 3. Build Dependencies

```bash
pnpm build:deps
```

### 4. Start Development Server

```bash
pnpm dev
```

The application will be available at `http://localhost:3000`.

## 🔒 Paywall Protection

This example demonstrates SolvaPay's paywall functionality with different usage limits:

### Free Users
- **List/Read Things**: 5-10 calls per day
- **Create Things**: 3 calls per day  
- **Update Things**: 3 calls per day (premium)
- **Delete Things**: 1 call per day (premium)

### Pro Users
- **Unlimited** access to all operations
- Upgraded via checkout flow

### Testing Paywall
```bash
# Set a user to pro plan
curl "http://localhost:3000/api/debug/set-plan?user_id=demo_user&plan=pro"

# Check user plans
curl "http://localhost:3000/api/debug/user-plans"
```

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
- Create, read, update, and delete "things" 
- Enforce usage limits (3 API calls per day for free users)
- Redirect users to upgrade when limits are exceeded
- Authenticate users via OAuth flow

### 6. Troubleshooting

If you encounter issues when importing the OpenAPI schema:

- **Server URL mismatch**: Make sure your `PUBLIC_URL` environment variable matches your ngrok URL exactly
- **Missing operationId**: The schema now includes proper operationIds for all endpoints
- **OAuth issues**: Verify that your OAuth redirect URLs match your ngrok domain

## Project Structure

```
nextjs-openai-custom-gpt-actions/
├── src/                          # Source code (default directory)
│   ├── app/                      # Next.js App Router
│   │   ├── api/                  # API Routes
│   │   │   ├── health/           # Health check endpoints
│   │   │   ├── user/             # User plan management
│   │   │   ├── oauth/            # OAuth 2.0 endpoints
│   │   │   ├── things/           # CRUD operations
│   │   │   └── checkout/         # Payment flow
│   │   ├── .well-known/          # OpenID Connect discovery
│   │   ├── globals.css           # Global styles
│   │   ├── layout.tsx            # Root layout
│   │   └── page.tsx              # Home page
│   ├── services/                 # Business logic
│   ├── types/                    # TypeScript types
│   ├── middleware/               # Next.js middleware
│   └── __tests__/                # Test files
├── user-plans.json              # User plan storage
├── package.json                 # Dependencies
├── next.config.js               # Next.js configuration
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

## API Endpoints

### Health Endpoints

- `GET /api/health` - Basic health check
- `GET /api/healthz` - Detailed health check with memory usage

### User Plan Management

- `GET /api/user/plan` - Get current user plan and usage
- `POST /api/user/plan/update` - Update user plan (internal)

### OAuth 2.0 Flow

- `GET /.well-known/openid-configuration` - OpenID Connect discovery
- `GET /api/oauth/jwks` - JSON Web Key Set
- `GET /api/oauth/authorize` - Authorization endpoint
- `POST /api/oauth/token` - Token exchange
- `GET /api/oauth/userinfo` - User information

### CRUD Operations (Things)

- `GET /api/things` - List things with pagination
- `POST /api/things` - Create a new thing
- `GET /api/things/[id]` - Get specific thing
- `PUT /api/things/[id]` - Update thing
- `DELETE /api/things/[id]` - Delete thing

### Checkout Flow

- `GET /api/checkout` - Checkout page
- `GET /api/checkout/payment` - Payment confirmation
- `GET /api/checkout/complete` - Success page

## Key Differences from Fastify Example

### 1. App Router Structure

Instead of Fastify route handlers, we use Next.js API routes:

**Fastify:**
```typescript
app.get('/health', async () => ({ status: 'ok' }));
```

**Next.js:**
```typescript
// app/api/health/route.ts
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
```

### 2. Middleware

**Fastify:**
```typescript
app.addHook('preHandler', async (req) => {
  // Add customer reference
});
```

**Next.js:**
```typescript
// src/middleware.ts
export function middleware(request: NextRequest) {
  // Add customer reference to headers
  const customerRef = `demo_${userEmail.replace('@', '_')}`;
  requestHeaders.set('x-customer-ref', customerRef);
}
```

### 3. CORS Handling

**Fastify:**
```typescript
await app.register(import('@fastify/cors'), {
  origin: true,
  credentials: true
});
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
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
  // Parse form data
});
```

**Next.js:**
```typescript
// In API route
const formData = await request.formData();
const email = formData.get('email') as string;
```

## Configuration

### Environment Variables

Create a `.env.local` file with the following variables:

> **⚠️ Important**: The `PUBLIC_URL` and `OPENAI_ACTIONS_BASE_URL` variables are **required** and cannot contain placeholder values like "your-domain" or "your-subdomain". The OpenAPI generation will fail if placeholder URLs are detected to prevent invalid schemas.

```env
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=your-secret-key
SOLVAPAY_AGENT=custom-gpt-actions

# Server Configuration
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# REQUIRED: Public URL (set to your actual ngrok URL - no placeholders allowed!)
PUBLIC_URL=https://your-subdomain.ngrok-free.app
OPENAI_ACTIONS_BASE_URL=https://your-subdomain.ngrok-free.app

# OAuth Configuration
OAUTH_ISSUER=https://your-subdomain.ngrok-free.app
OAUTH_CLIENT_ID=solvapay-demo-client
OAUTH_CLIENT_SECRET=demo-secret-key
OAUTH_REDIRECT_URI=https://chat.openai.com/aip/g-YOUR-GPT-ID/oauth/callback
OAUTH_JWKS_SECRET=your-jwt-secret

# Checkout Configuration
CHECKOUT_BASE_URL=https://your-subdomain.ngrok-free.app
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

3. **Set up Vercel KV (Required for Production)**
   
   **⚠️ IMPORTANT**: This app requires persistent storage for user plans. On Vercel, you must use Vercel KV:
   
   1. Go to your Vercel project → Storage → Create Database
   2. Select **KV (Redis)**
   3. Name it (e.g., `user-plans-kv`)
   4. Click **Create**
   5. Vercel will automatically add the required environment variables:
      - `KV_URL`
      - `KV_REST_API_URL`
      - `KV_REST_API_TOKEN`
      - `KV_REST_API_READ_ONLY_TOKEN`
   
   > **Note**: For local development, the app automatically uses file-based storage (`user-plans.json`). Vercel KV is only needed for production deployments.

4. **Set Required Environment Variables**
   
   **⚠️ CRITICAL**: You **must** set `PUBLIC_URL` in Vercel's environment variables:
   
   ```
   PUBLIC_URL=https://your-app.vercel.app
   ```
   
   This is used as the server URL in the generated OpenAPI specification. Without it, the build will fail.
   
   **How to set it:**
   - Go to your Vercel project → Settings → Environment Variables
   - Add `PUBLIC_URL` with your production URL
   - For preview deployments, you can use `https://$VERCEL_URL` as the value
   
   **Other Required Variables:**
   ```env
   SOLVAPAY_API_KEY=your-production-api-key
   SOLVAPAY_AGENT=custom-gpt-actions
   OAUTH_CLIENT_ID=your-oauth-client-id
   OAUTH_CLIENT_SECRET=your-oauth-client-secret
   OAUTH_JWKS_SECRET=your-jwt-secret
   ```

5. **Deploy**
   - Push to your connected branch
   - Vercel will automatically build and deploy
   - The OpenAPI docs will be generated during build using `PUBLIC_URL`
   - User plans will be stored in Vercel KV (Redis)

#### Vercel Environment Variables Priority

The OpenAPI generation script uses the following priority:
1. **`PUBLIC_URL`** (recommended for production) - explicitly set in Vercel settings
2. **`VERCEL_URL`** (fallback) - automatically provided by Vercel

We recommend using `PUBLIC_URL` for production to have full control over the server URL in your OpenAPI specification.

#### Storage Architecture

This app uses a smart storage adapter that automatically selects the right storage backend:

- **Local Development**: Uses file-based storage (`user-plans.json`) for simplicity
- **Vercel Production**: Uses Vercel KV (Redis) for persistent, distributed storage across serverless functions

This ensures:
- ✅ User plans persist after checkout completion
- ✅ ChatGPT can retrieve updated plans across different function invocations
- ✅ No manual configuration needed - it automatically detects the environment

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

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "SolvaPay API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://your-domain.com/api"
    }
  ],
  "paths": {
    "/things": {
      "get": {
        "operationId": "listThings",
        "summary": "List things"
      },
      "post": {
        "operationId": "createThing",
        "summary": "Create a thing"
      }
    }
  }
}
```

## 🧪 Testing

### Run All Tests
```bash
npm test           # All tests
npm run test:backend    # Backend API tests only  
npm run test:ui-components  # UI component tests only
npm run test:watch     # Watch mode
```

### Test Coverage
- **Comprehensive test suite** covering all functionality ✅
- **Backend Tests**: Paywall protection, CRUD operations, OAuth flow, checkout functionality
- **UI Tests**: Component rendering and user interactions
- **SDK Tests**: Core paywall functionality tested in the SDK package

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure your domain is configured in CORS settings
2. **OAuth Issues**: Check that all OAuth environment variables are set
3. **Build Errors**: Run `pnpm build:deps` to build SolvaPay dependencies
4. **Paywall Issues**: Use debug endpoints to check/set user plans

### Debug Mode

Enable debug logging by setting:

```env
NODE_ENV=development
```

This will show detailed logs for OAuth flow and paywall decisions.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This example is part of the SolvaPay SDK and follows the same license terms.
