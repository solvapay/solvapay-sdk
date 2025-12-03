/* eslint-disable no-useless-catch */
import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'
import { createTask, getTask, listTasks, deleteTask } from '@solvapay/demo-services'
import type {
  CreateTaskArgs,
  GetTaskArgs,
  ListTasksArgs,
  DeleteTaskArgs,
} from './types/mcp'
import express, { Request, Response } from 'express'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { EventStore, StreamId, EventId } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

// Initialize paywall system (using shared stub client)
// Use in-memory storage for tests (file storage gets cleaned up by tests anyway)
const apiClient = createStubClient({
  useFileStorage: false, // In-memory only (tests delete .demo-data)
  freeTierLimit: 3, // 3 free calls per day per plan
  debug: true,
})

// Initialize SolvaPay with the new unified API
const solvaPay = createSolvaPay({
  apiClient,
})

// Create payable handler with explicit MCP adapter
const payable = solvaPay.payable({ agent: 'basic-crud' })

// Define available tools for the MCP server
const tools: Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the task to create',
        },
        description: {
          type: 'string',
          description: 'Optional description of the task',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_task',
    description: 'Get a task by ID (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to retrieve',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 10)',
        },
        offset: {
          type: 'number',
          description: 'Number of tasks to skip (default: 0)',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task by ID (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to delete',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['id'],
    },
  },
]

// CRUD operation handlers - wrapping shared service functions
async function createTaskMCP(args: CreateTaskArgs) {
  const result = await createTask(args)
  return {
    success: result.success,
    message: 'Task created successfully',
    task: result.task,
  }
}

async function getTaskMCP(args: GetTaskArgs) {
  const result = await getTask(args)
  return {
    success: result.success,
    task: result.task,
  }
}

async function listTasksMCP(args: ListTasksArgs) {
  const result = await listTasks(args)
  return {
    success: result.success,
    tasks: result.tasks,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }
}

async function deleteTaskMCP(args: DeleteTaskArgs) {
  const result = await deleteTask(args)
  return {
    success: result.success,
    message: result.message,
    deletedTask: result.deletedTask,
  }
}

// Function to create a new MCP server instance
function createMCPServer() {
  const server = new Server(
    {
      name: 'solvapay-crud-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools,
    }
  })

  // Handle tool execution
  // Note: We use type assertion to bypass strict type checks for the handler registration
  ;(server.setRequestHandler as any)(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'create_task': {
          const handler = payable.mcp(createTaskMCP as any)
          return await handler(args as CreateTaskArgs)
        }

        case 'get_task': {
          const handler = payable.mcp(getTaskMCP as any)
          return await handler(args as GetTaskArgs)
        }

        case 'list_tasks': {
          const handler = payable.mcp(listTasksMCP as any)
          return await handler(args as ListTasksArgs)
        }

        case 'delete_task': {
          const handler = payable.mcp(deleteTaskMCP as any)
          return await handler(args as DeleteTaskArgs)
        }

        default:
          throw new Error(`Unknown tool: ${name}`)
      }
    } catch (error) {
      throw error
    }
  })

  return server
}

// Simple in-memory event store for resumability support
class SimpleEventStore implements EventStore {
  private events: Map<StreamId, Array<{ eventId: EventId; message: JSONRPCMessage }>> = new Map()

