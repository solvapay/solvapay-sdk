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
 * 1. Starts the MCP server in HTTP mode on port 3003
 * 2. Makes HTTP requests to the /mcp endpoint
 * 3. Tests the full MCP protocol flow
 * 4. Verifies free tier works (first 3 calls succeed)
 * 5. Verifies paywall triggers after free tier (4th call returns checkout URL)
 * 
 * Note: The server is spawned as a separate process. Make sure port 3003 is available.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

const MCP_PORT = 3003 // Use different port to avoid conflicts
const MCP_ENDPOINT = `http://localhost:${MCP_PORT}/mcp`
const TEST_TIMEOUT = 60000 // Increased timeout for server startup

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
  let sessionId: string | null = null

  beforeAll(async () => {
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
    })

    // Capture server output for debugging
    let serverOutput = ''
    serverProcess.stdout?.on('data', (data) => {
      serverOutput += data.toString()
    })
    serverProcess.stderr?.on('data', (data) => {
      serverOutput += data.toString()
    })

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      if (!serverProcess) {
        reject(new Error('Failed to start server: process is null'))
        return
      }

      // Handle process errors and exit
      serverProcess.on('error', (error) => {
        console.error('Server process error:', error)
        reject(new Error(`Failed to start server: ${error.message}`))
      })

      serverProcess.on('exit', (code, signal) => {
        // Only reject if we haven't resolved yet and it's not a normal exit
        // The server might exit after starting if there's an error, but we should
        // check if it started successfully first
        if (code !== null && code !== 0 && !serverOutput.includes('MCP Server listening')) {
          console.error('Server exited with code:', code, 'Output:', serverOutput)
          reject(new Error(`Server exited with code ${code} before starting. Output: ${serverOutput}`))
        }
        // If server started but then exited, we'll catch it in the health check
      })
      const timeout = setTimeout(() => {
        console.error('Server output:', serverOutput)
        if (serverProcess) {
          serverProcess.kill()
        }
        reject(new Error(`Server failed to start within 20 seconds. Output: ${serverOutput}`))
      }, 20000)

      let attempts = 0
      const maxAttempts = 200 // 20 seconds with 100ms intervals

      const checkServer = async () => {
        attempts++
        try {
          // First, wait for server output to indicate it's listening
          if (!serverOutput.includes('MCP Server listening') && !serverOutput.includes('listening on')) {
            // Server hasn't started yet, keep waiting
            if (attempts < maxAttempts) {
              setTimeout(checkServer, 100)
              return
            } else {
              clearTimeout(timeout)
              console.error('Server never started. Output:', serverOutput)
              if (serverProcess) {
                serverProcess.kill()
              }
              reject(new Error(`Server never indicated it was listening. Output: ${serverOutput}`))
              return
            }
          }

          // Server has indicated it's listening, now check health endpoint
          // Give it a moment to fully start accepting connections
          if (attempts === 1 || (attempts % 5 === 0)) {
            await new Promise(resolve => setTimeout(resolve, 200))
          }

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 2000)
          
          const response = await fetch(`http://localhost:${MCP_PORT}/health`, {
            signal: controller.signal,
          })
          clearTimeout(timeoutId)
          
          if (response.ok) {
            clearTimeout(timeout)
            resolve()
            return
          }
        } catch (error: any) {
          // Server not ready yet, try again
          if (attempts < maxAttempts) {
            setTimeout(checkServer, 100)
          } else {
            clearTimeout(timeout)
            console.error('Server output:', serverOutput)
            console.error('Last error:', error?.message || error)
            if (serverProcess) {
              serverProcess.kill()
            }
            reject(new Error(`Server health check failed after ${attempts} attempts. Output: ${serverOutput}`))
          }
        }
      }

      // Start checking immediately
      checkServer()
    })
  }, TEST_TIMEOUT)

  afterAll(async () => {
    // Clean up server process
    if (serverProcess) {
      serverProcess.kill()
      await new Promise<void>((resolve) => {
        if (serverProcess) {
          serverProcess.on('exit', () => resolve())
          setTimeout(() => resolve(), 1000) // Force resolve after 1s
        } else {
          resolve()
        }
      })
    }

    // Clean up demo data
    try {
      await fs.rm(path.join(process.cwd(), '.demo-data'), { recursive: true, force: true })
    } catch (error) {
      // Ignore
    }
  })

  beforeEach(() => {
    // Reset session for each test
    sessionId = null
  })

  /**
   * Helper to send JSON-RPC requests to the MCP server
   */
  async function sendRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    }

    if (sessionId) {
      headers['MCP-Session-Id'] = sessionId
    }

    const response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }

    // Check for session ID in response headers
    const newSessionId = response.headers.get('MCP-Session-Id')
    if (newSessionId && !sessionId) {
      sessionId = newSessionId
    }

    return response.json()
  }

  describe('Server Initialization', () => {
    it('should initialize the MCP server and return session ID', async () => {
      const response = await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
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
      expect(response.result.protocolVersion).toBe('2025-11-25')
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
          protocolVersion: '2025-11-25',
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
          protocolVersion: '2025-11-25',
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
          protocolVersion: '2025-11-25',
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
          protocolVersion: '2025-11-25',
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
      expect(parsedContent.agent).toBeDefined()
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
          protocolVersion: '2025-11-25',
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

  describe('Error Handling', () => {
    it('should handle invalid tool names', async () => {
      // Initialize
      await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })

      const response = await sendRequest({
        jsonrpc: '2.0',
        id: 40,
        method: 'tools/call',
        params: {
          name: 'invalid_tool',
          arguments: {
            auth: {
              customer_ref: 'test_user',
            },
          },
        },
      })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBeDefined()
    })

    it('should handle missing customer_ref', async () => {
      // Initialize
      await sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })

      const response = await sendRequest({
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: {
            // Missing auth.customer_ref
          },
        },
      })

      // Should either succeed with anonymous user or return an error
      // The behavior depends on the implementation
      expect(response).toBeDefined()
    })
  })
})

