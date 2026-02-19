import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
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
    const sessionId = (req.headers['mcp-session-id'] as string) || (req.query.sessionId as string)
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
      // The transport will process the request and write responses to the event store
      // However, error responses might be written directly to the POST response
      // So we intercept the response and also write errors to the event store
      const originalJson = res.json.bind(res)
      const originalSend = res.send.bind(res)
      
      // Capture error response to write after handleRequest completes
      let capturedError: JSONRPCMessage | null = null
      
      res.json = function(body: unknown) {
          // If this is an error response with an ID, capture it to write after handleRequest
          if (body && typeof body === 'object') {
              const jsonrpcBody = body as Record<string, unknown>
              if ('jsonrpc' in jsonrpcBody && 'id' in jsonrpcBody && 'error' in jsonrpcBody) {
                  const jsonrpc = jsonrpcBody.jsonrpc
                  const id = jsonrpcBody.id
                  const error = jsonrpcBody.error
                  if (jsonrpc === '2.0' && id !== undefined && id !== null && error) {
                      capturedError = jsonrpcBody as JSONRPCMessage
                  }
              }
          }
          return originalJson(body)
      }
      
      res.send = function(body: unknown) {
          // If this is a JSON error response, parse and capture it
          if (typeof body === 'string') {
              try {
                  const parsed = JSON.parse(body) as unknown
                  if (parsed && typeof parsed === 'object' && 'jsonrpc' in parsed && 'id' in parsed && 'error' in parsed) {
                      const jsonrpcParsed = parsed as { jsonrpc: string; id: unknown; error: unknown }
                      if (jsonrpcParsed.jsonrpc === '2.0' && jsonrpcParsed.id !== undefined && jsonrpcParsed.error) {
                          capturedError = jsonrpcParsed as JSONRPCMessage
                      }
                  }
              } catch {
                  // Not JSON
              }
          }
          return originalSend(body)
      }
      
      await transport.handleRequest(req, res, req.body)
      
      // After handleRequest completes, write error to event store using transport's actual session ID
      if (capturedError) {
          const streamIds = new Set<string>()
          if (sessionId) streamIds.add(sessionId)
          // Use transport's session ID after handleRequest completes
          const transportSessionId = transport.sessionId
          if (transportSessionId) {
              streamIds.add(transportSessionId)
          }
          // Also include all existing stream IDs
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allStreamIds = Array.from((sessionManager.eventStore as any).events.keys()) as string[]
          allStreamIds.forEach(sid => streamIds.add(sid))
          
          // Write to all possible session IDs and wait for completion
          const writePromises = Array.from(streamIds).map(streamId =>
              sessionManager.eventStore.storeEvent(streamId, capturedError!).catch(() => {
                  // Ignore errors writing to event store
              })
          )
          
          if (writePromises.length > 0) {
              await Promise.all(writePromises)
              // Small delay to ensure it's available for polling
              await new Promise(resolve => setTimeout(resolve, 100))
          }
      }
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
    try {
      const sessionId = (req.headers['mcp-session-id'] as string) || (req.query.sessionId as string)
      const _lastEventId = req.headers['last-event-id'] as string | undefined

      if (sessionId && sessionManager.transports[sessionId]) {
          const transport = sessionManager.transports[sessionId]
          await transport.handleRequest(req, res)
          return
      }

      // If no session ID, create a new session (Connect First pattern)
      const server = createMCPServer()
      registerMCPHandlers(server)
      
      const newSessionId = randomUUID()
      
      // Track the actual session ID used by the transport
      let actualSessionId: string = newSessionId
      
      const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          eventStore: sessionManager.eventStore,
          onsessioninitialized: (sid) => {
              actualSessionId = sid as string
              // Update session mapping if session ID changed
              if (sid !== newSessionId && sessionManager.transports[newSessionId]) {
                  sessionManager.transports[sid] = sessionManager.transports[newSessionId]
                  delete sessionManager.transports[newSessionId]
                  sessionManager.servers[sid] = sessionManager.servers[newSessionId]
                  delete sessionManager.servers[newSessionId]
              } else {
                  sessionManager.transports[sid] = transport
                  sessionManager.servers[sid] = server
              }
          },
      })

      // Store transport immediately so POST requests can find it
      sessionManager.transports[newSessionId] = transport
      sessionManager.servers[newSessionId] = server

      transport.onclose = () => {
          const sid = transport.sessionId || newSessionId
          if (sid && sessionManager.transports[sid]) {
              delete sessionManager.transports[sid]
              delete sessionManager.servers[sid]
              sessionManager.eventStore.clear(sid)
          }
      }

      await server.connect(transport)
      
      // For new GET requests (Connect First pattern), manually start SSE stream
      // The transport's handleRequest requires initialization, but we need to
      // establish the SSE connection first, then initialize via POST
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('MCP-Session-Id', newSessionId)
      
      // Send endpoint event so client knows where to POST
      const endpointUrl = `/mcp?sessionId=${newSessionId}`
      res.write(`event: endpoint\n`)
      res.write(`data: ${endpointUrl}\n\n`)
      
      // Poll event store for new messages and send them via SSE
      // Track which stream IDs we've seen events for, and poll all of them
      // This handles the case where transport uses different session IDs
      const trackedStreamIds = new Set<string>([newSessionId, actualSessionId])
      const lastSentEventIds = new Map<string, string>() // Track last sent event per stream
      
      const pollInterval = setInterval(async () => {
          try {
              // Update tracked stream IDs with transport's actual session ID
              if (transport.sessionId) {
                  trackedStreamIds.add(transport.sessionId)
              }
              if (actualSessionId) {
                  trackedStreamIds.add(actualSessionId)
              }
              
              // Also check all stream IDs in event store (for new sessions)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const allStreamIds = Array.from((sessionManager.eventStore as any).events.keys()) as string[]
              allStreamIds.forEach(sid => trackedStreamIds.add(sid))
              
              // Poll all tracked stream IDs
              for (const streamId of trackedStreamIds) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const events = (sessionManager.eventStore as any).events.get(streamId) || []
                  if (events.length === 0) continue
                  
                  const lastSentId = lastSentEventIds.get(streamId)
                  const startIndex = lastSentId 
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      ? events.findIndex((e: any) => e.eventId === lastSentId) + 1
                      : 0
                  
                  // Send any new events from this stream
                  for (let i = startIndex; i < events.length; i++) {
                      const { eventId, message } = events[i]
                      res.write(`id: ${eventId}\n`)
                      res.write(`event: message\n`)
                      res.write(`data: ${JSON.stringify(message)}\n\n`)
                      lastSentEventIds.set(streamId, eventId)
                  }
              }
          } catch (error) {
              console.error('Error polling event store:', error)
          }
      }, 100) // Poll every 100ms
      
      req.on('close', () => {
          clearInterval(pollInterval)
          transport.onclose?.()
      })
    } catch (error) {
      console.error('Error handling GET request:', error)
      if (!res.headersSent) {
        res.status(500).json(createErrorResponse(-32603, `Internal server error: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
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
    const sessionId = (req.headers['mcp-session-id'] as string) || (req.query.sessionId as string)

    if (!sessionId || !sessionManager.transports[sessionId]) {
      res.status(400).json(createErrorResponse(-32000, 'Invalid or missing session ID'))
      return
    }

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

