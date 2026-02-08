# SolvaPay SDK Examples

This directory contains example applications demonstrating how to use the SolvaPay SDK in different environments.

## Shared Utilities

The `shared/` folder contains reusable utilities used across multiple examples:

- **`stub-api-client.ts`** - A demo implementation of the SolvaPay API client for local development
  - ✅ No backend required
  - ✅ Simulates free tier limits and paid access
  - ✅ In-memory or file-based persistence
  - ✅ Drop-in replacement for `createSolvaPayClient()`

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

### Next.js OpenAI Custom GPT Actions (`nextjs-openai-custom-gpt-actions`)

A Next.js application with React payment components demonstrating:

- Payment flow using `SolvaPayProvider` and `PaymentForm`
- Stripe integration for payment processing
- Interactive checkout UI
- OpenAI Custom GPT Actions integration

**Run the example:**

```bash
cd examples/nextjs-openai-custom-gpt-actions
pnpm install
pnpm dev
```

The application will start on `http://localhost:3000`

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

### MCP Basic (`mcp-basic`)

A Model Context Protocol (MCP) server integration demonstrating:

- Paywall protection for MCP server endpoints
- Integration with OpenAI and other MCP-compatible tools
- Payment flow for MCP server usage

**Run the example:**

```bash
cd examples/mcp-basic
pnpm install
pnpm dev
```

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

   # Next.js OpenAI Custom GPT Actions example
   cd examples/nextjs-openai-custom-gpt-actions
   pnpm dev

   # Checkout demo example
   cd examples/checkout-demo
   pnpm dev

   # MCP basic example
   cd examples/mcp-basic
   pnpm dev
   ```

3. **Watch for changes:**
   The examples are configured to automatically restart when you make changes to the SDK packages.

## Key Features Demonstrated

- **Workspace Dependencies**: Examples use `workspace:*` to reference local packages
- **Hot Reloading**: Changes to SDK packages trigger example restarts
- **TypeScript Support**: Full type safety across the monorepo
- **Modern Tooling**: Uses tsup, nodemon, and Next.js for optimal development experience
