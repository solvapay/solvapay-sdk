import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyServer } from './verify'

type Handler = (
  req: IncomingMessage,
  body: Record<string, unknown> | null,
  res: ServerResponse,
) => void

let server: Server | undefined

const serve = async (handler: Handler): Promise<string> => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () =>
      handler(req, raw ? (JSON.parse(raw) as Record<string, unknown>) : null, res),
    )
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
}

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const wellKnown =
  (base: () => string): Handler =>
  (req, body, res) => {
    if (req.url === '/.well-known/oauth-protected-resource') {
      return json(res, 200, { resource: `${base()}/mcp`, authorization_servers: [base()] })
    }
    if (req.url === '/.well-known/oauth-authorization-server') {
      return json(res, 200, {
        issuer: base(),
        authorization_endpoint: `${base()}/oauth/authorize`,
        token_endpoint: `${base()}/oauth/token`,
      })
    }
    json(res, 404, { error: 'not_found' })
  }

afterEach(async () => {
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

describe('verifyServer', () => {
  it('passes a server that answers tools/list with a bearer challenge', async () => {
    let base = ''
    const discovery = wellKnown(() => base)
    base = await serve((req, body, res) => {
      if (req.url === '/mcp') {
        return json(
          res,
          401,
          { error: 'unauthorized' },
          {
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
          },
        )
      }
      discovery(req, body, res)
    })

    const summary = await verifyServer(`${base}/mcp`)

    expect(summary.overall).toBe('passed')
    expect(summary.serverUrl).toBe(base)
    expect(summary.checks.toolsList).toMatchObject({
      status: 'passed',
      value: { authRequired: true },
    })
    expect(summary.checks.paywallGate.status).toBe('skipped')
    expect(summary.warnings).toHaveLength(2)
  })

  it('fails a 401 without a challenge and a missing discovery document', async () => {
    const url = await serve((req, _body, res) => {
      if (req.url === '/mcp') return json(res, 401, { error: 'unauthorized' })
      json(res, 404, { error: 'not_found' })
    })
    const summary = await verifyServer(url)
    expect(summary.overall).toBe('failed')
    expect(summary.checks.oauthProtectedResource.status).toBe('failed')
    expect(summary.checks.toolsList).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('without a well-formed'),
    })
  })

  it('checks the gate narration of a paid tool when tools are listed', async () => {
    let base = ''
    const discovery = wellKnown(() => base)
    base = await serve((req, body, res) => {
      if (req.url !== '/mcp') return discovery(req, body, res)
      const id = body?.id
      if (body?.method === 'tools/list') {
        return json(res, 200, {
          jsonrpc: '2.0',
          id,
          result: { tools: [{ name: 'account' }, { name: 'activate_plan' }, { name: 'quote' }] },
        })
      }
      const params = body?.params as { name: string }
      if (params.name === 'quote') {
        return json(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              { type: 'text', text: 'Pick a plan: call `account`, or open https://pay.example/c' },
            ],
            structuredContent: { kind: 'payment_required', checkoutUrl: 'https://pay.example/c' },
          },
        })
      }
      return json(res, 200, {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'Plans: https://pay.example/c' }] },
      })
    })

    const summary = await verifyServer(base)

    expect(summary.checks.paywallGate).toMatchObject({ status: 'passed', value: { tool: 'quote' } })
    expect(summary.checks.intentToolsText.status).toBe('passed')
    expect(summary.overall).toBe('passed')
  })
})
