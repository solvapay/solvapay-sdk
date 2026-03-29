import 'dotenv/config'
import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types'
import { createMcpOAuthBridge } from '@solvapay/server'
import { createMCPServer } from './server'
import {
  mcpPublicBaseUrl,
  paywallEnabled,
  solvapayApiBaseUrl,
  solvapayProductRef,
} from './config'

type JsonRpcId = string | number | null

type SessionEntry = {
  transport: StreamableHTTPServerTransport
}

const sessions: Record<string, SessionEntry> = {}

const app = express()
app.use(express.json())
app.use(
  ...createMcpOAuthBridge({
    publicBaseUrl: mcpPublicBaseUrl,
    apiBaseUrl: solvapayApiBaseUrl,
    productRef: solvapayProductRef,
    requireAuth: paywallEnabled,
    mcpPath: '/mcp',
  }),
)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-oauth-bridge' })
})

app.post('/mcp', async (req: Request, res: Response) => {
  const id = (req.body as { id?: JsonRpcId } | undefined)?.id ?? null

  const sessionId =
    (req.headers['mcp-session-id'] as string | undefined) ||
    (typeof req.query.sessionId === 'string' ? req.query.sessionId : '') ||
    ''
  let transport: StreamableHTTPServerTransport | null = null
  let session: SessionEntry | undefined

  if (sessionId && sessions[sessionId]) {
    session = sessions[sessionId]
    transport = session.transport
  }

  if (!transport && isInitializeRequest(req.body)) {
    const server = createMCPServer()

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        sessions[sid] = { transport: transport! }
      },
    })

    transport.onclose = () => {
      const sid = transport?.sessionId
      if (sid && sessions[sid]) {
        delete sessions[sid]
      }
    }

    await server.connect(transport)
  }

  if (!transport) {
    res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided',
      },
    })
    return
  }

  await transport.handleRequest(req, res, req.body)
})

app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId =
    (req.headers['mcp-session-id'] as string | undefined) ||
    (typeof req.query.sessionId === 'string' ? req.query.sessionId : '') ||
    ''

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).json({ error: 'Missing or invalid MCP-Session-Id' })
    return
  }

  await sessions[sessionId].transport.handleRequest(req, res)
})

app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId =
    (req.headers['mcp-session-id'] as string | undefined) ||
    (typeof req.query.sessionId === 'string' ? req.query.sessionId : '') ||
    ''

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).json({
      error: 'Missing or invalid MCP-Session-Id',
    })
    return
  }

  await sessions[sessionId].transport.handleRequest(req, res)
})

const port = parseInt(process.env.MCP_PORT || '3004', 10)
const host = process.env.MCP_HOST || 'localhost'

app.listen(port, host, () => {
  console.error(`MCP OAuth bridge listening on http://${host}:${port}`)
})
