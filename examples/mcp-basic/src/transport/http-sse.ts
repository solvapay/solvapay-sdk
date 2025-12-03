/**
 * HTTP Server Wrapper for MCP Server
 * 
 * Exposes MCP server functionality via HTTP REST endpoints
 * This allows external access to the MCP server without requiring stdio transport
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { JSONRPCRequest, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export interface HTTPServerOptions {
  port?: number
  host?: string
  allowedOrigins?: string[]
  requireAuth?: boolean
  authToken?: string
}

export class HTTPServerWrapper {
  private httpServer: any
  private endpointUrl: string = ''

  constructor(
    private mcpServer: Server,
    private options: HTTPServerOptions = {}
  ) {}

  async start(): Promise<void> {
    // Dynamic import to avoid requiring express at build time
    const express = (await import('express')).default
    const cors = (await import('cors')).default

    const app = express()
    app.use(express.json())
    app.use(cors({
      origin: (origin, callback) => {
        const allowedOrigins = this.options.allowedOrigins || ['*']
        if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
          callback(null, true)
        } else {
          callback(new Error('Not allowed by CORS'))
        }
      },
      credentials: true,
    }))

    const port = this.options.port || 3000
    const host = this.options.host || 'localhost'

    // REST endpoint for listing tools
    app.get('/tools', async (_req: any, res: any) => {
      try {
        const result = await this.handleRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        })
        res.json(result)
      } catch (error: any) {
        res.status(500).json({ error: error.message })
      }
    })

    // REST endpoint for calling tools
    app.post('/tools/call', async (req: any, res: any) => {
      try {
        // Validate auth if required
        if (this.options.requireAuth && this.options.authToken) {
          const authHeader = req.headers.authorization
          const token = authHeader?.replace('Bearer ', '')
          if (token !== this.options.authToken) {
            res.status(401).json({ error: 'Unauthorized' })
            return
          }
        }

        const { name, arguments: args } = req.body

        if (!name) {
          res.status(400).json({ error: 'Tool name is required' })
          return
        }

        const result = await this.handleRequest({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name,
            arguments: args || {},
          },
        })

        res.json(result)
      } catch (error: any) {
        res.status(500).json({ error: error.message })
      }
    })

    // Health check endpoint
    app.get('/health', (_req: any, res: any) => {
      res.json({ status: 'ok', transport: 'http' })
    })

    // Root endpoint with info
    app.get('/', (_req: any, res: any) => {
      res.json({
        name: 'SolvaPay MCP Server',
        transport: 'HTTP',
        endpoints: {
          tools: `http://${host}:${port}/tools`,
          call: `http://${host}:${port}/tools/call`,
          health: `http://${host}:${port}/health`,
        },
      })
    })

    return new Promise((resolve, reject) => {
      this.httpServer = app.listen(port, host, () => {
        this.endpointUrl = `http://${host}:${port}`
        console.error(`🌐 MCP Server listening on ${this.endpointUrl}`)
        console.error(`📝 GET  ${this.endpointUrl}/tools - List available tools`)
        console.error(`📨 POST ${this.endpointUrl}/tools/call - Call a tool`)
        console.error(`❤️  GET  ${this.endpointUrl}/health - Health check`)
        resolve()
      })

      this.httpServer.on('error', (error: Error) => {
        reject(error)
      })
    })
  }

  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    try {
      let result: any

      // Access the MCP server's internal request handlers
      // The MCP SDK stores handlers in a private _requestHandlers map
      const serverInternal = this.mcpServer as any
      const requestHandlers = serverInternal._requestHandlers || serverInternal.requestHandlers

      if (request.method === 'tools/list') {
        // Call the list tools handler
        const handler = requestHandlers?.get(ListToolsRequestSchema)
        if (handler) {
          // Create a mock request object that matches what the handler expects
          const mockRequest = {
            params: {},
            method: 'tools/list',
          }
          result = await handler(mockRequest)
        } else {
          throw new Error('List tools handler not found')
        }
      } else if (request.method === 'tools/call') {
        // Call the tool execution handler
        const handler = requestHandlers?.get(CallToolRequestSchema)
        if (handler) {
          // Create a mock request object that matches what the handler expects
          const mockRequest = {
            params: request.params,
            method: 'tools/call',
          }
          result = await handler(mockRequest)
        } else {
          throw new Error('Call tool handler not found')
        }
      } else {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        } as unknown as JSONRPCResponse
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      }
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message,
        },
      } as unknown as JSONRPCResponse
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
}

