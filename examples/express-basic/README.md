# SolvaPay Express Basic Example

A simple Express.js CRUD API demonstrating SolvaPay paywall protection.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Code Walkthrough](#code-walkthrough)
- [API Endpoints](#api-endpoints)
- [Usage Examples](#usage-examples)
- [Testing the Paywall](#testing-the-paywall)
- [Architecture](#architecture)
- [Key Implementation Details](#key-implementation-details)
- [Error Responses](#error-responses)
- [Best Practices](#best-practices)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

## Features

- ✅ **Express.js** REST API with full CRUD operations
- ✅ **SolvaPay Paywall** protection on all endpoints
- ✅ **Demo Mode**: Uses stub client - no backend required
- ✅ **Auto Port Detection**: Finds next available port automatically
- ✅ **Plan-Based Limits**: Different limits for different operations
- ✅ **Clean Architecture**: Separated business logic and route handlers

## Quick Start

### 1. Install Dependencies

```bash
cd examples/express-basic
pnpm install
```

### 2. Run the Example

No configuration needed! Uses a stub client that simulates the backend:

```bash
pnpm dev
```

**Demo Mode:**
- No backend required
- 5 free calls per day per plan
- Local usage tracking (resets daily)

## API Endpoints

### Unprotected Endpoints

- `GET /` - API information and documentation
- `GET /health` - Health check

### Protected Endpoints (Paywall)

All require `x-customer-ref` header for user identification:

- `POST /tasks` - Create a new task (plan: `create-task`)
- `GET /tasks` - List all tasks (plan: `list-tasks`)
- `GET /tasks/:id` - Get a specific task (plan: `get-task`)
- `DELETE /tasks/:id` - Delete a task (plan: `delete-task`)

## Usage Examples

### Create a Task

```bash
curl -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -H "x-customer-ref: demo_user" \
  -d '{"title": "My first task", "description": "Testing paywall"}'
```

### List Tasks

```bash
curl http://localhost:3001/tasks \
  -H "x-customer-ref: demo_user"
```

### Get a Specific Task

```bash
curl http://localhost:3001/tasks/task_1 \
  -H "x-customer-ref: demo_user"
```

### Delete a Task

```bash
curl -X DELETE http://localhost:3001/tasks/task_1 \
  -H "x-customer-ref: demo_user"
```

## Testing the Paywall

Make 6+ requests with the same `x-customer-ref` to trigger the paywall:

```bash
# These will succeed (1-5)
for i in {1..5}; do
  curl -X POST http://localhost:3001/tasks \
    -H "Content-Type: application/json" \
    -H "x-customer-ref: demo_user" \
    -d "{\"title\": \"Task $i\"}"
  echo ""
done

# This will return 402 Payment Required (6th call)
curl -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -H "x-customer-ref: demo_user" \
  -d '{"title": "Task 6"}'
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |

## Architecture

```
┌─────────────────┐
│  Express App    │
├─────────────────┤
│ Business Logic  │
│  - createTask   │
│  - getTask      │
│  - listTasks    │
│  - deleteTask   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ SolvaPay SDK    │
│ createHttpHandler()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Stub Client    │
│  (Demo Mode)    │
└─────────────────┘
```

## Code Structure

```
src/
├── index.ts              # Main Express app with routes
└── __tests__/
    └── api.test.ts       # Integration tests
```

## Code Walkthrough

This section provides a detailed walkthrough of how the example is structured and how SolvaPay integrates with Express.js.

### Step 1: Initialize SolvaPay

The example uses a stub client for local development, which simulates the SolvaPay backend without requiring API keys:

```typescript
// src/index.ts
import { createSolvaPay } from '@solvapay/server';
import { createStubClient } from '../../shared/stub-api-client';

// Create stub client for demo (no backend required)
const apiClient = createStubClient({
  freeTierLimit: 5,  // 5 free calls per day
  debug: true         // Enable debug logging
});

// Initialize SolvaPay with the stub client
const solvaPay = createSolvaPay({
  apiClient
});
```

**For Production**: Replace the stub client with a real API client:

```typescript
import { createSolvaPayClient } from '@solvapay/server';

const apiClient = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
  baseUrl: process.env.SOLVAPAY_API_BASE_URL
});

const solvaPay = createSolvaPay({ apiClient });
```

### Step 2: Create Payable Handler

Create a payable handler that will protect your endpoints:

```typescript
// Create payable handler with agent and plan configuration
const payable = solvaPay.payable({ 
  agent: 'agt_NO8WYSX5',  // Your agent reference
  plan: 'pln_MUKDWQZZ'    // Your plan reference
});
```

**Note**: The agent and plan references should match what you've configured in your SolvaPay dashboard.

### Step 3: Protect Endpoints

Wrap your business logic functions with the HTTP adapter:

```typescript
// Import business logic functions
import { createTask, getTask, listTasks, deleteTask } from '@solvapay/demo-services';

// Protect endpoints using the HTTP adapter
app.post('/tasks', payable.http(createTask));
app.get('/tasks/:id', payable.http(getTask));
app.get('/tasks', payable.http(listTasks));
app.delete('/tasks/:id', payable.http(deleteTask));
```

### Step 4: Business Logic Functions

Your business logic functions receive parsed request data and authentication info:

```typescript
// Example business logic function signature
async function createTask(args: {
  title: string;
  description?: string;
  auth?: {
    customer_ref?: string;  // Extracted from x-customer-ref header
  };
}): Promise<{ success: boolean; task: Task }> {
  // Your business logic here
  const task = {
    id: `task_${Date.now()}`,
    title: args.title,
    description: args.description,
    createdAt: new Date().toISOString()
  };
  
  return {
    success: true,
    task
  };
}
```

**Key Points**:
- The `auth` object contains customer identification extracted from headers
- The function receives parsed JSON body and route parameters
- Return value is automatically formatted as JSON response
- Errors are automatically handled by the adapter

### Step 5: Request Flow

Here's what happens when a request comes in:

1. **Request arrives** at Express route
2. **HTTP adapter intercepts** the request
3. **Extracts customer reference** from `x-customer-ref` header
4. **Checks limits** via SolvaPay API (or stub client)
5. **If within limits**: Execute business logic function
6. **If limit exceeded**: Return 402 Payment Required with checkout URL
7. **Format response** as JSON

### Step 6: Error Handling

The adapter automatically handles errors:

```typescript
// PaywallError is automatically caught and formatted
// Returns 402 with checkout URL:
{
  "success": false,
  "error": "Payment required",
  "agent": "agt_NO8WYSX5",
  "checkoutUrl": "https://checkout.solvapay.com/...",
  "message": "Plan subscription required. Remaining: 0"
}

// Other errors are returned as 500 with error message
```

## Key Implementation Details

### Using the HTTP Adapter

The HTTP adapter (`payable.http()`) is a middleware function that:
- Parses request body and route parameters
- Extracts customer reference from headers
- Checks subscription limits
- Executes your business logic
- Formats the response
- Handles errors

### Customer Identification

The adapter extracts the customer reference from the `x-customer-ref` header:

```bash
curl -H "x-customer-ref: user_123" http://localhost:3001/tasks
```

**Production Tip**: In production, you'd typically extract this from:
- JWT tokens
- Session data
- Authentication middleware

### Plan Configuration

Each endpoint can use the same plan or different plans:

```typescript
// Same plan for all endpoints
const payable = solvaPay.payable({ agent: 'my-agent', plan: 'my-plan' });

// Different plans per endpoint
const createPayable = solvaPay.payable({ agent: 'my-agent', plan: 'create-plan' });
const readPayable = solvaPay.payable({ agent: 'my-agent', plan: 'read-plan' });

app.post('/tasks', createPayable.http(createTask));
app.get('/tasks', readPayable.http(listTasks));
```

### Business Logic Functions

Your functions should:
- Accept parsed arguments (body + params + auth)
- Return a result object
- Handle business logic errors
- Be async (return Promises)

## Error Responses

### 402 Payment Required

Returned when user exceeds their plan limits:

```json
{
  "success": false,
  "error": "Payment required",
  "agent": "express-tasks-api",
  "checkoutUrl": "https://checkout.solvapay.com/...",
  "message": "Plan subscription required. Remaining: 0"
}
```

### 404 Not Found

Returned when a task doesn't exist:

```json
{
  "success": false,
  "error": "Task not found"
}
```

### 400 Bad Request

Returned for validation errors:

```json
{
  "success": false,
  "error": "Title is required"
}
```

## Best Practices

### 1. Use Stub Client for Development

Always use the stub client during development to avoid API rate limits and costs:

```typescript
const apiClient = createStubClient({
  freeTierLimit: 5,
  debug: true
});
```

### 2. Separate Business Logic

Keep your business logic separate from route handlers:

```typescript
// ✅ Good: Business logic in separate function
app.post('/tasks', payable.http(createTask));

// ❌ Bad: Business logic in route handler
app.post('/tasks', payable.http(async (args) => {
  // Logic here makes testing harder
}));
```

### 3. Handle Missing Customer Reference

Always validate that customer reference is present:

```typescript
async function createTask(args: {
  title: string;
  auth?: { customer_ref?: string };
}) {
  if (!args.auth?.customer_ref) {
    throw new Error('Customer reference required');
  }
  // ... rest of logic
}
```

### 4. Use Environment Variables

Store configuration in environment variables:

```typescript
const solvaPay = createSolvaPay({
  apiClient: process.env.USE_STUB_CLIENT === 'true'
    ? createStubClient({ freeTierLimit: 5 })
    : createSolvaPayClient({
        apiKey: process.env.SOLVAPAY_SECRET_KEY!,
        baseUrl: process.env.SOLVAPAY_API_BASE_URL
      })
});
```

### 5. Error Handling

The adapter handles PaywallError automatically, but handle other errors:

```typescript
async function createTask(args: CreateTaskArgs) {
  try {
    // Your logic
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error; // Adapter will format as 400
    }
    throw error; // Adapter will format as 500
  }
}
```

### 6. Testing

Use the stub client in tests for fast, reliable testing:

```typescript
import { createStubClient } from '../../shared/stub-api-client';

const apiClient = createStubClient({ freeTierLimit: 5 });
const solvaPay = createSolvaPay({ apiClient });
```

## Troubleshooting

### Port Already in Use

**Problem**: Port 3001 is already in use.

**Solution**: The server automatically finds the next available port:

```
⚠️  Port 3001 is in use, trying 3002...
```

You can also set a custom port:

```bash
PORT=3005 pnpm dev
```

### "Module not found" Errors

**Problem**: Errors like `Cannot find module '@solvapay/server'`.

**Solution**: Build the SDK packages from the workspace root:

```bash
# From workspace root
pnpm build:packages
```

Then restart the example server.

### Paywall Not Triggering

**Problem**: Making requests but paywall never triggers.

**Solution**: 
1. Check that you're using the same `x-customer-ref` header value
2. Verify the stub client is configured correctly
3. Check console logs for debug information
4. Ensure you're making requests to protected endpoints

### 402 Response Without Checkout URL

**Problem**: Getting 402 but no `checkoutUrl` in response.

**Solution**: 
1. Check that agent and plan references are correct
2. Verify stub client configuration
3. In production, ensure API key is valid
4. Check network tab for API errors

### Business Logic Not Executing

**Problem**: Requests return errors before reaching business logic.

**Solution**:
1. Check that `x-customer-ref` header is present
2. Verify function signature matches expected format
3. Check that function returns a Promise
4. Review error logs for specific issues

### Tests Failing

**Problem**: Tests are failing with various errors.

**Solution**:
1. Ensure stub client is used in tests
2. Check that test data is cleaned up between runs
3. Verify test environment variables are set
4. Run tests with `--reporter=verbose` for more details

### TypeScript Errors

**Problem**: Type errors in business logic functions.

**Solution**:
1. Ensure function signature matches `PayableFunction` type
2. Check that return type is a Promise
3. Verify argument types match what adapter provides
4. Review TypeScript configuration

## Testing

This example includes tests to verify the Express integration with SolvaPay.

### Running Tests

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage
```

### What's Tested

The test suite (`api.test.ts`) verifies:

- ✅ Unprotected routes (health check, API info)
- ✅ Paywall protection on protected endpoints
- ✅ Free tier enforcement (5 operations per user)
- ✅ Blocking after limit exceeded
- ✅ Per-user usage isolation
- ✅ Consistent limit tracking across operations
- ✅ Error handling (missing customer_ref, etc.)
- ✅ Concurrent requests from different users

**No setup required** - tests use the stub client by default for fast, reliable testing.

### Example Test Output

```
✓ Express Basic API - Paywall Tests (8 tests)
  ✓ Unprotected Routes
  ✓ Paywall Free Tier
  ✓ Paywall Error Handling
  ✓ Paywall Isolation
```

### SDK Integration Tests

For comprehensive backend integration tests of the SolvaPay SDK itself, see the [Server SDK tests](../../packages/server/__tests__/).

## Related Documentation

### Getting Started
- [Examples Overview](../../docs/examples/overview.md) - Overview of all examples
- [Installation Guide](../../docs/getting-started/installation.md) - SDK installation
- [Quick Start Guide](../../docs/getting-started/quick-start.md) - 5-minute Express setup
- [Core Concepts](../../docs/getting-started/core-concepts.md) - Understanding agents, plans, and paywalls

### Framework Guides
- [Express.js Integration Guide](../../docs/guides/express.md) - Complete Express integration guide
- [Error Handling Guide](../../docs/guides/error-handling.md) - Error handling patterns
- [Testing Guide](../../docs/guides/testing.md) - Testing with stub mode

### API Reference
- [Server SDK API Reference](../../docs/api/server/) - Complete API documentation
- [Server SDK README](../../packages/server/README.md) - Package documentation

### Additional Resources
- [SolvaPay Documentation](https://docs.solvapay.com) - Official documentation
- [Express.js Documentation](https://expressjs.com) - Express.js framework docs
- [GitHub Repository](https://github.com/solvapay/solvapay-sdk) - Source code and issues

## License

See the root LICENSE file.