  /**
   * Generates a unique event ID for a given stream ID
   */
  private generateEventId(streamId: StreamId): EventId {
    return `${streamId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Extracts the stream ID from an event ID (format: streamId-timestamp-random)
   */
  private getStreamIdFromEventId(eventId: EventId): StreamId | undefined {
    const parts = eventId.split('-')
    if (parts.length >= 3) {
      // Remove timestamp and random parts, rejoin the rest
      return parts.slice(0, -2).join('-')
    }
    return undefined
  }

  /**
   * Stores an event with a generated event ID
   */
  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    if (!this.events.has(streamId)) {
      this.events.set(streamId, [])
    }
    const eventId = this.generateEventId(streamId)
    this.events.get(streamId)!.push({ eventId, message })
    return eventId
  }

  /**
   * Get the stream ID associated with a given event ID
   */
  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.getStreamIdFromEventId(eventId)
  }

  /**
   * Replays events that occurred after a specific event ID
   */
  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    const streamId = this.getStreamIdFromEventId(lastEventId)
    if (!streamId) {
      throw new Error(`Cannot determine stream ID for event ID: ${lastEventId}`)
    }

    const events = this.events.get(streamId) || []
    const lastIndex = events.findIndex(e => e.eventId === lastEventId)

    if (lastIndex < 0) {
      // Event not found, return stream ID anyway
      return streamId
    }

    // Replay events after the last event ID
    for (let i = lastIndex + 1; i < events.length; i++) {
      await send(events[i].eventId, events[i].message)
    }

    return streamId
  }

  clear(streamId: StreamId): void {
    this.events.delete(streamId)
  }
}

// Validate Origin header to prevent DNS rebinding attacks
function validateOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) {
    // Allow requests without Origin header (e.g., from same origin or curl)
    return true
  }

  try {
    const originUrl = new URL(origin)
    // For localhost, allow localhost and 127.0.0.1
    if (host === 'localhost' || host === '127.0.0.1') {
      return (
        originUrl.hostname === 'localhost' ||
        originUrl.hostname === '127.0.0.1' ||
        originUrl.hostname === '[::1]'
      )
    }
    // For production, validate against allowed origins
    // You should configure this based on your deployment
    return originUrl.hostname === host
  } catch {
    return false
  }
}

// Start the server
async function main() {
  const transportMode = process.env.MCP_TRANSPORT || 'stdio' // 'stdio' or 'http'
  const port = parseInt(process.env.MCP_PORT || '3003', 10)
  const host = process.env.MCP_HOST || 'localhost'

  if (transportMode === 'http') {
    const app = express()
    
    // Parse JSON bodies
    app.use(express.json())
    
    // CORS configuration - validate Origin header
    app.use((req, res, next) => {
      const origin = req.headers.origin
      if (origin && !validateOrigin(origin, host)) {
        res.status(403).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Invalid origin',
          },
          id: null,
        })
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

    // Map to store transports by session ID
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {}
    const eventStore = new SimpleEventStore()

    // POST endpoint - handles JSON-RPC messages
    app.post('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const protocolVersion = req.headers['mcp-protocol-version'] as string | undefined

      // Validate protocol version
      if (protocolVersion && !['2024-11-05', '2025-03-26', '2025-11-25'].includes(protocolVersion)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Unsupported protocol version',
          },
          id: null,
        })
        return
      }

      try {
        let transport: StreamableHTTPServerTransport

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport for existing session
          transport = transports[sessionId]
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request - create new transport
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            eventStore, // Enable resumability
            onsessioninitialized: (sid) => {
              console.log(`Session initialized with ID: ${sid}`)
              transports[sid] = transport
            },
          })

          // Set up cleanup handler
          transport.onclose = () => {
            const sid = transport.sessionId
            if (sid && transports[sid]) {
              console.log(`Transport closed for session ${sid}, cleaning up`)
              delete transports[sid]
              eventStore.clear(sid)
            }
          }

          // Connect transport to server BEFORE handling request
          const server = createMCPServer()
          await server.connect(transport)

          // Handle the initialization request
          await transport.handleRequest(req, res, req.body)
          return
        } else {
          // Invalid request - no session ID or not initialization
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          })
          return
        }

        // Handle request with existing transport
        await transport.handleRequest(req, res, req.body)
      } catch (error) {
        console.error('Error handling MCP request:', error)
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          })
        }
      }
    })

    // GET endpoint - opens SSE stream for server-to-client messages
    app.get('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const lastEventId = req.headers['last-event-id'] as string | undefined

      if (!sessionId || !transports[sessionId]) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Invalid or missing session ID',
          },
          id: null,
        })
        return
      }

      if (lastEventId) {
        console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`)
      } else {
        console.log(`Establishing new SSE stream for session ${sessionId}`)
      }

      const transport = transports[sessionId]
      await transport.handleRequest(req, res)
    })

    // DELETE endpoint - session termination
    app.delete('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (!sessionId || !transports[sessionId]) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Invalid or missing session ID',
          },
          id: null,
        })
        return
      }

      console.log(`Received session termination request for session ${sessionId}`)

      try {
        const transport = transports[sessionId]
        await transport.handleRequest(req, res)
        // Cleanup will happen in onclose handler
      } catch (error) {
        console.error('Error handling session termination:', error)
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          })
        }
      }
    })
    
    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', transport: 'streamable-http' })
    })

    // Bind to localhost for security (unless explicitly configured otherwise)
    const bindHost = host === '0.0.0.0' ? '127.0.0.1' : host

    app.listen(port, bindHost, () => {
      console.error(`🚀 SolvaPay CRUD MCP Server started (Streamable HTTP mode)`)
      console.error(`💡 MCP Endpoint: http://${bindHost}:${port}/mcp`)
      console.error(`📝 Available tools: create_task, get_task, list_tasks, delete_task`)
      console.error(`🔒 Security: Origin validation enabled, bound to ${bindHost}`)
    })

    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...')
      for (const sessionId in transports) {
        try {
          await transports[sessionId].close()
          delete transports[sessionId]
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error)
        }
      }
      process.exit(0)
    })

  } else {
    // Stdio mode - default for MCP clients
    const server = createMCPServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)

    console.error('🚀 SolvaPay CRUD MCP Server started (stdio mode)')
    console.error('📝 Available tools: create_task, get_task, list_tasks, delete_task')
    console.error('💰 Paywall: 3 free operations per day, then €5.00 for credits')
  }
}

main().catch(error => {
  console.error('Failed to start MCP server:', error)
  process.exit(1)
})
