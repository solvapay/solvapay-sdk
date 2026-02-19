/**
 * Integration test for MCP Streamable HTTP transport with SolvaPay paywall
 * 
 * Tests the full MCP server over HTTP, including:
 * - Server initialization
 * - Tool listing
 * - Tool execution with free tier
 * - Paywall triggering when free tier is exceeded
 * 
 * To run this test:
 *   pnpm test:run http-transport-paywall
 * 
 * This test:
 * 1. Starts the MCP server in HTTP mode on port 3006
 * 2. Makes HTTP requests to the /mcp endpoint
 * 3. Tests the full MCP protocol flow
 * 4. Verifies free tier works (first 3 calls succeed)
 * 5. Verifies paywall triggers after free tier (4th call returns checkout URL)
 * 
 * Note: The server is spawned as a separate process. Make sure port 3006 is available.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import net from 'net'

let MCP_PORT = 3000
let MCP_ENDPOINT = ''
const TEST_TIMEOUT = 60000 // Increased timeout for server startup

// Helper to find a free port
async function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(startPort, () => {
      server.close(() => resolve(startPort))
    })
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(startPort + 1))
      } else {
        reject(err)
      }
    })
  })
}

interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: any
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

describe('MCP Streamable HTTP Transport with Paywall', () => {
  let serverProcess: ChildProcess | null = null
  let sseController: AbortController | null = null
  let postEndpoint: string | null = null
  const pendingRequests = new Map<string | number, (response: JSONRPCResponse) => void>()

  beforeAll(async () => {
    // Find a free port starting from a higher number to avoid conflicts
    MCP_PORT = await findFreePort(3020)
    MCP_ENDPOINT = `http://localhost:${MCP_PORT}/mcp`

    // Clean up demo data for test isolation
    try {
      await fs.rm(path.join(process.cwd(), '.demo-data'), { recursive: true, force: true })
    } catch (error) {
      // Ignore if directory doesn't exist
    }

    // Start the MCP server in HTTP mode
    serverProcess = spawn('pnpm', ['tsx', 'src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MCP_TRANSPORT: 'http',
        MCP_PORT: String(MCP_PORT),
        MCP_HOST: 'localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // Enable process group for reliable cleanup
    })

    // Collect server output
    let serverOutput = ''
    let serverError = ''
    
    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', (data: Buffer) => {
        serverOutput += data.toString()
      })
    }
    
    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (data: Buffer) => {
        serverError += data.toString()
        // Also log to console for debugging
        process.stderr.write(data)
      })
    }

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start within 30 seconds. Output: ${serverOutput}\nError: ${serverError}`))
      }, 30000)

      // Check if server is ready by polling health endpoint
      const checkServer = async () => {
        try {
          const response = await fetch(`http://localhost:${MCP_PORT}/health`)
          if (response.ok) {
            clearTimeout(timeout)
            resolve()
          } else {
            setTimeout(checkServer, 100)
          }
        } catch (error) {
          // Server not ready yet, keep polling
          setTimeout(checkServer, 100)
        }
      }

      // Also check for server startup message in output (server logs to stderr)
      const checkOutput = setInterval(() => {
        if (serverOutput.includes('SolvaPay CRUD MCP Server started') || 
            serverError.includes('SolvaPay CRUD MCP Server started') ||
            serverError.includes('🚀 SolvaPay CRUD MCP Server started')) {
          clearInterval(checkOutput)
          // Still wait for health endpoint to be ready
          setTimeout(checkServer, 500)
        }
      }, 100)

      // Start checking after a short delay
      setTimeout(checkServer, 500)

      // Handle process errors
      if (serverProcess) {
        serverProcess.on('error', (error) => {
          clearTimeout(timeout)
          clearInterval(checkOutput)
          reject(new Error(`Failed to start server: ${error.message}\nOutput: ${serverOutput}\nError: ${serverError}`))
        })

        serverProcess.on('exit', (code, signal) => {
        if (code !== null && code !== 0 && 
            !serverOutput.includes('SolvaPay CRUD MCP Server started') &&
            !serverError.includes('SolvaPay CRUD MCP Server started') &&
            !serverError.includes('🚀 SolvaPay CRUD MCP Server started')) {
          clearTimeout(timeout)
          clearInterval(checkOutput)
          reject(new Error(`Server exited with code ${code} before starting. Output: ${serverOutput}\nError: ${serverError}`))
        }
        })
      }
    })

  }, TEST_TIMEOUT)

  afterAll(async () => {
    // Close SSE connection
    if (sseController) {
        sseController.abort()
    }

    // Clean up server process
    if (serverProcess && serverProcess.pid) {
      try {
        // Kill process group to ensure all children (including tsx/node) are killed
        process.kill(-serverProcess.pid, 'SIGKILL')
      } catch (e) {
        // Ignore if process already dead
      }
    }
    
    // Give it a moment to release port
    await new Promise(resolve => setTimeout(resolve, 500))

    // Clean up demo data
    try {
      await fs.rm(path.join(process.cwd(), '.demo-data'), { recursive: true, force: true })
    } catch (error) {
      // Ignore
    }
  })

  beforeEach(() => {
    // Reset session for each test
    if (sseController) {
        sseController.abort()
        sseController = null
    }
    postEndpoint = null
    pendingRequests.clear()
  })

  async function connectSSE() {
    sseController = new AbortController()
    const response = await fetch(MCP_ENDPOINT, {
        headers: { 'Accept': 'text/event-stream' },
        signal: sseController.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response')
      throw new Error(`Failed to connect to SSE: ${response.status} - ${errorText}`)
    }
    if (!response.body) throw new Error('No response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    
    // Start background reader
    const readLoop = async () => {
        try {
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                
                buffer += decoder.decode(value, { stream: true })
                
                const events = buffer.split('\n\n')
                // If buffer ends with \n\n, last element is empty string.
                // If not, last element is partial event.
                // We should keep the last element as buffer if it's not empty, or if we are not at done?
                // Split logic: 'a\n\nb'.split('\n\n') -> ['a', 'b']
                // If buffer is 'data: foo\n\n', split -> ['data: foo', '']
                // So if last element is empty, we have complete events.
                // If last element is not empty, it's partial.
                
                // Better approach:
                // Check if buffer ends with \n\n.
                // But partial read is tricky.
                
                // Simplified:
                // Just process what we have.
                if (events.length > 1) {
                     // We have at least one complete event
                     const completeEvents = events.slice(0, -1)
                     buffer = events[events.length - 1]
                     
                     for (const eventBlock of completeEvents) {
                        const lines = eventBlock.split('\n')
                        let eventType = 'message'
                        let data = ''
                        
                        for (const line of lines) {
                            if (line.startsWith('event: ')) {
                                eventType = line.substring(7).trim()
                            } else if (line.startsWith('data: ')) {
                                data = line.substring(6).trim()
                            }
                        }
                        
                        if (eventType === 'endpoint') {
                            if (data.includes('?sessionId=')) {
                                 // data format: /message?sessionId=UUID
                                 const trimmed = data.trim()
                                 if (trimmed.startsWith('/')) {
                                     postEndpoint = `http://localhost:${MCP_PORT}${trimmed}`
                                 } else {
                                     postEndpoint = trimmed
                                 }
                            }
                        } else if (eventType === 'message' && data) {
                            try {
                                const msg = JSON.parse(data)
                                if (msg.id !== undefined && pendingRequests.has(msg.id)) {
                                    pendingRequests.get(msg.id)!(msg)
                                    pendingRequests.delete(msg.id)
                                }
                            } catch (e) { console.error('Failed to parse message', e) }
                        }
                     }
                }
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error('SSE Read Error', e)
        }
    }
    
    // Start reading but don't await loop (it's infinite until closed)
    readLoop()
    
    // Wait for endpoint
    let attempts = 0
    while (!postEndpoint && attempts < 20) {
        await new Promise(r => setTimeout(r, 100))
        attempts++
    }
    
    if (!postEndpoint) throw new Error('Timeout waiting for endpoint event')
    
    // Give polling a moment to start
    await new Promise(r => setTimeout(r, 50))
  }

  /**
   * Helper to send JSON-RPC requests to the MCP server
   */
  async function sendRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!postEndpoint) {
        await connectSSE()
    }
    
    if (!postEndpoint) throw new Error('Failed to establish SSE connection and get endpoint')

    // Extract session ID from endpoint URL (format: /mcp?sessionId=...)
    let sessionId: string | undefined
    try {
        const url = new URL(postEndpoint, 'http://localhost')
        sessionId = url.searchParams.get('sessionId') || undefined
    } catch (e) {
        // If postEndpoint is relative, parse it manually
        const match = postEndpoint.match(/[?&]sessionId=([^&]+)/)
        if (match) {
            sessionId = match[1]
        }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2024-11-05',
    }
    
    // Add session ID to headers if we have it
    if (sessionId) {
        headers['MCP-Session-Id'] = sessionId
    }
    
    const responsePromise = new Promise<JSONRPCResponse>((resolve, reject) => {
        pendingRequests.set(request.id, resolve)
        setTimeout(() => {
            if (pendingRequests.has(request.id)) {
                pendingRequests.delete(request.id)
                reject(new Error(`Timeout waiting for response to request ${request.id}`))
            }
        }, 5000)
    })

    const response = await fetch(postEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }
    
    // The response body of POST is "Accepted", we wait for the SSE message
    return responsePromise
  }

  describe('Server Initialization', () => {
    it('should initialize the MCP server and return session ID', async () => {
      const response = await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      })

      expect(response.jsonrpc).toBe('2.0')
      expect(response.id).toBe(1)
      expect(response.error).toBeUndefined()
      expect(response.result).toBeDefined()
      expect(response.result.protocolVersion).toBe('2024-11-05')
      expect(response.result.capabilities).toBeDefined()
      expect(response.result.serverInfo).toBeDefined()
      expect(response.result.serverInfo.name).toBe('solvapay-crud-mcp-server')
    })
  })

  describe('Tool Listing', () => {
    it('should list available tools', async () => {
      // Initialize first
      await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })

      const response = await sendRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })

      expect(response.jsonrpc).toBe('2.0')
      expect(response.error).toBeUndefined()
      expect(response.result).toBeDefined()
      expect(response.result.tools).toBeDefined()
      expect(Array.isArray(response.result.tools)).toBe(true)
      expect(response.result.tools.length).toBeGreaterThan(0)

      // Verify tool structure
      const tool = response.result.tools[0]
      expect(tool.name).toBeDefined()
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
    })
  })

  describe('Free Tier Functionality', () => {
    const customerRef = 'test_user_integration'

    it('should allow free tier operations (first 3 calls)', async () => {
      // Initialize
      await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })

      // First call - should succeed (free tier)
      const response1 = await sendRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: {
            auth: {
              customer_ref: customerRef,
            },
          },
        },
      })

      expect(response1.error).toBeUndefined()
      expect(response1.result).toBeDefined()

      // Second call - should succeed (free tier)
      const response2 = await sendRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: {
            auth: {
              customer_ref: customerRef,
            },
          },
        },
      })

      expect(response2.error).toBeUndefined()
      expect(response2.result).toBeDefined()

      // Third call - should succeed (free tier)
      const response3 = await sendRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: {
            auth: {
              customer_ref: customerRef,
            },
          },
        },
      })

      expect(response3.error).toBeUndefined()
      expect(response3.result).toBeDefined()
    }, TEST_TIMEOUT)

    it('should trigger paywall after free tier is exceeded', async () => {
      // Initialize
      await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })

      // Use a different customer to ensure we start fresh
      const customerRef = `test_user_paywall_${Date.now()}`

      // Make 3 free calls
      for (let i = 0; i < 3; i++) {
        await sendRequest({
          jsonrpc: '2.0',
          id: 10 + i,
          method: 'tools/call',
          params: {
            name: 'list_tasks',
            arguments: {
              auth: {
                customer_ref: customerRef,
              },
            },
          },
        })
      }

      // Fourth call - should trigger paywall
      const paywallResponse = await sendRequest({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: {
            auth: {
              customer_ref: customerRef,
            },
          },
        },
      })

      // MCP adapter returns paywall errors as a result with isError: true
      // The checkout URL is in result.content[0].text as JSON
      // OR it might be in an error response if the transport wraps it
      
      let paywallContent: any = null
      
      if (paywallResponse.result?.content) {
        // Paywall error returned as result with content
        paywallContent = paywallResponse.result.content
      } else if (paywallResponse.error?.data) {
        // Paywall error wrapped in JSON-RPC error
        paywallContent = paywallResponse.error.data
      }
      
      expect(paywallContent).toBeDefined()
      
      // Handle array of content items (MCP format)
      if (Array.isArray(paywallContent) && paywallContent.length > 0) {
        const textContent = paywallContent.find((c: any) => c.type === 'text')
        expect(textContent).toBeDefined()
        expect(textContent.text).toBeDefined()
        
        const parsedContent = JSON.parse(textContent.text)
        expect(parsedContent.error).toBe('Payment required')
        expect(parsedContent.checkoutUrl).toBeDefined()
        expect(parsedContent.checkoutUrl).toMatch(/^https?:\/\//)
      } else if (typeof paywallContent === 'object' && paywallContent.checkoutUrl) {
        // Direct object format
        expect(paywallContent.error).toBe('Payment required')
        expect(paywallContent.checkoutUrl).toMatch(/^https?:\/\//)
      } else {
        // Fallback: check if error message contains URL
        const errorMessage = paywallResponse.error?.message || JSON.stringify(paywallResponse)
        expect(errorMessage).toContain('checkout')
      }
    }, TEST_TIMEOUT)

    it('should return checkout URL in paywall response', async () => {
      // Initialize
      await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })

      const customerRef = `test_user_checkout_${Date.now()}`

      // Exhaust free tier
      for (let i = 0; i < 3; i++) {
        await sendRequest({
          jsonrpc: '2.0',
          id: 20 + i,
          method: 'tools/call',
          params: {
            name: 'list_tasks',
            arguments: {
              auth: {
                customer_ref: customerRef,
              },
            },
          },
        })
      }

      // Trigger paywall
      const response = await sendRequest({
        jsonrpc: '2.0',
        id: 23,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: {
            auth: {
              customer_ref: customerRef,
            },
          },
        },
      })

      // MCP adapter formats paywall errors in result.content[0].text
      expect(response.result).toBeDefined()
      expect(response.result.content).toBeDefined()
      expect(Array.isArray(response.result.content)).toBe(true)
      
      const textContent = response.result.content.find((c: any) => c.type === 'text')
      expect(textContent).toBeDefined()
      expect(textContent.text).toBeDefined()
      
      const parsedContent = JSON.parse(textContent.text)
      expect(parsedContent.checkoutUrl).toBeDefined()
      expect(parsedContent.checkoutUrl).toContain('checkout')
      expect(parsedContent.checkoutUrl).toMatch(/^https?:\/\//)
      expect(parsedContent.product).toBeDefined()
      expect(parsedContent.message).toBeDefined()
    }, TEST_TIMEOUT)
  })

  describe('Different Tools', () => {
    it('should handle different tool calls independently', async () => {
      // Initialize
      await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })

      const customerRef = `test_user_multi_tool_${Date.now()}`

      // Call different tools
      const listResponse = await sendRequest({
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: {
            auth: {
              customer_ref: customerRef,
            },
          },
        },
      })

      expect(listResponse.error).toBeUndefined()

      // Create a task
      const createResponse = await sendRequest({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'create_task',
          arguments: {
            title: 'Test Task',
            description: 'Integration test task',
            auth: {
              customer_ref: customerRef,
            },
          },
        },
      })

      expect(createResponse.error).toBeUndefined()
      expect(createResponse.result).toBeDefined()
    }, TEST_TIMEOUT)
  })
})
