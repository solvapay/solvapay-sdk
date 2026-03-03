import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, toolHandlers } from './tools'

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
    const toolArgs = (args ?? {}) as Record<string, unknown>

    const handler = toolHandlers[name]
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`)
    }

    return handler(toolArgs)
  }

  const setRequestHandlerTyped = server.setRequestHandler.bind(server) as unknown as (
    schema: typeof CallToolRequestSchema,
    handler: (request: unknown) => Promise<unknown>,
  ) => void

  setRequestHandlerTyped(CallToolRequestSchema, callToolHandler)
}
