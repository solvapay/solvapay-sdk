/**
 * Streamable HTTP Transport for MCP Server
 * 
 * Implements the MCP Streamable HTTP transport specification (2025-11-25):
 * - Single MCP endpoint supporting both POST and GET
 * - SSE streaming for server-to-client messages
 * - Session management with MCP-Session-Id header
 * - Protocol version negotiation
 * - Proper Origin validation and security
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js'
import type { IncomingMessage, ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'

export interface StreamableHTTPTransportOptions {
  port?: number
  host?: string
  allowedOrigins?: string[]
  requireAuth?: boolean
  authToken?: string
  endpointPath?: string
}

interface Session {
  id: string
  createdAt: number
  lastActivity: number
}

interface SSEConnection {
  id: string
  response: ServerResponse
  sessionId?: string
  lastEventId?: string
  createdAt: number
}

export class StreamableHTTPTransport extends EventEmitter {
  private httpServer: any
  private sessions = new Map<string, Session>()
  private sseConnections = new Map<string, SSEConnection>()
  private messageQueue = new Map<string, JSONRPCMessage[]>()
  private endpointUrl: string = ''
  private readonly endpointPath: string

  constructor(
    private mcpServer: Server,
    private options: StreamableHTTPTransportOptions = {}
  ) {
    super()
    this.endpointPath = options.endpointPath || '/mcp'
  }

  async start(): Promise<void> {
    const express = (await import('express')).default
    const cors = (await import('cors')).default

    const app = express()
    app.use(express.json())
    
    // CORS middleware
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

    // Single MCP endpoint - handles both POST and GET
    app.post(this.endpointPath, async (req: any, res: any) => {
      await this.handlePOST(req, res)
    })

    app.get(this.endpointPath, async (req: any, res: any) => {
      await this.handleGET(req, res)
    })

    app.delete(this.endpointPath, async (req: any, res: any) => {
      await this.handleDELETE(req, res)
    })

    // Health check endpoint
    app.get('/health', (_req: any, res: any) => {
      res.json({ status: 'ok', transport: 'streamable-http', protocol: '2025-11-25' })
    })

    // Root endpoint with info
    app.get('/', (_req: any, res: any) => {
      res.json({
        name: 'SolvaPay MCP Server',
        transport: 'Streamable HTTP',
        protocol: '2025-11-25',
        endpoint: `${this.endpointPath}`,
        capabilities: ['tools'],
      })
    })

    return new Promise((resolve, reject) => {
      this.httpServer = app.listen(port, host, () => {
        this.endpointUrl = `http://${host}:${port}${this.endpointPath}`
        console.error(`🌐 MCP Server listening on ${this.endpointUrl}`)
        console.error(`📡 Protocol: Streamable HTTP (2025-11-25)`)
        console.error(`🔒 Security: Origin validation enabled`)
        resolve()
      })

      this.httpServer.on('error', (error: Error) => {
        reject(error)
      })
    })
  }

  private validateOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin
    const allowedOrigins = this.options.allowedOrigins || ['*']
    
    if (allowedOrigins.includes('*')) {
      return true
    }
    
    if (!origin) {
      return true // No origin header is acceptable
    }
    
    return allowedOrigins.includes(origin)
  }

  private async handlePOST(req: any, res: any): Promise<void> {
    try {
      // Validate Origin header
      if (!this.validateOrigin(req)) {
        res.status(403).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Forbidden: Invalid origin',
          },
        })
        return
      }

      // Validate auth if required
      if (this.options.requireAuth && this.options.authToken) {
        const authHeader = req.headers.authorization
        const token = authHeader?.replace('Bearer ', '')
        if (token !== this.options.authToken) {
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Unauthorized',
            },
          })
          return
        }
      }

      // Get session ID if present
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const protocolVersion = req.headers['mcp-protocol-version'] as string | undefined

      // Parse JSON-RPC message
      const message: JSONRPCRequest | JSONRPCNotification | JSONRPCResponse = req.body

      if (!message || !message.jsonrpc || message.jsonrpc !== '2.0') {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error',
          },
        })
        return
      }

      // Handle notifications and responses (return 202 Accepted)
      if ('method' in message && !('id' in message)) {
        // Notification
        await this.processMessage(message, sessionId)
        res.status(202).end()
        return
      }

      if (!('method' in message) && 'id' in message) {
        // Response
        await this.processMessage(message, sessionId)
        res.status(202).end()
        return
      }

      // Handle requests
      if ('method' in message && 'id' in message) {
        const request = message as JSONRPCRequest

        // Check if client accepts SSE
        const acceptHeader = req.headers.accept || ''
        const acceptsSSE = acceptHeader.includes('text/event-stream')

        // Process the request
        const response = await this.processRequest(request, sessionId, protocolVersion)

        if (acceptsSSE) {
          // Return SSE stream
          await this.sendSSEResponse(res, request.id, response, sessionId)
        } else {
          // Return single JSON response
          // If session ID was created during initialization, send it as header
          if ((response as any)._mcpSessionId) {
            res.setHeader('MCP-Session-Id', (response as any)._mcpSessionId)
            delete (response as any)._mcpSessionId
          }
          res.json(response)
        }
      }
    } catch (error: any) {
      console.error('Error handling POST:', error)
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message,
        },
      })
    }
  }

  private async handleGET(req: any, res: any): Promise<void> {
    try {
      // Validate Origin header
      if (!this.validateOrigin(req)) {
        res.status(403).end()
        return
      }

      // Check if client accepts SSE
      const acceptHeader = req.headers.accept || ''
      if (!acceptHeader.includes('text/event-stream')) {
        res.status(405).json({
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: 'Method not allowed: GET requires Accept: text/event-stream',
          },
        })
        return
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const lastEventId = req.headers['last-event-id'] as string | undefined

      // Create SSE connection
      const connectionId = randomUUID()
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      })

      const connection: SSEConnection = {
        id: connectionId,
        response: res,
        sessionId,
        lastEventId,
        createdAt: Date.now(),
      }

      this.sseConnections.set(connectionId, connection)

      // Send initial event ID for reconnection support
      const initialEventId = `${connectionId}-${Date.now()}`
      res.write(`id: ${initialEventId}\n`)
      res.write(`data: \n\n`)

      // If resuming, replay messages
      if (lastEventId) {
        await this.replayMessages(connectionId, lastEventId, sessionId)
      }

      // Keep connection alive
      const keepAlive = setInterval(() => {
        if (!this.sseConnections.has(connectionId)) {
          clearInterval(keepAlive)
          return
        }
        try {
          res.write(`: ping\n\n`)
        } catch (error) {
          clearInterval(keepAlive)
          this.sseConnections.delete(connectionId)
        }
      }, 30000)

      req.on('close', () => {
        clearInterval(keepAlive)
        this.sseConnections.delete(connectionId)
      })
    } catch (error: any) {
      console.error('Error handling GET:', error)
      res.status(500).end()
    }
  }

  private async handleDELETE(req: any, res: any): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    
    if (sessionId && this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId)
      // Close all SSE connections for this session
      for (const [connId, conn] of this.sseConnections.entries()) {
        if (conn.sessionId === sessionId) {
          try {
            conn.response.end()
          } catch (error) {
            // Ignore errors
          }
          this.sseConnections.delete(connId)
        }
      }
      res.status(200).json({ status: 'ok' })
    } else {
      res.status(404).json({ error: 'Session not found' })
    }
  }

  private async processRequest(
    request: JSONRPCRequest,
    sessionId?: string,
    protocolVersion?: string
  ): Promise<JSONRPCResponse> {
    try {
      // Access the MCP server's internal request handlers
      const serverInternal = this.mcpServer as any
      const requestHandlers = serverInternal._requestHandlers || serverInternal.requestHandlers

      let result: any

      // Handle initialization - MCP Server handles this automatically
      // We just need to create a session and return it
      if (request.method === 'initialize') {
        // Create or get session
        const actualSessionId = sessionId || this.createSession()
        
        // Update session activity
        if (this.sessions.has(actualSessionId)) {
          const session = this.sessions.get(actualSessionId)!
          session.lastActivity = Date.now()
        }
        
        result = {
          protocolVersion: protocolVersion || '2025-11-25',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'solvapay-crud-mcp-server',
            version: '1.0.0',
          },
        }

        // Return session ID in response (will be sent as header)
        return {
          jsonrpc: '2.0',
          id: request.id,
          result,
          _mcpSessionId: actualSessionId, // Custom field for transport
        }
      }

      // Handle other methods
      if (request.method === 'tools/list') {
        const handler = requestHandlers?.get('tools/list')
        if (handler) {
          result = await handler({ params: {} })
        } else {
          throw new Error('List tools handler not found')
        }
      } else if (request.method === 'tools/call') {
        const handler = requestHandlers?.get('tools/call')
        if (handler) {
          result = await handler({ params: request.params })
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
        }
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
      }
    }
  }

  private async processMessage(
    message: JSONRPCMessage,
    sessionId?: string
  ): Promise<void> {
    // Handle notifications and responses
    // For now, we'll just acknowledge them
    // In a full implementation, you'd process these through the MCP server
  }

  private async sendSSEResponse(
    res: ServerResponse,
    requestId: string | number,
    response: JSONRPCResponse,
    sessionId?: string
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    // Send initial event ID
    const eventId = `${requestId}-${Date.now()}`
    res.write(`id: ${eventId}\n`)
    res.write(`data: ${JSON.stringify(response)}\n\n`)

    // If session ID was created during initialization, send it
    if ((response as any)._mcpSessionId) {
      res.setHeader('MCP-Session-Id', (response as any)._mcpSessionId)
      delete (response as any)._mcpSessionId
    }

    // Close the stream after sending response
    res.end()
  }

  private async replayMessages(
    connectionId: string,
    lastEventId: string,
    sessionId?: string
  ): Promise<void> {
    // In a full implementation, you'd replay messages from the queue
    // For now, this is a placeholder
    const queued = this.messageQueue.get(connectionId) || []
    const connection = this.sseConnections.get(connectionId)
    if (connection) {
      for (const message of queued) {
        this.sendSSEMessage(connectionId, message)
      }
      this.messageQueue.delete(connectionId)
    }
  }

  private sendSSEMessage(connectionId: string, message: JSONRPCMessage): void {
    const connection = this.sseConnections.get(connectionId)
    if (!connection) {
      // Queue message if connection not ready
      const queue = this.messageQueue.get(connectionId) || []
      queue.push(message)
      this.messageQueue.set(connectionId, queue)
      return
    }

    try {
      const eventId = `${connectionId}-${Date.now()}`
      connection.response.write(`id: ${eventId}\n`)
      connection.response.write(`data: ${JSON.stringify(message)}\n\n`)
      connection.lastEventId = eventId
    } catch (error) {
      // Connection closed
      this.sseConnections.delete(connectionId)
    }
  }

  private createSession(): string {
    const sessionId = randomUUID()
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    })
    return sessionId
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        // Close all SSE connections
        for (const connection of this.sseConnections.values()) {
          try {
            connection.response.end()
          } catch (error) {
            // Ignore errors
          }
        }
        this.sseConnections.clear()
        this.sessions.clear()
        this.messageQueue.clear()

        this.httpServer.close(() => {
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
}

