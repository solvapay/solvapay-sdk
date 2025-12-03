/* eslint-disable no-useless-catch */
import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'
import { createTask, getTask, listTasks, deleteTask } from '@solvapay/demo-services'
import type {
  CreateTaskArgs,
  GetTaskArgs,
  ListTasksArgs,
  DeleteTaskArgs,
} from './types/mcp'
import express from 'express'
import cors from 'cors'

// Initialize paywall system (using shared stub client)
// Use in-memory storage for tests (file storage gets cleaned up by tests anyway)
const apiClient = createStubClient({
  useFileStorage: false, // In-memory only (tests delete .demo-data)
  freeTierLimit: 3, // 3 free calls per day per plan
  debug: true,
})

// Initialize SolvaPay with the new unified API
const solvaPay = createSolvaPay({
  apiClient,
})

// Create payable handler with explicit MCP adapter
const payable = solvaPay.payable({ agent: 'basic-crud' })

// Define available tools for the MCP server
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
  {
    name: 'get_task',
    description: 'Get a task by ID (requires payment after free tier)',
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
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks (requires payment after free tier)',
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
        },
      },
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task by ID (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to delete',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['id'],
    },
  },
]

// CRUD operation handlers - wrapping shared service functions
async function createTaskMCP(args: CreateTaskArgs) {
  const result = await createTask(args)
  return {
    success: result.success,
    message: 'Task created successfully',
    task: result.task,
  }
}

async function getTaskMCP(args: GetTaskArgs) {
  const result = await getTask(args)
  return {
    success: result.success,
    task: result.task,
  }
}

async function listTasksMCP(args: ListTasksArgs) {
  const result = await listTasks(args)
  return {
    success: result.success,
    tasks: result.tasks,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }
}

async function deleteTaskMCP(args: DeleteTaskArgs) {
  const result = await deleteTask(args)
  return {
    success: result.success,
    message: result.message,
    deletedTask: result.deletedTask,
  }
}

// Function to create a new MCP server instance
function createMCPServer() {
  const server = new Server(
    {
      name: 'solvapay-crud-mcp-server',
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
    return {
      tools,
    }
  })

  // Handle tool execution
  // Note: We use type assertion to bypass strict type checks for the handler registration
  ;(server.setRequestHandler as any)(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'create_task': {
          const handler = payable.mcp(createTaskMCP as any)
          return await handler(args as CreateTaskArgs)
        }

        case 'get_task': {
          const handler = payable.mcp(getTaskMCP as any)
          return await handler(args as GetTaskArgs)
        }

        case 'list_tasks': {
          const handler = payable.mcp(listTasksMCP as any)
          return await handler(args as ListTasksArgs)
        }

        case 'delete_task': {
          const handler = payable.mcp(deleteTaskMCP as any)
          return await handler(args as DeleteTaskArgs)
        }

        default:
          throw new Error(`Unknown tool: ${name}`)
      }
    } catch (error) {
      throw error
    }
  })

  return server
}

// Start the server
async function main() {
  const transportMode = process.env.MCP_TRANSPORT || 'stdio' // 'stdio' or 'http'
  const port = parseInt(process.env.MCP_PORT || '3003', 10)
  const host = process.env.MCP_HOST || 'localhost'

  if (transportMode === 'http') {
    const app = express()
    
    // Allow CORS
    app.use(cors())

    const transports = new Map<string, SSEServerTransport>()

    // SSE Endpoint
    app.get('/mcp', async (req, res) => {
      // Create a new transport for this connection
      // The endpoint '/message' is where the client will post to
      const transport = new SSEServerTransport('/message', res)
      const server = createMCPServer()
      
      const sessionId = transport.sessionId
      transports.set(sessionId, transport)

      transport.onclose = () => {
        transports.delete(sessionId)
      }

      await server.connect(transport)
    })

    // Message Endpoint
    app.post('/message', async (req, res) => {
      const sessionId = req.query.sessionId as string
      const transport = transports.get(sessionId)

      if (!transport) {
        res.status(404).end('Session not found')
        return
      }

      await transport.handlePostMessage(req, res)
    })

    // Helpful error for POST /mcp (old endpoint)
    app.post('/mcp', (req, res) => {
      res.status(400).json({
        error: 'Invalid endpoint',
        message: 'MCP HTTP transport has changed. Please use GET /mcp to establish an SSE connection, then POST to the URL provided in the "endpoint" event.'
      })
    })
    
    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', transport: 'http-sse' })
    })

    app.listen(port, host, () => {
      console.error(`🚀 SolvaPay CRUD MCP Server started (HTTP SSE mode)`)
      console.error(`💡 MCP Endpoint: http://${host}:${port}/mcp`)
      console.error(`📝 Available tools: create_task, get_task, list_tasks, delete_task`)
    })

  } else {
    // Stdio mode - default for MCP clients
    const server = createMCPServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)

    console.error('🚀 SolvaPay CRUD MCP Server started (stdio mode)')
    console.error('📝 Available tools: create_task, get_task, list_tasks, delete_task')
    console.error('💰 Paywall: 3 free operations per day, then €5.00 for credits')
  }
}

main().catch(error => {
  console.error('Failed to start MCP server:', error)
  process.exit(1)
})
