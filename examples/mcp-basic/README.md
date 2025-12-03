# SolvaPay MCP Basic Example

This example demonstrates how to integrate SolvaPay paywall functionality with an MCP (Model Context Protocol) server using persistent storage simulation.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Code Walkthrough](#code-walkthrough)
- [How Persistence Works](#how-persistence-works)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Best Practices](#best-practices)
- [Production Considerations](#production-considerations)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

## Features

### 🔒 **Agent-Based Access Control**

- Uses `agent` to identify the service/tool suite
- Supports both free tier and paid plan access
- Backend-configurable plans (no hardcoded pricing in SDK)

### 📊 **Persistent Free Tier Tracking**

- **Production-ready demo**: Free tier usage persists across server restarts
- **File-based storage**: Simulates database persistence using JSON files
- **Daily reset logic**: Automatically resets counters each day
- **Concurrent safe**: Handles multiple API calls properly

### 📈 **Usage Analytics**

- Tracks feature usage with `trackUsage()` (not tied to plans)
- Clean separation: Plans control access, features track usage
- Perfect foundation for usage-based pricing models

## How Persistence Works

### **Demo Implementation (Current)**

```typescript
// Data stored in .demo-data/ directory
.demo-data/
├── customers.json      // Customer data and credits
└── free-tier-usage.json // Daily usage tracking per customer/agent/endpoint
```

### **Production Implementation (Required)**

In production, the SolvaPay backend would handle persistence:

```typescript
// Backend API handles all persistence
POST / api / check - limits
POST / api / track - usage
POST / api / create - checkout
```

## Key Benefits

✅ **Server restart resilience** - Free tier counts persist  
✅ **Multi-instance compatible** - Shared storage approach  
✅ **Development realistic** - Mirrors production behavior  
✅ **Alpha launch ready** - Transparent about requirements

## Quick Start

### Prerequisites

1. **Install dependencies**:

   ```bash
   cd examples/mcp-basic
   pnpm install
   ```

2. **Build SDK packages** (from workspace root):
   ```bash
   pnpm build:packages
   ```

### Run the MCP Server

#### Stdio Mode (Default)

The server runs in stdio mode by default, which is used by MCP clients:

```bash
pnpm dev
```

The server will start and listen for MCP client connections via stdio.

#### Streamable HTTP Mode (External Access)

To expose the MCP server externally via HTTP SSE (Server-Sent Events), set the `MCP_TRANSPORT` environment variable:

```bash
MCP_TRANSPORT=http MCP_PORT=3003 pnpm dev
```

Or create a `.env` file:

```bash
MCP_TRANSPORT=http
MCP_PORT=3003
MCP_HOST=localhost  # or 0.0.0.0 to bind to all interfaces
```

**Features:**
- ✅ Uses official `@modelcontextprotocol/sdk` SSEServerTransport
- ✅ Server-Sent Events (SSE) streaming support
- ✅ Session management (handled by SDK)
- ✅ Standard Express integration

**MCP Endpoint:**
- `GET /mcp` - Open SSE stream. Returns `endpoint` event with session-specific POST URL.
- `POST /message?sessionId=...` - Send JSON-RPC messages (SDK handles routing).

**Example usage with MCP client:**

For HTTP/SSE, the client flow is:

1. **Connect to SSE Endpoint**:
   ```bash
   curl -N http://localhost:3003/mcp
   ```
   Server responds with an `endpoint` event containing the POST URL:
   ```
   event: endpoint
   data: /message?sessionId=<UUID>
   ```

2. **Send Requests**:
   Use the URL provided in the `data` field (e.g., `http://localhost:3003/message?sessionId=<UUID>`) to send JSON-RPC requests via POST.

   ```bash
   curl -X POST "http://localhost:3003/message?sessionId=<UUID>" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "initialize",
       "params": {
         "protocolVersion": "2024-11-05",
         "capabilities": {},
         "clientInfo": { "name": "test-client", "version": "1.0.0" }
       }
     }'
   ```

**Additional Endpoints:**
- `GET /health` - Health check

### Run Tests

```bash
# Run all tests
pnpm test

# Run just API client tests
npx vitest run src/__tests__/api-client.test.ts

# Run paywall tests
npx vitest run src/__tests__/paywall.test.ts

# Clean test data between runs
rm -rf .demo-data
```

### See Persistence in Action

1. **Start the server** and make some API calls
2. **Stop the server**
3. **Check the data files**:
   ```bash
   cat .demo-data/customers.json
   cat .demo-data/free-tier-usage.json
   ```
4. **Restart the server** - usage counts will be remembered!

## Code Walkthrough

This section provides a detailed walkthrough of how SolvaPay integrates with MCP servers.

### Step 1: Initialize SolvaPay

The example uses a stub client for local development:

```typescript
// src/index.ts
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'

// Create stub client (in-memory for tests, file-based for demo)
const apiClient = createStubClient({
  useFileStorage: false, // In-memory for tests
  freeTierLimit: 3, // 3 free calls per day
  debug: true,
})

// Initialize SolvaPay
const solvaPay = createSolvaPay({
  apiClient,
})
```

**For Production**: Replace with real API client:

```typescript
import { createSolvaPayClient } from '@solvapay/server'

const apiClient = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
  baseUrl: process.env.SOLVAPAY_API_BASE_URL,
})
```

### Step 2: Create Payable Handler

Create a payable handler for MCP tools:

```typescript
// Create payable handler with agent configuration
const payable = solvaPay.payable({
  agent: 'basic-crud', // Agent identifier
})
```

**Note**: MCP servers typically use a single agent for all tools, but you can use different agents per tool if needed.

### Step 3: Define MCP Tools

Define your MCP tools with proper schemas:

```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js'

const tools: Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the task to create',
        },
        description: {
          type: 'string',
          description: 'Optional description of the task',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['title'],
    },
  },
  // ... more tools
]
```

### Step 4: Wrap Business Logic

Wrap your business logic functions with the MCP adapter:

```typescript
// Business logic function
async function createTaskMCP(args: CreateTaskArgs) {
  const result = await createTask(args)
  return {
    success: result.success,
    message: 'Task created successfully',
    task: result.task,
  }
}

// Wrap with MCP adapter
const handler = payable.mcp(createTaskMCP)
```

### Step 5: Handle Tool Execution

In your MCP server's tool handler:

```typescript
server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'create_task': {
      const handler = payable.mcp(createTaskMCP)
      return await handler(args as CreateTaskArgs)
    }
    // ... other tools
  }
})
```

### Step 6: Request Flow

Here's what happens when an MCP client calls a tool:

1. **MCP client** sends tool call request
2. **MCP server** receives request with tool name and arguments
3. **MCP adapter** extracts `customer_ref` from `args.auth.customer_ref`
4. **Checks limits** via SolvaPay API (or stub client)
5. **If within limits**: Execute business logic function
6. **If limit exceeded**: Return MCP error with checkout URL
7. **Format response** as MCP tool result

### Step 7: Error Handling

The MCP adapter automatically handles errors:

```typescript
// PaywallError is automatically caught and formatted as MCP error:
{
  "error": {
    "code": -32000,
    "message": "Payment required",
    "data": {
      "checkoutUrl": "https://checkout.solvapay.com/...",
      "agent": "basic-crud",
      "remaining": 0
    }
  }
}
```

### Key Differences from HTTP Adapter

1. **Customer Reference**: Extracted from `args.auth.customer_ref` instead of headers
2. **Response Format**: Returns MCP tool result format instead of HTTP response
3. **Error Format**: Returns MCP error format instead of HTTP status codes
4. **Transport**: Uses stdio instead of HTTP

## Configuration

### Agent-Based Configuration

```typescript
const paywallMetadata = {
  agent: 'basic-crud', // Agent identifier
}
```

### Endpoint-Specific Metering

```typescript
// Different endpoints can use different agents
const tools = [
  { agent: 'list-api' }, // List operations
  { agent: 'ai-analyzer' }, // AI analysis
  { agent: 'premium-api' }, // Premium features
]
```

## Production Considerations

### **Required for Production**

1. **Database persistence** - Replace file-based storage
2. **Distributed locks** - For concurrent access safety
3. **Rate limiting** - Additional protection
4. **Monitoring** - Track usage patterns and errors

### **Recommended for Production**

1. **Redis caching** - Fast access to usage counts
2. **Event sourcing** - Audit trail of all usage
3. **Backup strategy** - Don't lose usage data
4. **Analytics integration** - Business intelligence

## Architecture

```
MCP Client → MCP Server → SolvaPay SDK → Demo Storage
                                      ↓
Production: MCP Server → SolvaPay SDK → SolvaPay API → Database
```

This demo shows exactly how the production flow would work, just with local file storage instead of a remote API and database.

## Best Practices

### 1. Customer Reference in Tool Arguments

Always include `auth.customer_ref` in your tool schemas:

```typescript
{
  auth: {
    type: 'object',
    properties: {
      customer_ref: { type: 'string' }
    }
  }
}
```

### 2. Use Stub Client for Development

Use the stub client during development to avoid API costs:

```typescript
const apiClient = createStubClient({
  useFileStorage: true, // Persist across restarts
  freeTierLimit: 3,
  debug: true,
})
```

### 3. Separate Business Logic

Keep business logic separate from MCP adapter:

```typescript
// ✅ Good: Separate function
async function createTaskMCP(args: CreateTaskArgs) {
  return await createTask(args)
}

const handler = payable.mcp(createTaskMCP)

// ❌ Bad: Inline logic
const handler = payable.mcp(async args => {
  // Logic here makes testing harder
})
```

### 4. Error Messages

Provide clear error messages in MCP responses:

```typescript
async function createTaskMCP(args: CreateTaskArgs) {
  try {
    return await createTask(args)
  } catch (error) {
    return {
      success: false,
      error: error.message,
      // MCP adapter will format this properly
    }
  }
}
```

### 5. Tool Descriptions

Always include clear descriptions in tool schemas:

```typescript
{
  name: 'create_task',
  description: 'Create a new task (requires payment after free tier)',
  // ...
}
```

### 6. Testing

Use in-memory storage for tests:

```typescript
const apiClient = createStubClient({
  useFileStorage: false, // In-memory for tests
  freeTierLimit: 3,
})
```

## Testing

This example includes comprehensive tests for MCP integration.

### Automated Client Test

We provide a script to simulate a client connecting to the server:

```bash
# 1. Start the server (terminal 1)
MCP_TRANSPORT=http MCP_PORT=3003 pnpm dev

# 2. Run the test client (terminal 2)
MCP_PORT=3003 pnpm test:client
```

### Manual Testing with Postman/Curl

See [Testing with Postman](docs/POSTMAN_TESTING.md) for detailed instructions on how to test the SSE-based transport.

### Running Automated Tests

```bash
# Run all tests
pnpm test

# Run specific test suites
npx vitest run src/__tests__/api-client.test.ts
npx vitest run src/__tests__/paywall.test.ts

# Watch mode
pnpm test:watch
```

### What's Tested

- ✅ MCP tool execution with paywall protection
- ✅ Free tier limit enforcement
- ✅ Paywall error formatting
- ✅ Customer reference extraction
- ✅ Persistence across restarts (file storage)
- ✅ Concurrent requests handling

### Test Structure

```
src/__tests__/
├── api-client.test.ts    # API client tests
└── paywall.test.ts       # Paywall integration tests
```

## Troubleshooting

### MCP Client Can't Connect

**Problem**: MCP client cannot connect to server.

**Solution**:

1. Ensure server is running: `pnpm start`
2. Check that stdio transport is configured correctly
3. Verify MCP client configuration matches server

### Paywall Not Triggering

**Problem**: Making tool calls but paywall never triggers.

**Solution**:

1. Check that `auth.customer_ref` is included in tool arguments
2. Verify stub client is configured correctly
3. Check console logs for debug information
4. Ensure you're making requests to protected tools

### Persistence Not Working

**Problem**: Usage counts reset after server restart.

**Solution**:

1. Check that `useFileStorage: true` is set
2. Verify `.demo-data/` directory is writable
3. Check file permissions
4. Review console logs for storage errors

### Tool Execution Errors

**Problem**: Tools return errors even when within limits.

**Solution**:

1. Verify tool schema matches function signature
2. Check that `customer_ref` is provided in `args.auth`
3. Review error messages in console
4. Ensure business logic functions return correct format

### TypeScript Errors

**Problem**: Type errors in tool handlers.

**Solution**:

1. Ensure function signature matches `PayableFunction` type
2. Check that return type is correct
3. Verify argument types match tool schema
4. Review TypeScript configuration

### Test Failures

**Problem**: Tests are failing.

**Solution**:

1. Ensure in-memory storage is used (`useFileStorage: false`)
2. Clean test data: `rm -rf .demo-data`
3. Check that test environment is isolated
4. Review test logs for specific errors

## Related Documentation

### Getting Started

- [Examples Overview](../../docs/examples/overview.md) - Overview of all examples
- [Installation Guide](../../docs/getting-started/installation.md) - SDK installation
- [Core Concepts](../../docs/getting-started/core-concepts.md) - Understanding agents, plans, and paywalls

### Framework Guides

- [MCP Server Integration Guide](../../docs/guides/mcp.md) - Complete MCP integration guide
- [Error Handling Guide](../../docs/guides/error-handling.md) - Error handling patterns
- [Testing Guide](../../docs/guides/testing.md) - Testing with stub mode

### API Reference

- [Server SDK API Reference](../../docs/api/server/) - Complete API documentation
- [Server SDK README](../../packages/server/README.md) - Package documentation

### Additional Resources

- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
- [SolvaPay Documentation](https://docs.solvapay.com) - Official documentation
- [GitHub Repository](https://github.com/solvapay/solvapay-sdk) - Source code and issues

## API Reference

See the main SolvaPay SDK documentation for the complete API reference. This example uses:

- `payable.mcp()` - MCP adapter for tool protection
- `checkLimits()` - Plan access control with persistent free tier
- `trackUsage()` - Feature usage analytics
- `createCheckoutSession()` - Payment flow initiation
- `getOrCreateCustomer()` - Customer management
