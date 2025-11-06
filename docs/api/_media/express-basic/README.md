# SolvaPay Express Basic Example

A simple Express.js CRUD API demonstrating SolvaPay paywall protection.

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

## Key Implementation Details

### Using createHttpHandler()

```typescript
// Initialize with stub client (demo mode)
const apiClient = createStubClient({ freeTierLimit: 5, debug: true });
const solvaPay = createPaywall({ apiClient });

// Protect a business logic function
app.post('/tasks', solvaPay.createHttpHandler(
  { agent: 'express-tasks-api', plan: 'create-task' },
  createTask  // Your business logic function
));
```

### Business Logic Functions

```typescript
async function createTask(args: { 
  title: string; 
  description?: string;
  auth?: { customer_ref?: string };
}): Promise<{ success: boolean; task: Task }> {
  // Your logic here
  return { success: true, task };
}
```

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

## Troubleshooting

### Port Already in Use

The server automatically finds the next available port:

```
⚠️  Port 3001 is in use, trying 3002...
```

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

## Learn More

- [SolvaPay Documentation](https://docs.solvapay.com)
- [Express.js Documentation](https://expressjs.com)
- [Server SDK README](../../packages/server/README.md)

## License

See the root LICENSE file.

