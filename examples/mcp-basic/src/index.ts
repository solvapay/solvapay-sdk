import 'dotenv/config'
import { startHTTPTransport } from './transport-http'
import { startStdioTransport } from './transport-stdio'

/**
 * Main entry point - starts the MCP server in the configured transport mode
 */
async function main() {
  console.error('DEBUG: MCP_TRANSPORT env:', process.env.MCP_TRANSPORT)
  const transportMode = process.env.MCP_TRANSPORT || 'stdio' // 'stdio' or 'http'
  const port = parseInt(process.env.MCP_PORT || '3003', 10)
  const host = process.env.MCP_HOST || 'localhost'

  if (transportMode === 'http') {
    await startHTTPTransport(port, host)
  } else {
    await startStdioTransport()
  }
}

main().catch(error => {
  console.error('Failed to start MCP server:', error)
  process.exit(1)
})
