import 'dotenv/config'
import express, { Request, Response } from 'express'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpOAuthBridge } from '@solvapay/mcp/express'
import { verifyWebhook } from '@solvapay/server'
import { createMCPServer } from './server'
import {
  host,
  mcpPublicBaseUrl,
  paywallEnabled,
  port,
  solvapayApiBaseUrl,
  solvapayProductRef,
  solvapayWebhookSecret,
} from './config'

// SDK v2 is stateless: no session map, no `initialize` routing. The factory
// runs per request and `createMcpHandler` owns the transport lifecycle.
const mcpHandler = createMcpHandler(() => createMCPServer())

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

// Pass `req.body` explicitly — Express calls `(req, res, next)`, and
// `toNodeHandler` must not treat `next` as the parsed body (stream already
// consumed by `express.json()`).
const handleMcp = toNodeHandler(mcpHandler)
app.all('/mcp', (req, res) => {
  void handleMcp(req, res, req.body)
})

app.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host
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
