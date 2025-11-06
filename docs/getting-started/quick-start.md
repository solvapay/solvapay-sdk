# Quick Start

Get up and running with SolvaPay SDK in minutes. These examples are copy-paste ready and work out of the box.

## Express.js: Protect an API Endpoint (5 minutes)

Protect an Express.js API endpoint with paywall protection:

```typescript
import express from 'express';
import { createSolvaPay } from '@solvapay/server';

const app = express();
app.use(express.json());

// Initialize SolvaPay (works without API key in stub mode)
const solvaPay = createSolvaPay({
  // apiKey: process.env.SOLVAPAY_SECRET_KEY // Optional for production
});

// Create payable handler for your agent
const payable = solvaPay.payable({
  agent: 'agt_YOUR_AGENT',  // Your agent reference from SolvaPay dashboard
  plan: 'pln_YOUR_PLAN'      // Your plan reference
});

// Your business logic
async function createTask(req: express.Request) {
  const { title } = req.body;
  return {
    success: true,
    task: { id: '1', title, createdAt: new Date() }
  };
}

// Protect the endpoint with one line
app.post('/tasks', payable.http(createTask));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

**Test it:**

```bash
# Make a request (replace with your customer reference)
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -H "x-customer-ref: user_123" \
  -d '{"title": "My task"}'
```

## Next.js: Add Payment Flow (10 minutes)

### 1. Set up API Routes

Create API routes for subscription checking and payment:

```typescript
// app/api/check-subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  return result instanceof NextResponse 
    ? result 
    : NextResponse.json(result);
}
```

```typescript
// app/api/create-payment-intent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPaymentIntent } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();
  
  if (!planRef || !agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    );
  }

  const result = await createPaymentIntent(request, { planRef, agentRef });
  return result instanceof NextResponse 
    ? result 
    : NextResponse.json(result);
}
```

### 2. Set up Provider

```tsx
// app/layout.tsx
import { SolvaPayProvider } from '@solvapay/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <SolvaPayProvider
          config={{
            api: {
              checkSubscription: '/api/check-subscription',
              createPayment: '/api/create-payment-intent',
            }
          }}
        >
          {children}
        </SolvaPayProvider>
      </body>
    </html>
  );
}
```

### 3. Add Payment Form

```tsx
// app/checkout/page.tsx
'use client';

import { PaymentForm } from '@solvapay/react';
import { useRouter } from 'next/navigation';

export default function CheckoutPage() {
  const router = useRouter();

  return (
    <div>
      <h1>Subscribe to Premium</h1>
      <PaymentForm
        planRef="pln_YOUR_PLAN"
        agentRef="agt_YOUR_AGENT"
        onSuccess={() => {
          console.log('Payment successful!');
          router.push('/dashboard');
        }}
        onError={(error) => {
          console.error('Payment failed:', error);
        }}
      />
    </div>
  );
}
```

## MCP Server: Protect MCP Tools (5 minutes)

Protect MCP (Model Context Protocol) tools with paywall protection:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createSolvaPay } from '@solvapay/server';

// Initialize SolvaPay
const solvaPay = createSolvaPay({
  // apiKey: process.env.SOLVAPAY_SECRET_KEY // Optional for production
});

// Create payable handler
const payable = solvaPay.payable({
  agent: 'agt_YOUR_AGENT'
});

// Your tool implementation
async function myTool(args: { input: string }) {
  return {
    success: true,
    result: `Processed: ${args.input}`
  };
}

// Create MCP server
const server = new Server(
  {
    name: 'my-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

// Handle tool execution with paywall protection
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === 'my_tool') {
    // Protect the tool with one line
    const handler = payable.mcp(myTool);
    return await handler(args);
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server started');
}

main();
```

## React: Add Payment UI Components (10 minutes)

### 1. Set up Provider

```tsx
// App.tsx or layout component
import { SolvaPayProvider } from '@solvapay/react';

function App() {
  return (
    <SolvaPayProvider
      config={{
        api: {
          checkSubscription: '/api/check-subscription',
          createPayment: '/api/create-payment-intent',
        }
      }}
    >
      <YourApp />
    </SolvaPayProvider>
  );
}
```

### 2. Use Subscription Hook

```tsx
// components/Dashboard.tsx
import { useSubscription } from '@solvapay/react';

function Dashboard() {
  const { subscriptions, hasPaidSubscription, isLoading } = useSubscription();

  if (isLoading) return <div>Loading...</div>;

  if (!hasPaidSubscription) {
    return (
      <div>
        <h2>Upgrade to Premium</h2>
        <a href="/checkout">Subscribe Now</a>
      </div>
    );
  }

  return (
    <div>
      <h2>Welcome, Premium User!</h2>
      <p>Active subscriptions: {subscriptions.length}</p>
    </div>
  );
}
```

### 3. Add Payment Form

```tsx
// components/Checkout.tsx
import { PaymentForm } from '@solvapay/react';

function Checkout() {
  return (
    <div>
      <h1>Subscribe to Premium</h1>
      <PaymentForm
        planRef="pln_YOUR_PLAN"
        agentRef="agt_YOUR_AGENT"
        onSuccess={() => {
          window.location.href = '/dashboard';
        }}
      />
    </div>
  );
}
```

## Next Steps

- [Core Concepts](./core-concepts.md) - Understand agents, plans, and the paywall flow
- [Framework Guides](../guides/) - Detailed integration guides for your framework
- [API Reference](../api/) - Complete API documentation

