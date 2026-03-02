import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, toolHandlers } from './tools'
import type { CreateTaskArgs, DeleteTaskArgs, GetTaskArgs, ListTasksArgs } from './types/mcp'

export function createMCPServer(): Server {
  return new Server(
    {
      name: 'solvapay-oauth-bridge-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )
}

export function registerMCPHandlers(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }))

  type CallToolRequest = {
    params: {
      name: string
      arguments?: unknown
    }
  }

  const callToolHandler = async (request: unknown): Promise<unknown> => {
    const { params } = request as CallToolRequest
    const { name, arguments: args } = params
    const toolArgs = (args ?? {}) as unknown

    switch (name) {
      case 'create_task':
        return toolHandlers.create_task(toolArgs as CreateTaskArgs)
      case 'get_task':
        return toolHandlers.get_task(toolArgs as GetTaskArgs)
      case 'list_tasks':
        return toolHandlers.list_tasks(toolArgs as ListTasksArgs)
      case 'delete_task':
        return toolHandlers.delete_task(toolArgs as DeleteTaskArgs)
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  const setRequestHandlerTyped = server.setRequestHandler.bind(server) as unknown as (
    schema: typeof CallToolRequestSchema,
    handler: (request: unknown) => Promise<unknown>,
  ) => void

  setRequestHandlerTyped(CallToolRequestSchema, callToolHandler)
}
