import 'dotenv/config'
import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createMCPServer, registerMCPHandlers } from './server'
import { mcpPublicBaseUrl, oauthBaseUrl, paywallEnabled, solvapayProductRef } from './config'

type JsonRpcId = string | number | null

type SessionEntry = {
  transport: StreamableHTTPServerTransport
  customerRef?: string
}

const sessions: Record<string, SessionEntry> = {}

const app = express()
app.use(express.json())

function getOrigin(req: Request): string {
  const explicit = mcpPublicBaseUrl.replace(/\/$/, '')
  if (explicit) return explicit
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http'
  return `${proto}://${req.get('host') || 'localhost:3004'}`
}

function makeUnauthorizedJsonRpc(id: JsonRpcId) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32001,
      message: 'Unauthorized',
    },
  }
}

async function resolveCustomerRef(authHeader?: string): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const response = await fetch(`${oauthBaseUrl}/v1/customer/auth/userinfo`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
    },
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as {
    sub?: string
    customerRef?: string
    customer_ref?: string
  }

  return payload.customerRef || payload.customer_ref || payload.sub || null
}

function withMcpChallenge(res: Response, req: Request) {
  const origin = getOrigin(req)
  res.setHeader(
    'WWW-Authenticate',
    `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  )
}

app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const resource = getOrigin(req)
  res.json({
    resource,
    authorization_servers: [resource],
    scopes_supported: ['openid', 'profile', 'email'],
  })
})

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  if (!solvapayProductRef) {
    res.status(500).json({
      error: 'SOLVAPAY_PRODUCT_REF missing',
    })
    return
  }

  const registrationEndpoint =
    `${oauthBaseUrl}/v1/customer/auth/register?product_ref=${encodeURIComponent(solvapayProductRef)}`

  res.json({
    issuer: oauthBaseUrl,
    authorization_endpoint: `${oauthBaseUrl}/v1/customer/auth/authorize`,
    token_endpoint: `${oauthBaseUrl}/v1/customer/auth/token`,
    registration_endpoint: registrationEndpoint,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['openid', 'profile', 'email'],
    code_challenge_methods_supported: ['S256', 'plain'],
  })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-oauth-bridge' })
})

app.post('/mcp', async (req: Request, res: Response) => {
  const id = (req.body as { id?: JsonRpcId } | undefined)?.id ?? null
  let customerRef = 'anonymous'

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

  if (paywallEnabled) {
    if (session?.customerRef) {
      customerRef = session.customerRef
    } else {
      const authHeader = req.headers.authorization
      const resolved = await resolveCustomerRef(authHeader)
      if (!resolved) {
        withMcpChallenge(res, req)
        res.status(401).json(makeUnauthorizedJsonRpc(id))
        return
      }
      customerRef = resolved
      if (session) {
        session.customerRef = resolved
      }
    }
  }

  if (!transport && isInitializeRequest(req.body)) {
    const server = createMCPServer()
    registerMCPHandlers(server)

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        sessions[sid] = { transport: transport!, customerRef }
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

  if (
    req.body &&
    typeof req.body === 'object' &&
    (req.body as { method?: string }).method === 'tools/call'
  ) {
    const body = req.body as {
      params?: {
        arguments?: Record<string, unknown>
      }
    }
    body.params = body.params || {}
    body.params.arguments = body.params.arguments || {}
    body.params.arguments._auth = {
      customer_ref: customerRef,
    }
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

  if (paywallEnabled && !sessions[sessionId].customerRef) {
    const authHeader = req.headers.authorization
    const resolved = await resolveCustomerRef(authHeader)
    if (!resolved) {
      withMcpChallenge(res, req)
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    sessions[sessionId].customerRef = resolved
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
