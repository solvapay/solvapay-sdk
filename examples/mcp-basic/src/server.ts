import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { tools, toolHandlers } from './tools'
import type {
  CreateTaskArgs,
  GetTaskArgs,
  ListTasksArgs,
  DeleteTaskArgs,
} from './types/mcp'

/**
 * Create a new MCP server instance
 */
export function createMCPServer(): Server {
  return new Server(
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
}

/**
 * Register handlers on an MCP server
 */
export function registerMCPHandlers(server: Server): void {
  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools,
    }
  })

  // Handle tool execution
  // Note: We use type assertion to bypass strict type checks for CallToolRequestSchema
  type CallToolRequest = {
    params: {
      name: string
      arguments?: unknown
    }
  }

  const callToolHandler = async (request: unknown): Promise<unknown> => {
    const { params } = request as CallToolRequest
    const { name, arguments: args } = params
    // Default to empty object if arguments is undefined
    const toolArgs = (args ?? {}) as unknown

    switch (name) {
      case 'create_task': {
        return await toolHandlers.create_task(toolArgs as CreateTaskArgs)
      }

      case 'get_task': {
        return await toolHandlers.get_task(toolArgs as GetTaskArgs)
      }

      case 'list_tasks': {
        return await toolHandlers.list_tasks(toolArgs as ListTasksArgs)
      }

      case 'delete_task': {
        return await toolHandlers.delete_task(toolArgs as DeleteTaskArgs)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  // Use type assertion only for CallToolRequestSchema
  const setRequestHandlerTyped = server.setRequestHandler.bind(server) as unknown as (
    schema: typeof CallToolRequestSchema,
    handler: (request: unknown) => Promise<unknown>,
  ) => void

  setRequestHandlerTyped(CallToolRequestSchema, callToolHandler)
}

