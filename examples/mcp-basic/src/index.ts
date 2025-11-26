/* eslint-disable no-useless-catch */
import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
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
// Note: These return plain objects. The MCP adapter handles the formatting.
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

// Create MCP server
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
    // This error handling is for cases where the tool name is unknown
    // The MCP adapter will handle PaywallError and other errors from the handlers
    throw error
  }
})

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('🚀 SolvaPay CRUD MCP Server started')
  console.error('📝 Available tools: create_task, get_task, list_tasks, delete_task')
  console.error('💰 Paywall: 3 free operations per day, then €5.00 for credits')
  console.error('🔧 Demo mode: Using stub API client')
}

main().catch(error => {
  console.error('Failed to start MCP server:', error)
  process.exit(1)
})
