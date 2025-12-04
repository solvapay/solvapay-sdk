import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMCPServer, registerMCPHandlers } from './server'

/**
 * Start stdio transport server
 */
export async function startStdioTransport(): Promise<void> {
  const server = createMCPServer()
  registerMCPHandlers(server)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('🚀 SolvaPay CRUD MCP Server started (stdio mode)')
  console.error('📝 Available tools: create_task, get_task, list_tasks, delete_task')
  console.error('💰 Paywall: 3 free operations per day, then €5.00 for credits')
}

