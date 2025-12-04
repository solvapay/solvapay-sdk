import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createMCPServer, registerMCPHandlers } from './server'
import { SimpleEventStore } from './event-store'
import { validateOrigin, createErrorResponse } from './utils'

export interface SessionManager {
  transports: Record<string, StreamableHTTPServerTransport>
  servers: Record<string, Server>
  eventStore: SimpleEventStore
}

/**
 * Create a new session manager
 */
export function createSessionManager(): SessionManager {
  return {
    transports: {},
    servers: {},
    eventStore: new SimpleEventStore(),
  }
}

/**
 * Setup CORS middleware
 */
export function setupCORS(app: express.Application, host: string): void {
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && !validateOrigin(origin, host)) {
      res.status(403).json(createErrorResponse(-32000, 'Invalid origin'))
      return
    }
    // Set CORS headers
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })
}

/**
 * Validate protocol version
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-11-25']

export function validateProtocolVersion(version: string | undefined): boolean {
  if (!version) return true
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version)
}

/**
 * Handle POST requests (JSON-RPC messages)
 */
export function setupPostEndpoint(
  app: express.Application,
  sessionManager: SessionManager
): void {
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    const protocolVersion = req.headers['mcp-protocol-version'] as string | undefined

    // Validate protocol version
    if (!validateProtocolVersion(protocolVersion)) {
      res.status(400).json(createErrorResponse(-32000, 'Unsupported protocol version'))
      return
    }

    try {
      let transport: StreamableHTTPServerTransport
      let server: Server

      if (sessionId && sessionManager.transports[sessionId]) {
        // Reuse existing transport and server for existing session
        transport = sessionManager.transports[sessionId]
        server = sessionManager.servers[sessionId]
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request - create new server and transport
        // CRITICAL: Register handlers BEFORE creating transport or connecting
        // This matches the stdio pattern exactly
        server = createMCPServer()
        registerMCPHandlers(server)
        
        // Create transport AFTER handlers are registered
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore: sessionManager.eventStore,
          onsessioninitialized: (sid) => {
            console.error(`Session initialized with ID: ${sid}`)
            sessionManager.transports[sid] = transport
            // Store server for this session when session is initialized
            if (sid) {
              sessionManager.servers[sid] = server
            }
          },
        })

        // Set up cleanup handler
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && sessionManager.transports[sid]) {
            console.error(`Transport closed for session ${sid}, cleaning up`)
            delete sessionManager.transports[sid]
            delete sessionManager.servers[sid]
            sessionManager.eventStore.clear(sid)
          }
        }

        // Connect server to transport AFTER handlers are registered
        await server.connect(transport)

        // Handle the initialization request
        await transport.handleRequest(req, res, req.body)
        return
      } else {
        // Invalid request - no session ID or not initialization
        res.status(400).json(createErrorResponse(-32000, 'Bad Request: No valid session ID provided'))
        return
      }

      // Handle request with existing transport
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('Error handling MCP request:', error)
      if (!res.headersSent) {
        res.status(500).json(createErrorResponse(-32603, 'Internal server error'))
      }
    }
  })
}

/**
 * Handle GET requests (SSE stream for server-to-client messages)
 */
export function setupGetEndpoint(
  app: express.Application,
  sessionManager: SessionManager
): void {
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    const lastEventId = req.headers['last-event-id'] as string | undefined

    if (!sessionId || !sessionManager.transports[sessionId]) {
      res.status(400).json(createErrorResponse(-32000, 'Invalid or missing session ID'))
      return
    }

    if (lastEventId) {
      console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`)
    } else {
      console.error(`Establishing new SSE stream for session ${sessionId}`)
    }

    const transport = sessionManager.transports[sessionId]
    await transport.handleRequest(req, res)
  })
}

/**
 * Handle DELETE requests (session termination)
 */
export function setupDeleteEndpoint(
  app: express.Application,
  sessionManager: SessionManager
): void {
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (!sessionId || !sessionManager.transports[sessionId]) {
      res.status(400).json(createErrorResponse(-32000, 'Invalid or missing session ID'))
      return
    }

    console.error(`Received session termination request for session ${sessionId}`)

    try {
      const transport = sessionManager.transports[sessionId]
      await transport.handleRequest(req, res)
      // Cleanup will happen in onclose handler
    } catch (error) {
      console.error('Error handling session termination:', error)
      if (!res.headersSent) {
        res.status(500).json(createErrorResponse(-32603, 'Internal server error'))
      }
    }
  })
}

/**
 * Setup health check endpoint
 */
export function setupHealthEndpoint(app: express.Application): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', transport: 'streamable-http' })
  })
}

/**
 * Setup shutdown handler
 */
export function setupShutdownHandler(sessionManager: SessionManager): void {
  process.on('SIGINT', async () => {
    console.error('Shutting down server...')
    for (const sessionId in sessionManager.transports) {
      try {
        await sessionManager.transports[sessionId].close()
        delete sessionManager.transports[sessionId]
        delete sessionManager.servers[sessionId]
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error)
      }
    }
    process.exit(0)
  })
}

/**
 * Start HTTP transport server
 */
export async function startHTTPTransport(port: number, host: string): Promise<void> {
  const app = express()
  
  // Parse JSON bodies
  app.use(express.json())
  
  // Setup session management
  const sessionManager = createSessionManager()
  
  // Setup middleware and routes
  setupCORS(app, host)
  setupPostEndpoint(app, sessionManager)
  setupGetEndpoint(app, sessionManager)
  setupDeleteEndpoint(app, sessionManager)
  setupHealthEndpoint(app)
  setupShutdownHandler(sessionManager)

  // Bind to localhost for security (unless explicitly configured otherwise)
  const bindHost = host === '0.0.0.0' ? '127.0.0.1' : host

  app.listen(port, bindHost, () => {
    console.error(`🚀 SolvaPay CRUD MCP Server started (Streamable HTTP mode)`)
    console.error(`💡 MCP Endpoint: http://${bindHost}:${port}/mcp`)
    console.error(`📝 Available tools: create_task, get_task, list_tasks, delete_task`)
    console.error(`🔒 Security: Origin validation enabled, bound to ${bindHost}`)
  })
}

