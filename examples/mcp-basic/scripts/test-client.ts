/**
 * Test Client for SolvaPay MCP Server
 * 
 * This script demonstrates how to connect to the MCP server using the official SDK client
 * with the new Streamable HTTP transport pattern.
 * It simulates a full user flow:
 * 1. Connecting via Streamable HTTP
 * 2. Initializing the session
 * 3. Listing tools
 * 4. Calling tools (free tier)
 * 5. Triggering paywall
 * 
 * Usage:
 *   pnpm test:client
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const PORT = process.env.MCP_PORT || 3003
const HOST = process.env.MCP_HOST || 'localhost'
const BASE_URL = `http://${HOST}:${PORT}`

async function main() {
  console.log('🔌 Connecting to MCP Server (Streamable HTTP)...')
  
  // Create transport using Streamable HTTP
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`))
  
  // Create client
  const client = new Client(
    {
      name: 'test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  )

  try {
    // Connect
    await client.connect(transport)
    console.log('✅ Connected!')

    // List tools
    console.log('\n🛠️  Listing tools...')
    const tools = await client.listTools()
    console.log(`Found ${tools.tools.length} tools:`)
    tools.tools.forEach(t => console.log(`  - ${t.name}: ${t.description}`))

    // Use a unique customer ref to ensure fresh free tier
    const customerRef = `user_${Date.now()}`
    console.log(`\n👤 Using customer_ref: ${customerRef}`)

    // 1. Create Task (Free)
    console.log('\n1️⃣  Creating Task (Call 1/3 - Free)...')
    const result1 = await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'My First Task',
        description: 'Created via test client',
        auth: { customer_ref: customerRef }
      }
    })
    console.log('Result:', JSON.stringify(result1, null, 2))

    // 2. List Tasks (Free)
    console.log('\n2️⃣  Listing Tasks (Call 2/3 - Free)...')
    const result2 = await client.callTool({
      name: 'list_tasks',
      arguments: {
        auth: { customer_ref: customerRef }
      }
    })
    console.log('Result:', JSON.stringify(result2, null, 2))

    // 3. Get Task (Free)
    console.log('\n3️⃣  Getting Task (Call 3/3 - Free)...')
    // Extract task ID from previous result if possible, otherwise skip or use dummy
    // For demo simplicity, just calling list again to consume usage
    const result3 = await client.callTool({
      name: 'list_tasks',
      arguments: {
        auth: { customer_ref: customerRef }
      }
    })
    console.log('Result:', JSON.stringify(result3, null, 2))

    // 4. Trigger Paywall
    console.log('\n4️⃣  Triggering Paywall (Call 4 - Paid)...')
    try {
      await client.callTool({
        name: 'create_task',
        arguments: {
          title: 'Paid Task',
          auth: { customer_ref: customerRef }
        }
      })
    } catch (error: any) {
      console.log('✅ Paywall triggered successfully!')
      // In SDK, errors might be thrown or returned as error results depending on transport
      // The SDK client throws JSON-RPC errors
      console.log('Error Message:', error.message)
      if (error.data) {
        console.log('Error Data:', JSON.stringify(error.data, null, 2))
      }
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    // Cleanup
    console.log('\n🧹 Closing connection...')
    await transport.close()
  }
}

main()

