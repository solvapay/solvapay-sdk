# Error Handling Strategies

This guide covers error handling patterns and best practices for SolvaPay SDK across different frameworks and use cases.

## Table of Contents

- [Error Types](#error-types)
- [PaywallError Handling](#paywallerror-handling)
- [Framework-Specific Patterns](#framework-specific-patterns)
- [Best Practices](#best-practices)
- [Complete Examples](#complete-examples)

## Error Types

SolvaPay SDK uses several error types:

### PaywallError

Thrown when a paywall is triggered (purchase required or usage limit exceeded):

```typescript
import { PaywallError } from '@solvapay/server'

class PaywallError extends Error {
  message: string
  structuredContent: PaywallStructuredContent
}
```

### SolvaPayError

Base error class for SolvaPay SDK errors:

```typescript
import { SolvaPayError } from '@solvapay/core'

class SolvaPayError extends Error {
  // Base error for SDK errors
}
```

### Standard Errors

Regular JavaScript errors from your business logic or network issues.

## PaywallError Handling

### Understanding PaywallError

`PaywallError` is thrown when:

- Customer doesn't have required purchase
- Customer has exceeded usage limits
- Customer needs to upgrade their plan

It includes structured content with checkout URLs and metadata:

```typescript
interface PaywallStructuredContent {
  kind: 'payment_required'
  agent: string
  checkoutUrl: string
  message: string
  plan?: string
  remaining?: number
}
```

### Basic Handling

```typescript
import { PaywallError } from '@solvapay/server'

try {
  const result = await payable.http(createTask)(req, res)
  return result
} catch (error) {
  if (error instanceof PaywallError) {
    // Handle paywall error
    return res.status(402).json({
      error: 'Payment required',
      checkoutUrl: error.structuredContent.checkoutUrl,
      message: error.structuredContent.message,
    })
  }

  // Handle other errors
  throw error
}
```

## Framework-Specific Patterns

### Express.js

#### Basic Error Handling

```typescript
import express from 'express'
import { PaywallError } from '@solvapay/server'

const app = express()

// Protected route
app.post('/api/tasks', payable.http(createTask))

// Global error handler
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof PaywallError) {
    return res.status(402).json({
      error: 'Payment required',
      checkoutUrl: error.structuredContent.checkoutUrl,
      agent: error.structuredContent.agent,
      message: error.structuredContent.message,
    })
  }

  // Log other errors
  console.error('Unhandled error:', error)
  res.status(500).json({ error: 'Internal server error' })
})
```

#### Custom Error Middleware

```typescript
function paywallErrorHandler(
  error: Error,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (error instanceof PaywallError) {
    // Custom paywall response
    return res.status(402).json({
      success: false,
      error: {
        type: 'paywall',
        message: error.message,
        checkoutUrl: error.structuredContent.checkoutUrl,
        agent: error.structuredContent.agent,
        plan: error.structuredContent.plan,
        remaining: error.structuredContent.remaining,
      },
    })
  }

  next(error)
}

app.use(paywallErrorHandler)
```

#### Per-Route Error Handling

```typescript
async function handleWithErrorHandling(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const handler = payable.http(createTask)
    await handler(req, res)
  } catch (error) {
    if (error instanceof PaywallError) {
      return res.status(402).json({
        error: 'Payment required',
        checkoutUrl: error.structuredContent.checkoutUrl,
      })
    }
    next(error)
  }
}

app.post('/api/tasks', handleWithErrorHandling)
```

### Next.js

#### API Route Error Handling

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { PaywallError } from '@solvapay/server'

export async function POST(request: NextRequest) {
  try {
    const handler = payable.next(createTask)
    return await handler(request)
  } catch (error) {
    if (error instanceof PaywallError) {
      return NextResponse.json(
        {
          error: 'Payment required',
          checkoutUrl: error.structuredContent.checkoutUrl,
          message: error.structuredContent.message,
        },
        { status: 402 },
      )
    }

    console.error('Unhandled error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

#### Using Helper Functions

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { checkPurchase } from '@solvapay/next'
import { isErrorResult, handleRouteError } from '@solvapay/server'

export async function GET(request: NextRequest) {
  const result = await checkPurchase(request)

  // Check if result is an error
  if (isErrorResult(result)) {
    return NextResponse.json(result, { status: result.status || 500 })
  }

  return NextResponse.json(result)
}
```

#### Error Handling Utility

```typescript
// lib/error-handler.ts
import { NextRequest, NextResponse } from 'next/server'
import { PaywallError } from '@solvapay/server'

export function handleApiError(error: unknown, request: NextRequest) {
  if (error instanceof PaywallError) {
    return NextResponse.json(
      {
        error: 'Payment required',
        checkoutUrl: error.structuredContent.checkoutUrl,
        agent: error.structuredContent.agent,
        message: error.structuredContent.message,
      },
      { status: 402 },
    )
  }

  if (error instanceof Error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

// Usage
export async function POST(request: NextRequest) {
  try {
    const handler = payable.next(createTask)
    return await handler(request)
  } catch (error) {
    return handleApiError(error, request)
  }
}
```

### React (Client-Side)

#### Component Error Handling

```tsx
import { PaymentForm } from '@solvapay/react'
import { useState } from 'react'

function CheckoutPage() {
  const [error, setError] = useState<string | null>(null)

  return (
    <div>
      {error && <div className="error-message">{error}</div>}
      <PaymentForm
        planRef="pln_premium"
        agentRef="agt_myapi"
        onSuccess={() => {
          setError(null)
          // Handle success
        }}
        onError={error => {
          setError(error.message || 'Payment failed')
        }}
      />
    </div>
  )
}
```

#### Hook Error Handling

```tsx
import { useCheckout } from '@solvapay/react'

function CustomCheckout() {
  const { createPayment, processPayment, error, isLoading } = useCheckout(
    'pln_premium',
    'agt_myapi',
  )

  const handleCheckout = async () => {
    try {
      const intent = await createPayment()
      const result = await processPayment(intent.paymentIntentId)

      if (!result.success) {
        throw new Error(result.error || 'Payment failed')
      }
    } catch (error) {
      console.error('Checkout error:', error)
      // Handle error
    }
  }

  return (
    <div>
      {error && <div>Error: {error.message}</div>}
      <button onClick={handleCheckout} disabled={isLoading}>
        Checkout
      </button>
    </div>
  )
}
```

### MCP Server

#### Tool Error Handling

```typescript
import { PaywallError } from '@solvapay/server'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'create_task': {
        const handler = payable.mcp(createTask)
        const result = await handler(args)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    if (error instanceof PaywallError) {
      // Return paywall error in MCP format
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Payment required',
              message: error.message,
              checkoutUrl: error.structuredContent.checkoutUrl,
              agent: error.structuredContent.agent,
              plan: error.structuredContent.plan,
            }),
          },
        ],
        isError: true,
      }
    }

    // Handle other errors
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
      isError: true,
    }
  }
})
```

## Best Practices

### 1. Always Check Error Type

```typescript
try {
  // Your code
} catch (error) {
  if (error instanceof PaywallError) {
    // Handle paywall error
  } else if (error instanceof SolvaPayError) {
    // Handle SDK error
  } else {
    // Handle other errors
  }
}
```

### 2. Provide User-Friendly Messages

```typescript
if (error instanceof PaywallError) {
  return res.status(402).json({
    error: 'Purchase required',
    message: 'Please purchase a plan to access this feature.',
    checkoutUrl: error.structuredContent.checkoutUrl,
  })
}
```

### 3. Log Errors Appropriately

```typescript
catch (error) {
  if (error instanceof PaywallError) {
    // Don't log paywall errors as they're expected
    // Just return the error response
  } else {
    // Log unexpected errors
    console.error('Unexpected error:', error);
    // Send generic error to client
  }
}
```

### 4. Use Error Boundaries (React)

```tsx
import { ErrorBoundary } from 'react-error-boundary'

function ErrorFallback({ error, resetErrorBoundary }) {
  if (error.message.includes('Payment')) {
    return (
      <div>
        <h2>Payment Required</h2>
        <p>Please purchase a plan to access this feature.</p>
        <button onClick={resetErrorBoundary}>Try Again</button>
      </div>
    )
  }

  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={resetErrorBoundary}>Try Again</button>
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <YourApp />
    </ErrorBoundary>
  )
}
```

### 5. Retry Logic for Transient Errors

```typescript
import { withRetry } from '@solvapay/server'

async function createTaskWithRetry(req: express.Request) {
  return withRetry(
    async () => {
      const handler = payable.http(createTask)
      return await handler(req, res)
    },
    {
      maxRetries: 3,
      retryDelay: 1000,
      shouldRetry: error => {
        // Don't retry paywall errors
        if (error instanceof PaywallError) {
          return false
        }
        // Retry network errors
        return error instanceof NetworkError
      },
    },
  )
}
```

## Complete Examples

### Express.js Complete Example

```typescript
import express from 'express'
import { createSolvaPay, PaywallError } from '@solvapay/server'

const app = express()
app.use(express.json())

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' })

// Protected route
app.post('/api/tasks', payable.http(createTask))

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof PaywallError) {
    return res.status(402).json({
      success: false,
      error: {
        type: 'paywall',
        message: error.message,
        checkoutUrl: error.structuredContent.checkoutUrl,
        agent: error.structuredContent.agent,
        plan: error.structuredContent.plan,
      },
    })
  }

  // Log unexpected errors
  console.error('Unhandled error:', {
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  })

  // Don't expose internal errors to client
  res.status(500).json({
    success: false,
    error: {
      type: 'internal',
      message: 'An internal error occurred',
    },
  })
})

app.listen(3000)
```

### Next.js Complete Example

```typescript
// app/api/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createSolvaPay, PaywallError } from '@solvapay/server'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' })

async function createTask(req: NextRequest) {
  const body = await req.json()
  return { success: true, task: { title: body.title } }
}

export async function POST(request: NextRequest) {
  try {
    const handler = payable.next(createTask)
    return await handler(request)
  } catch (error) {
    if (error instanceof PaywallError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            type: 'paywall',
            message: error.message,
            checkoutUrl: error.structuredContent.checkoutUrl,
            agent: error.structuredContent.agent,
          },
        },
        { status: 402 },
      )
    }

    console.error('API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: {
          type: 'internal',
          message: 'An internal error occurred',
        },
      },
      { status: 500 },
    )
  }
}
```

## Next Steps

- [Express.js Integration Guide](./express.md) - Learn Express integration
- [Next.js Integration Guide](./nextjs.md) - Learn Next.js integration
- [Custom Authentication Adapters](./custom-auth.md) - Handle auth errors
- [API Reference](../api/server/src/README.md) - Full API documentation
