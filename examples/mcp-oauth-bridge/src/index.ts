import 'dotenv/config'
import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createMcpOAuthBridge } from '@solvapay/mcp'
import { verifyWebhook } from '@solvapay/server'
import { createMCPServer } from './server'
import {
  mcpPublicBaseUrl,
  paywallEnabled,
  solvapayApiBaseUrl,
  solvapayProductRef,
  solvapayWebhookSecret,
} from './config'

type JsonRpcId = string | number | null

type SessionEntry = {
  transport: StreamableHTTPServerTransport
}

const sessions: Record<string, SessionEntry> = {}

const app = express()
// Use raw body for signature verification before JSON middleware transforms it.
app.post('/webhooks', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
  if (!solvapayWebhookSecret) {
    console.error('SOLVAPAY_WEBHOOK_SECRET is not configured')
    res.status(500).json({ received: false, error: 'Webhook secret is not configured' })
    return
  }

  const signatureHeader = req.headers['sv-signature']
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : (signatureHeader ?? '')
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : ''

  try {
    const event = verifyWebhook({
      body: rawBody,
      signature,
      secret: solvapayWebhookSecret,
    })

    if (event.type === 'customer.created') {
      console.warn('Received customer.created webhook', event.data.object)
    }

    if (event.type === 'payment.succeeded') {
      console.warn('Received payment.succeeded test webhook', event.data.object)
    }

    console.warn('Received webhook', JSON.stringify(event, null, 2))

    res.status(200).json({ received: true })
  } catch (error) {
    console.error('Webhook verification failed', error)
    res.status(400).json({ received: false, error: 'Invalid webhook signature' })
  }
})

app.use(express.json())
// /oauth/token uses application/x-www-form-urlencoded; parse it so the bridge can forward it.
app.use(express.urlencoded({ extended: false }))
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
const configuredHost = process.env.MCP_HOST || '0.0.0.0'
// Use an IPv4-compatible bind by default so webhooks posted to 127.0.0.1 can connect.
const host = configuredHost === 'localhost' ? '0.0.0.0' : configuredHost
const displayHost = host === '0.0.0.0' ? 'localhost' : host

app.listen(port, host, () => {
  console.error(`MCP OAuth bridge listening on http://${displayHost}:${port}`)
  console.error(`  Product:  ${solvapayProductRef || '(none)'}`)
  console.error(`  API:      ${solvapayApiBaseUrl}`)
  console.error(`  Paywall:  ${paywallEnabled ? 'enabled' : 'disabled'}`)
  if (!solvapayWebhookSecret) {
    console.error(
      '  Webhooks: SOLVAPAY_WEBHOOK_SECRET is missing, webhook signature verification will fail',
    )
  }
})
