# SolvaPay SDK Examples

This directory contains example applications demonstrating how to use the SolvaPay SDK in different environments.

## Shared Utilities

The `shared/` folder contains reusable utilities used across multiple examples:

- **`stub-api-client.ts`** - A demo implementation of the SolvaPay API client for local development
  - No backend required
  - Simulates free tier limits and paid access
  - In-memory or file-based persistence
  - Drop-in replacement for `createSolvaPayClient()`

See [`shared/README.md`](./shared/README.md) for detailed documentation.

## Available Examples

### Express Basic (`express-basic`)

A simple Express.js server demonstrating:

- Paywall protection for CRUD API endpoints
- Customer identification via headers
- Free tier limits with automatic checkout URLs
- Stub mode for local development (uses shared stub client)
- Production mode with real backend API

**Run the example:**

```bash
cd examples/express-basic
pnpm install
pnpm dev  # Runs in stub mode by default (no API key needed)
```

To use production mode:

```bash
# Set up environment
cp .env.example .env
# Edit .env with your actual API key and set USE_REAL_BACKEND=true

pnpm dev
```

The server will start on `http://localhost:3001`

**API Endpoints:**

- `GET /` - API info and usage instructions
- `GET /health` - Server status
- `POST /tasks` - Create a task (protected)
- `GET /tasks` - List all tasks (protected)
- `GET /tasks/:id` - Get a specific task (protected)
- `DELETE /tasks/:id` - Delete a task (protected)

### Checkout Demo (`checkout-demo`)

A full-featured Next.js checkout application demonstrating:

- Complete checkout flow with plan selection
- Customer authentication and session management
- Purchase status checking
- Payment intent creation and processing
- Modern UI with Tailwind CSS

**Run the example:**

```bash
cd examples/checkout-demo
pnpm install
pnpm dev
```

The application will start on `http://localhost:3000`

### Supabase Edge Functions (`supabase-edge`)

A reference project demonstrating:

- One-liner Supabase Edge Functions using `@solvapay/server/fetch`
- All 10 payment/purchase endpoints as 2-line files
- Deno import map for npm packages
- CORS configuration for production

This is a **Deno reference project**, not a Node.js workspace member. It runs via the Supabase CLI, not `pnpm dev`.

**Setup:**

```bash
cd examples/supabase-edge
# See README.md for Supabase CLI setup, secrets, and deploy instructions
```

### MCP OAuth Bridge (`mcp-oauth-bridge`)

A non-hosted MCP server example demonstrating:

- Local `/.well-known/*` discovery endpoints
- OAuth + dynamic client registration against SolvaPay backend
- Bearer-token protected `/mcp` endpoint with RFC9728 challenge responses
- `payable.mcp()` with customer identity from OAuth context

**Run the example:**

```bash
cd examples/mcp-oauth-bridge
pnpm install
cp .env.example .env
pnpm dev
```

### MCP Time App (`mcp-time-app`)

A Model Context Protocol (MCP) app example demonstrating:

- MCP app UI resources with `@modelcontextprotocol/ext-apps`
- OAuth-protected MCP endpoint
- Paywall protection for MCP tools
- A simple app surface we continue developing

**Run the example:**

```bash
cd examples/mcp-time-app
pnpm install
cp .env.example .env
pnpm dev
```

### Supabase Edge MCP (`supabase-edge-mcp`)

A full SolvaPay MCP server running on **Supabase Edge Functions**. Ships
the same paywalled demo toolbox as `mcp-checkout-app`, but over
`createSolvaPayMcpFetchHandler` (Web-standards `Request`/`Response`)
instead of Express. The canonical Deno consumer for
`@solvapay/mcp-fetch` — its `deno check` run is wired as a required CI
gate before every `mcp-fetch` snapshot publish.

```bash
cd examples/supabase-edge-mcp
pnpm install
pnpm build                       # bundle mcp-app.html + copy into ./supabase/functions/mcp/
supabase secrets set \
  SOLVAPAY_SECRET_KEY=sk_live_... \
  SOLVAPAY_PRODUCT_REF=prod_... \
  MCP_PUBLIC_BASE_URL=https://<your-project-ref>.supabase.co/functions/v1/mcp
pnpm deploy                      # supabase functions deploy mcp
```

See [`supabase-edge-mcp/README.md`](./supabase-edge-mcp/README.md) for
full setup, the two-import-map trick for local dev vs. production, and
the Deno type-check gate details.

The Express example requires environment variables for configuration:

### Express Example

```bash
cd examples/express-basic
cp .env.example .env
# Edit .env with your actual API key (optional - runs in stub mode without it)
```

### Environment Variables

**Express Example (.env):**

```bash
# Optional: Enable real backend (defaults to stub mode)
USE_REAL_BACKEND=false

# Required if USE_REAL_BACKEND=true: Get your API key from the SolvaPay dashboard
SOLVAPAY_SECRET_KEY=your_secret_key_here

# Optional: Custom API base URL
SOLVAPAY_API_BASE_URL=https://api.solvapay.dev

# Optional: Server port (defaults to 3001)
PORT=3001
```

**Next.js examples work out of the box** - they require API routes on the backend to handle payment intent creation.

## Development Workflow

1. **Build packages first:**

   ```bash
   pnpm build:packages
   ```

2. **Run examples in development mode:**

   ```bash
   # Express example (runs in stub mode by default)
   cd examples/express-basic
   pnpm dev

   # Checkout demo example
   cd examples/checkout-demo
   pnpm dev

   # MCP OAuth bridge example
   cd examples/mcp-oauth-bridge
   pnpm dev

   # MCP app example
   cd examples/mcp-time-app
   pnpm dev
   ```

3. **Supabase Edge Functions examples:**
   `supabase-edge` (one-liner `@solvapay/server/fetch` endpoints) and
   `supabase-edge-mcp` (full MCP server via `@solvapay/mcp/fetch`) both
   use Deno and run via the Supabase CLI instead of `pnpm dev`:

   ```bash
   # One-liner SolvaPay endpoints
   cd examples/supabase-edge
   supabase start
   supabase functions serve

   # Full SolvaPay MCP server on Supabase Edge
   cd examples/supabase-edge-mcp
   pnpm build          # bundle the iframe UI into ./supabase/functions/mcp/
   supabase functions serve mcp --import-map supabase/functions/mcp/deno.local.json
   ```

4. **Watch for changes:**
   The Node.js examples are configured to automatically restart when you make changes to the SDK packages.

## Key Features Demonstrated

- **Workspace Dependencies**: Examples use `workspace:*` to reference local packages
- **Hot Reloading**: Changes to SDK packages trigger example restarts
- **TypeScript Support**: Full type safety across the monorepo
- **Modern Tooling**: Uses tsup, nodemon, and Next.js for optimal development experience
