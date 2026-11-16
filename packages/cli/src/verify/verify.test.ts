import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { HANDSHAKE_PROTOCOL_VERSION } from './mcp-client'
import { verifyServer } from './verify'

type Body = Record<string, unknown> | null
type Handler = (req: IncomingMessage, body: Body, res: ServerResponse) => void

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
  (req, _body, res) => {
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

type ToolResult = Record<string, unknown>
type FakeTool = {
  name: string
  inputSchema?: Record<string, unknown>
  _meta?: Record<string, unknown>
  call?: (args: Record<string, unknown>) => ToolResult
}
type Seen = { method: string; headers: IncomingMessage['headers']; params: unknown }

const SESSION_ID = 'session-123'
const UI_META = { audience: 'ui', ui: { visibility: ['app'] } }

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] })

const gate = (): ToolResult => ({
  content: [{ type: 'text', text: 'Pick a plan: call `account`, or open https://pay.example/c' }],
  structuredContent: { kind: 'payment_required', checkoutUrl: 'https://pay.example/c' },
})

const INTENT: FakeTool[] = [
  { name: 'account', call: () => text('Plans: https://pay.example/c') },
  { name: 'activate_plan' },
]

/**
 * A fake MCP server. `stateful` behaves like the Python and Go SDK defaults:
 * after `initialize`, a request without the issued `mcp-session-id` gets 400.
 * `sse` answers with an SSE stream that sends a notification before the response.
 */
