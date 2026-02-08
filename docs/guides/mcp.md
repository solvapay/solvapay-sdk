# MCP Server Integration Guide

This guide shows you how to integrate SolvaPay SDK with Model Context Protocol (MCP) servers to protect MCP tools with paywall protection and purchase management.

## Table of Contents

- [Installation](#installation)
- [Basic Setup](#basic-setup)
- [Protecting MCP Tools](#protecting-mcp-tools)
- [Authentication](#authentication)
- [Error Handling](#error-handling)
- [Complete Example](#complete-example)

## Installation

Install the required packages:

```bash
npm install @solvapay/server @modelcontextprotocol/sdk
# or
pnpm add @solvapay/server @modelcontextprotocol/sdk
# or
yarn add @solvapay/server @modelcontextprotocol/sdk
```

## Basic Setup

### 1. Initialize SolvaPay

Create a SolvaPay instance in your MCP server:

```typescript
import { createSolvaPay } from '@solvapay/server'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// Initialize SolvaPay
const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY,
})

// Create payable handler for your agent
const payable = solvaPay.payable({
  agent: 'agt_YOUR_AGENT_ID',
  plan: 'pln_YOUR_PLAN_ID', // Optional: can be set per tool
})
```

### 2. Create MCP Server

Set up your MCP server:

```typescript
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'

// Create MCP server
const server = new Server(
  {
    name: 'solvapay-protected-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)
```

### 3. Define Tools

Define your MCP tools:

```typescript
const tools: Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task (requires purchase)',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the task',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
          required: ['customer_ref'],
        },
      },
      required: ['title', 'auth'],
    },
  },
]
```

## Protecting MCP Tools

### Basic Tool Protection

Wrap your tool handlers with `payable.mcp()`:

```typescript
// Your business logic function
async function createTask(args: { title: string; auth: { customer_ref: string } }) {
  const { title } = args

  // Your business logic here
  const task = {
    id: Date.now().toString(),
    title,
    createdAt: new Date().toISOString(),
  }

  return {
    success: true,
    task,
  }
}

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'create_task': {
      // Protect the tool with paywall
      const handler = payable.mcp(createTask)
      return await handler(args)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
})
```

### Multiple Tools with Same Plan

If all tools use the same plan, create one `payable` handler:

```typescript
const payable = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_premium',
})

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'create_task': {
      const handler = payable.mcp(createTask)
      return await handler(args)
    }

    case 'get_task': {
      const handler = payable.mcp(getTask)
      return await handler(args)
    }

    case 'list_tasks': {
      const handler = payable.mcp(listTasks)
      return await handler(args)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
})
```

### Different Plans per Tool

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

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'list_tasks': {
      // Free tier tool
      const handler = freeTier.mcp(listTasks)
      return await handler(args)
    }

    case 'create_task': {
      // Premium tier tool
      const handler = premiumTier.mcp(createTask)
      return await handler(args)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
})
```

## Authentication

### Customer Reference in Tool Arguments

The MCP adapter expects customer reference in the `auth` object:

```typescript
const tools: Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        auth: {
          type: 'object',
          properties: {
            customer_ref: { type: 'string' },
          },
          required: ['customer_ref'],
        },
      },
      required: ['title', 'auth'],
    },
  },
]
```

### Extract Customer Reference

The MCP adapter automatically extracts `customer_ref` from `args.auth.customer_ref`:

```typescript
async function createTask(args: { title: string; auth: { customer_ref: string } }) {
  // customer_ref is automatically extracted by the adapter
  // Your business logic here
  return { success: true, task: {} }
}

const handler = payable.mcp(createTask)
```

### Custom Customer Reference Extraction

Override customer reference extraction:

```typescript
const handler = payable.mcp(createTask, {
  getCustomerRef: (args: any) => {
    // Custom logic to extract customer reference
    return args.auth?.customer_ref || args.userId || null
  },
})
```

## Error Handling

### Basic Error Handling

The MCP adapter automatically handles `PaywallError` and converts it to MCP error format:

```typescript
server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'create_task': {
        const handler = payable.mcp(createTask)
        return await handler(args)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    // PaywallError is automatically handled by the adapter
    // Other errors are re-thrown
    throw error
  }
})
```

### Custom Error Handling

Handle errors manually for custom error responses:

```typescript
import { PaywallError } from '@solvapay/server'

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'create_task': {
        const handler = payable.mcp(createTask)
        return await handler(args)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    if (error instanceof PaywallError) {
      // Custom paywall error response
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Payment required',
              message: error.message,
              checkoutUrl: error.structuredContent.checkoutUrl,
              plan: error.structuredContent.plan,
              agent: error.structuredContent.agent,
            }),
          },
        ],
        isError: true,
      }
    }

    // Handle other errors
    throw error
  }
})
```

## Complete Example

Here's a complete MCP server with SolvaPay integration:

```typescript
import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { createSolvaPay, PaywallError } from '@solvapay/server'

