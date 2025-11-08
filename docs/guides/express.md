# Express.js Integration Guide

This guide shows you how to integrate SolvaPay SDK with Express.js to protect your API endpoints with paywall protection and subscription management.

## Table of Contents

- [Installation](#installation)
- [Basic Setup](#basic-setup)
- [Protecting Endpoints](#protecting-endpoints)
- [Authentication Integration](#authentication-integration)
- [Error Handling](#error-handling)
- [Advanced Usage](#advanced-usage)
- [Complete Example](#complete-example)

## Installation

Install the required packages:

```bash
npm install @solvapay/server express
# or
pnpm add @solvapay/server express
# or
yarn add @solvapay/server express
```

## Basic Setup

### 1. Initialize SolvaPay

Create a SolvaPay instance in your Express app:

```typescript
import express from 'express'
import { createSolvaPay } from '@solvapay/server'

const app = express()
app.use(express.json())

// Initialize SolvaPay
const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY, // Optional: defaults to env var
})

// Create payable handler for your agent
const payable = solvaPay.payable({
  agent: 'agt_YOUR_AGENT_ID',
  plan: 'pln_YOUR_PLAN_ID', // Optional: can be set per endpoint
})
```

### 2. Protect Your First Endpoint

Wrap your business logic with the `payable.http()` adapter:

```typescript
// Your business logic function
async function createTask(req: express.Request) {
  const { title, description } = req.body

  // Your business logic here
  const task = {
    id: Date.now().toString(),
    title,
    description,
    createdAt: new Date().toISOString(),
  }

  return { success: true, task }
}

// Protect the endpoint
app.post('/api/tasks', payable.http(createTask))
```

That's it! The endpoint is now protected. The paywall will:

- Check if the customer has a valid subscription
- Track usage and enforce limits
- Return a paywall error with checkout URL if needed

## Protecting Endpoints

### Multiple Endpoints with Same Plan

If all your endpoints use the same plan, create one `payable` handler:

```typescript
const payable = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_premium',
})

app.post('/api/tasks', payable.http(createTask))
app.get('/api/tasks/:id', payable.http(getTask))
app.delete('/api/tasks/:id', payable.http(deleteTask))
```

### Different Plans per Endpoint

Create multiple `payable` handlers for different plans:

```typescript
const freeTier = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_free',
})

const premiumTier = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_premium',
})

// Free tier endpoint
app.get('/api/tasks', freeTier.http(listTasks))

// Premium tier endpoint
app.post('/api/tasks', premiumTier.http(createTask))
```

### Accessing Request Data

The HTTP adapter passes the Express request object to your business logic:

```typescript
async function createTask(req: express.Request) {
  // Access request body
  const { title } = req.body

  // Access route parameters
  const { id } = req.params

  // Access query parameters
  const { limit } = req.query

  // Access headers
  const authToken = req.headers.authorization

  // Your business logic
  return { success: true, task: { title } }
}

app.post('/api/tasks', payable.http(createTask))
```

## Authentication Integration

SolvaPay needs to identify customers. You can pass customer references in several ways:

### Option 1: Custom Header (Recommended)

Extract customer reference from a custom header:

```typescript
import { getUserIdFromRequest } from '@solvapay/auth'

// Custom middleware to extract customer reference
function extractCustomerRef(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // Extract from header, JWT token, session, etc.
  const customerRef = req.headers['x-customer-ref'] as string

  if (!customerRef) {
    return res.status(401).json({ error: 'Missing customer reference' })
  }

  // Attach to request for SolvaPay to use
  req.customerRef = customerRef
  next()
}

app.use(extractCustomerRef)

// SolvaPay will automatically use req.customerRef
app.post('/api/tasks', payable.http(createTask))
```

### Option 2: JWT Token

Extract customer ID from a JWT token:

```typescript
import jwt from 'jsonwebtoken'
import { getUserIdFromRequest } from '@solvapay/auth'

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ error: 'Missing token' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    req.customerRef = decoded.userId
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

app.use(authMiddleware)
app.post('/api/tasks', payable.http(createTask))
```

### Option 3: Custom Auth Adapter

Create a custom auth adapter for more complex scenarios:

```typescript
import { AuthAdapter } from '@solvapay/auth'

const customAuthAdapter: AuthAdapter = {
  getUserId: async (req: express.Request) => {
    // Your custom logic to extract user ID
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return null

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    return decoded.userId
  },

  getUserEmail: async (req: express.Request) => {
    // Extract email from token or database
    return null // Optional
  },

  getUserName: async (req: express.Request) => {
    // Extract name from token or database
    return null // Optional
  },
}

// Use with payable options
app.post(
  '/api/tasks',
  payable.http(createTask, {
    authAdapter: customAuthAdapter,
  }),
)
```

## Error Handling

### Basic Error Handling

The HTTP adapter automatically handles `PaywallError` and converts it to an HTTP response:

```typescript
import { PaywallError } from '@solvapay/server'

async function createTask(req: express.Request) {
  // Your business logic
  return { success: true, task: {} }
}

// PaywallError is automatically handled
app.post('/api/tasks', payable.http(createTask))
```

### Custom Error Handling

Wrap the handler to customize error responses:

```typescript
async function handlePaywall(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const handler = payable.http(createTask)
    await handler(req, res)
  } catch (error) {
    if (error instanceof PaywallError) {
      // Custom paywall response
      return res.status(402).json({
        error: 'Payment required',
        message: error.message,
        checkoutUrl: error.structuredContent.checkoutUrl,
        plan: error.structuredContent.plan,
        agent: error.structuredContent.agent,
      })
    }

    // Handle other errors
    next(error)
  }
}

app.post('/api/tasks', handlePaywall)
```

### Global Error Handler

Use Express error middleware for consistent error handling:

```typescript
import { PaywallError } from '@solvapay/server'

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof PaywallError) {
    return res.status(402).json({
      error: 'Payment required',
      checkoutUrl: error.structuredContent.checkoutUrl,
      // Include all structured content
      ...error.structuredContent,
    })
  }

  // Handle other errors
  console.error('Unhandled error:', error)
  res.status(500).json({ error: 'Internal server error' })
})
```

## Advanced Usage

### Custom Customer Reference Extraction

Override customer reference extraction per endpoint:

```typescript
app.post(
  '/api/tasks',
  payable.http(createTask, {
    getCustomerRef: (req: express.Request) => {
      // Custom logic to extract customer reference
      return req.headers['x-customer-ref'] as string
    },
  }),
)
```

### Request Metadata

Add custom metadata to requests:

```typescript
app.post(
  '/api/tasks',
  payable.http(createTask, {
    metadata: {
      endpoint: '/api/tasks',
      method: 'POST',
      // Custom metadata
    },
  }),
)
```

### Response Formatting

The HTTP adapter automatically formats responses. Your business logic should return:

- **Object**: Sent as JSON with 200 status
- **Error**: Thrown as exception (PaywallError handled automatically)

```typescript
async function createTask(req: express.Request) {
  // Return object - automatically sent as JSON
  return { success: true, task: {} }

  // Or throw error - automatically handled
  if (!req.body.title) {
    throw new Error('Title is required')
  }
}
```

## Complete Example

Here's a complete Express.js application with SolvaPay integration:

```typescript
import express, { type Express, type Request, type Response } from 'express'
import { createSolvaPay, PaywallError } from '@solvapay/server'

const app: Express = express()
const port = process.env.PORT || 3000

// Middleware
app.use(express.json())

// Initialize SolvaPay
const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY,
})

// Create payable handlers
const payable = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_premium',
})

// Authentication middleware
function authMiddleware(req: Request, res: Response, next: express.NextFunction) {
  const customerRef = req.headers['x-customer-ref'] as string

  if (!customerRef) {
    return res.status(401).json({ error: 'Missing x-customer-ref header' })
  }

  req.customerRef = customerRef
  next()
}

app.use(authMiddleware)

// Business logic functions
async function createTask(req: Request) {
  const { title, description } = req.body

  if (!title) {
    throw new Error('Title is required')
  }

  const task = {
    id: Date.now().toString(),
    title,
    description,
    createdAt: new Date().toISOString(),
  }

  return { success: true, task }
}

async function getTask(req: Request) {
  const { id } = req.params

  // Simulate fetching from database
  const task = {
    id,
    title: 'Sample Task',
    description: 'Task description',
  }

  return { success: true, task }
}

async function listTasks(req: Request) {
  const tasks = [
    { id: '1', title: 'Task 1' },
    { id: '2', title: 'Task 2' },
  ]

  return { success: true, tasks, total: tasks.length }
}

// Protected routes
app.post('/api/tasks', payable.http(createTask))
app.get('/api/tasks/:id', payable.http(getTask))
app.get('/api/tasks', payable.http(listTasks))

// Health check (unprotected)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: express.NextFunction) => {
  if (error instanceof PaywallError) {
    return res.status(402).json({
      error: 'Payment required',
      message: error.message,
      checkoutUrl: error.structuredContent.checkoutUrl,
      plan: error.structuredContent.plan,
      agent: error.structuredContent.agent,
    })
  }

  console.error('Error:', error)
  res.status(500).json({ error: 'Internal server error' })
})

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
```

### Testing the Example

```bash
# Start the server
npm start

# Test with customer reference
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "x-customer-ref: user_123" \
  -d '{"title": "My Task", "description": "Task description"}'
```

## Best Practices

1. **Extract Customer Reference Early**: Use middleware to extract and validate customer references before they reach protected endpoints.

2. **Handle Paywall Errors Gracefully**: Provide clear error messages and checkout URLs to users.

3. **Use Environment Variables**: Store API keys and configuration in environment variables.

4. **Separate Business Logic**: Keep your business logic functions separate from route handlers for better testability.

5. **Type Safety**: Use TypeScript for better type safety and developer experience.

6. **Error Logging**: Log errors appropriately for debugging while keeping sensitive information secure.

## Next Steps

- [Next.js Integration Guide](./nextjs.md) - Learn how to integrate with Next.js
- [Error Handling Strategies](./error-handling.md) - Advanced error handling patterns
- [Custom Authentication Adapters](./custom-auth.md) - Build custom auth adapters
- [API Reference](../api/server/src/README.md) - Full API documentation