const serveMcp = async (
  tools: FakeTool[],
  { stateful = false, sse = false }: { stateful?: boolean; sse?: boolean } = {},
): Promise<{ base: string; seen: Seen[] }> => {
  const seen: Seen[] = []
  let base = ''
  const discovery = wellKnown(() => base)
  const reply = (res: ServerResponse, id: unknown, result: unknown, headers = {}) => {
    if (!sse) return json(res, 200, { jsonrpc: '2.0', id, result }, headers)
    res.writeHead(200, { 'content-type': 'text/event-stream', ...headers })
    const note = { jsonrpc: '2.0', method: 'notifications/message', params: { data: 'working' } }
    res.end(
      `data: ${JSON.stringify(note)}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`,
    )
  }
  base = await serve((req, body, res) => {
    if (req.url !== '/mcp') return discovery(req, body, res)
    const method = String(body?.method)
    seen.push({ method, headers: req.headers, params: body?.params })
    if (method === 'initialize') {
      const params = body?.params as { protocolVersion: string }
      return reply(
        res,
        body?.id,
        {
          protocolVersion: params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'fake', version: '1' },
        },
        stateful ? { 'mcp-session-id': SESSION_ID } : {},
      )
    }
    if (stateful && req.headers['mcp-session-id'] !== SESSION_ID) {
      return json(res, 400, {
        jsonrpc: '2.0',
        id: 'server-error',
        error: { code: -32600, message: 'Bad Request: Missing session ID' },
      })
    }
    if (body?.id === undefined) {
      res.writeHead(202)
      return res.end()
    }
    if (method === 'tools/list') {
      return reply(res, body.id, {
        tools: tools.map(({ name, inputSchema, _meta }) => ({
          name,
          inputSchema: inputSchema ?? { type: 'object' },
          ...(_meta ? { _meta } : {}),
        })),
      })
    }
    const params = body.params as { name: string; arguments: Record<string, unknown> }
    const tool = tools.find(entry => entry.name === params.name)
    if (!tool) {
      return json(res, 200, {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: `Unknown tool ${params.name}` },
      })
    }
    reply(res, body.id, tool.call ? tool.call(params.arguments) : text('ok'))
  })
  return { base, seen }
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

  it('fails when the server rejects the bearer token', async () => {
    let base = ''
    const discovery = wellKnown(() => base)
    base = await serve((req, body, res) => {
      if (req.url !== '/mcp') return discovery(req, body, res)
      json(
        res,
        401,
        { error: 'invalid_token' },
        { 'www-authenticate': 'Bearer error="invalid_token"' },
      )
    })

    const summary = await verifyServer(base, { bearerToken: 'expired' })

    expect(summary.overall).toBe('failed')
    expect(summary.checks.toolsList).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('rejected the bearer token'),
    })
    expect(summary.checks.merchantBootstrap.status).toBe('skipped')
  })

  it('checks the gate narration of a paid tool when tools are listed', async () => {
    const { base } = await serveMcp([...INTENT, { name: 'quote', call: gate }])

    const summary = await verifyServer(base)

    expect(summary.checks.paywallGate).toMatchObject({ status: 'passed', value: { tool: 'quote' } })
    expect(summary.checks.intentToolsText.status).toBe('passed')
    expect(summary.overall).toBe('passed')
  })

  it('opens a session and pins it on a stateful server', async () => {
    const { base, seen } = await serveMcp([...INTENT, { name: 'quote', call: gate }], {
      stateful: true,
    })

    const summary = await verifyServer(base, { bearerToken: 'token' })

    expect(summary.overall).toBe('passed')
    expect(summary.checks.toolsList).toMatchObject({
      status: 'passed',
      value: { sessionPinned: true, protocolVersion: HANDSHAKE_PROTOCOL_VERSION },
    })
    expect(seen.map(entry => entry.method).slice(0, 3)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])
    for (const entry of seen.slice(1)) {
      expect(entry.headers['mcp-session-id']).toBe(SESSION_ID)
      expect(entry.headers['mcp-protocol-version']).toBe(HANDSHAKE_PROTOCOL_VERSION)
      expect(entry.headers.authorization).toBe('Bearer token')
    }
  })

  it('reads the response frame, not an earlier notification, from an SSE stream', async () => {
    const { base } = await serveMcp([...INTENT, { name: 'quote', call: gate }], { sse: true })

    const summary = await verifyServer(base)

    expect(summary.checks.toolsList.status).toBe('passed')
    expect(summary.checks.paywallGate.status).toBe('passed')
  })

  it('probes a paid tool with arguments built from its inputSchema', async () => {
    const { base, seen } = await serveMcp([
      ...INTENT,
      {
        name: 'forecast',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            days: { type: 'integer', minimum: 1, maximum: 14, default: 7 },
          },
          required: ['city'],
        },
        call: args =>
          typeof args.city === 'string'
            ? gate()
            : {
                ...text('1 validation error for forecastArguments\ncity\n  Field required'),
                isError: true,
              },
      },
    ])

    const summary = await verifyServer(base)

    expect(summary.checks.paywallGate).toMatchObject({
      status: 'passed',
      value: { tool: 'forecast', arguments: { city: 'probe' }, kind: 'payment_required' },
    })
    const call = seen.find(
      entry =>
        entry.method === 'tools/call' && (entry.params as { name: string }).name === 'forecast',
    )
    expect((call?.params as { arguments: unknown }).arguments).toEqual({ city: 'probe' })
  })

  it('still runs the gate check when UI-only tools leak, and never calls them', async () => {
    const { base, seen } = await serveMcp([
      ...INTENT,
      { name: 'create_payment_intent', _meta: UI_META },
      { name: 'set_renewal', _meta: UI_META },
      { name: 'quote', call: gate },
    ])

    const summary = await verifyServer(base)

    expect(summary.checks.toolsList).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('create_payment_intent, set_renewal'),
    })
    expect(summary.checks.paywallGate).toMatchObject({ status: 'passed', value: { tool: 'quote' } })
    const called = seen
      .filter(entry => entry.method === 'tools/call')
      .map(entry => (entry.params as { name: string }).name)
    expect(called).not.toContain('create_payment_intent')
    expect(called).not.toContain('set_renewal')
  })

  it('says which calls errored when no tool returns a gate', async () => {
    const { base } = await serveMcp([
      ...INTENT,
      {
        name: 'lookup',
        call: () => ({ ...text('Error executing tool lookup: bad id\ndetails'), isError: true }),
      },
      { name: 'free_tool' },
    ])

    const summary = await verifyServer(base)

    expect(summary.checks.paywallGate.status).toBe('skipped')
    const reason = (summary.checks.paywallGate as { reason: string }).reason
    expect(reason).toContain('1 of 2 call(s) errored')
    expect(reason).toContain('lookup: Error executing tool lookup: bad id')
    expect(reason).not.toContain('unused balance')
  })

  it('reports later checks as not run when no session opens', async () => {
    let base = ''
    const discovery = wellKnown(() => base)
    base = await serve((req, body, res) => {
      if (req.url !== '/mcp') return discovery(req, body, res)
      json(res, 500, { error: 'boom' })
    })

    const summary = await verifyServer(base, { bearerToken: 'token' })

    expect(summary.checks.toolsList).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('MCP initialize failed: HTTP 500'),
    })
    for (const name of ['paywallGate', 'intentToolsText', 'merchantBootstrap']) {
      expect(summary.checks[name]).toMatchObject({
        status: 'skipped',
        reason: expect.stringContaining('no MCP session'),
      })
    }
  })
})