// Initialize SolvaPay
const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY,
})

// Create payable handler
const payable = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_premium',
})

// Define tools
const tools: Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task (requires purchase)',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the task',
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
          required: ['customer_ref'],
        },
      },
      required: ['title', 'auth'],
    },
  },
  {
    name: 'get_task',
    description: 'Get a task by ID (requires purchase)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to retrieve',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
          required: ['customer_ref'],
        },
      },
      required: ['id', 'auth'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks (requires purchase)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 10)',
        },
        offset: {
          type: 'number',
          description: 'Number of tasks to skip (default: 0)',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
          required: ['customer_ref'],
        },
      },
    },
  },
]

// Business logic functions
async function createTask(args: {
  title: string
  description?: string
  auth: { customer_ref: string }
}) {
  const { title, description } = args

  const task = {
    id: Date.now().toString(),
    title,
    description,
    createdAt: new Date().toISOString(),
  }

  return {
    success: true,
    message: 'Task created successfully',
    task,
  }
}

async function getTask(args: { id: string; auth: { customer_ref: string } }) {
  const { id } = args

  // Simulate fetching from database
  const task = {
    id,
    title: 'Sample Task',
    description: 'Task description',
    createdAt: new Date().toISOString(),
  }

  return {
    success: true,
    task,
  }
}

async function listTasks(args: {
  limit?: number
  offset?: number
  auth: { customer_ref: string }
}) {
  const { limit = 10, offset = 0 } = args

  // Simulate fetching from database
  const tasks = Array.from({ length: limit }, (_, i) => ({
    id: (offset + i + 1).toString(),
    title: `Task ${offset + i + 1}`,
    description: `Description for task ${offset + i + 1}`,
    createdAt: new Date().toISOString(),
  }))

  return {
    success: true,
    tasks,
    total: tasks.length,
    limit,
    offset,
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'solvapay-protected-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools }
})

// Handle tool execution
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

      case 'get_task': {
        const handler = payable.mcp(getTask)
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

      case 'list_tasks': {
        const handler = payable.mcp(listTasks)
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
              plan: error.structuredContent.plan,
              agent: error.structuredContent.agent,
            }),
          },
        ],
        isError: true,
      }
    }

    // Re-throw other errors
    throw error
  }
})

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('🚀 SolvaPay Protected MCP Server started')
  console.error('📝 Available tools: create_task, get_task, list_tasks')
  console.error('💰 Paywall protection enabled')
}

main().catch(error => {
  console.error('Failed to start MCP server:', error)
  process.exit(1)
})
```

### Testing the Example

1. Save the code to `src/index.ts`
2. Set environment variable: `SOLVAPAY_SECRET_KEY=sk_...`
3. Run the server: `node dist/index.js`

The server will listen on stdio and respond to MCP protocol messages.

## Tool Response Format

The MCP adapter automatically formats responses. Your business logic should return:

- **Object**: Automatically converted to MCP response format
- **Error**: Thrown as exception (PaywallError handled automatically)

```typescript
async function createTask(args: any) {
  // Return object - automatically formatted
  return { success: true, task: {} }

  // Or throw error - automatically handled
  if (!args.title) {
    throw new Error('Title is required')
  }
}
```

## Best Practices

1. **Customer Reference**: Always require `customer_ref` in the `auth` object for tool arguments.

2. **Error Handling**: Handle `PaywallError` appropriately to provide clear error messages to MCP clients.

3. **Tool Documentation**: Provide clear descriptions in tool schemas so users understand what each tool does.

4. **Type Safety**: Use TypeScript for better type safety and developer experience.

5. **Environment Variables**: Store API keys in environment variables, not in code.

6. **Tool Naming**: Use clear, descriptive names for your tools.

## Next Steps

- [Express.js Integration Guide](./express.md) - Learn HTTP framework integration
- [Error Handling Strategies](./error-handling.md) - Advanced error handling patterns
- [Custom Authentication Adapters](./custom-auth.md) - Build custom auth adapters
- [API Reference](../api/server/src/README.md) - Full API documentation
