/**
 * Suite `merchant-sign-in`: how a merchant's MCP server signs its customers in
 * and lists its own paid and free tools.
 *
 * `merchantMcpHttp` builds the whole HTTP surface (`createSolvaPayMcpFetch` from
 * `@solvapay/mcp/fetch`) and sends `requests` to it in order, as real
 * `Request`s. SolvaPay's API answers from `api`; every request the server sends
 * it is recorded with its query, the headers it forwards and its raw body.
 *
 * `merchantTools` registers the merchant tools a case lists through
 * `additionalTools` and reads them as a host does: `tools/list` (the merchant's
 * tools only) and `tools/call` for each of `calls`.
 */
import { createRequire } from 'node:module'
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server'
import { createSolvaPayMcpServer, type AdditionalToolsContext } from '@solvapay/mcp'
import { createSolvaPayMcpFetch } from '@solvapay/mcp/fetch'
import type { ResponseContext } from '@solvapay/mcp-core'
import { createSolvaPay, type FreeLimit } from '@solvapay/server'
import type { Implementation } from './operations'
import { comparableSchema } from './server-ops'

type Json = Record<string, unknown>

const CONFORMANCE_API = 'https://api.conformance.test'
const MERCHANT_ORIGIN = 'https://mcp-si.conformance.test'

// The zod instance `@solvapay/mcp` validates tool input with, for `input` schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const z: any = createRequire(createRequire(import.meta.url).resolve('@solvapay/mcp'))('zod')

interface ApiExchange {
  method: string
  path: string
  status?: number
  /** A JSON answer. */
  body?: unknown
  /** A raw answer, sent as is (with `headers`' content type, if any). */
  text?: string
  headers?: Record<string, string>
  /** The connection fails: SolvaPay is never reached. */
  unreachable?: boolean
}

/** The headers a sign-in answer is compared on. */
const COMPARED_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  'access-control-expose-headers',
  'vary',
  'www-authenticate',
  'location',
  'allow',
  'cache-control',
  'pragma',
] as const

/** The body as JSON when it is JSON, else its text; `null` when empty. */
function bodyOf(text: string, contentType: string): unknown {
  if (text === '') return null
  if (/json/.test(contentType)) {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }
  return text
}

async function outcomeOf(response: Response): Promise<Json> {
  const headers: Json = {}
  const contentType = response.headers.get('content-type')
  // Only the media type: `charset` spelling is not behaviour.
  if (contentType) headers['content-type'] = contentType.split(';')[0].trim().toLowerCase()
  for (const name of COMPARED_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) headers[name] = value
  }
  return {
    status: response.status,
    headers,
    body: bodyOf(await response.text(), contentType ?? ''),
  }
}

/** Answers `fetch` from `api` and records each request SolvaPay gets. */
function scriptedApi(api: ApiExchange[]) {
  const pending = [...api]
  const apiCalls: Json[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    const forwarded: Json = {}
    for (const name of ['content-type', 'authorization']) {
      const value = headers.get(name)
      if (value !== null) forwarded[name] = value
    }
    apiCalls.push({
      method,
      path: url.pathname,
      ...(url.search ? { query: url.search.slice(1) } : {}),
      headers: forwarded,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    })
    const at = pending.findIndex(e => e.method === method && e.path === url.pathname)
    if (at < 0) throw new Error(`Unexpected API call: ${method} ${url.pathname}`)
    const [exchange] = pending.splice(at, 1)
    if (exchange.unreachable) throw new TypeError('fetch failed')
    const text =
      exchange.text !== undefined
        ? exchange.text
        : exchange.body !== undefined
          ? JSON.stringify(exchange.body)
          : ''
    const responseHeaders = new Headers(exchange.headers)
    if (exchange.body !== undefined && !responseHeaders.has('content-type')) {
      responseHeaders.set('content-type', 'application/json')
    }
    return new Response(text === '' ? null : text, {
      status: exchange.status ?? 200,
      headers: responseHeaders,
    })
  }) as typeof fetch
  return { fetchImpl, apiCalls, pending }
}

async function merchantMcpHttp(args: Json): Promise<unknown> {
  const { fetchImpl, apiCalls, pending } = scriptedApi((args.api ?? []) as ApiExchange[])
  const realFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  const warn = console.warn
  const info = console.info
  // The bridge logs its configuration and DCR failures; a case compares answers.
  console.warn = () => undefined
  console.info = () => undefined
  try {
    const handler = createSolvaPayMcpFetch({
      solvaPay: createSolvaPay({ apiKey: 'sk_sandbox_conformance', apiBaseUrl: CONFORMANCE_API }),
      productRef: args.productRef as string,
      resourceUri: 'ui://conformance/mcp-app.html',
      readHtml: async () => '',
      publicBaseUrl: args.publicBaseUrl as string,
      apiBaseUrl: CONFORMANCE_API,
      ...(typeof args.mcpPath === 'string' ? { mcpPath: args.mcpPath } : {}),
      ...(args.oauthPaths !== undefined ? { oauthPaths: args.oauthPaths as never } : {}),
    })
    const responses: unknown[] = []
    for (const spec of args.requests as Json[]) {
      const method = (spec.method as string | undefined) ?? 'GET'
      const headers = new Headers((spec.headers ?? {}) as Record<string, string>)
      let body: string | undefined
      if (typeof spec.rawBody === 'string') body = spec.rawBody
      else if (spec.body !== undefined) {
        body = JSON.stringify(spec.body)
        if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      }
      const response = await handler(
        new Request(`${MERCHANT_ORIGIN}${spec.path as string}`, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
        }),
      )
      responses.push(await outcomeOf(response))
    }
    if (pending.length > 0) {
      throw new Error(`API calls not made: ${pending.map(e => `${e.method} ${e.path}`).join(', ')}`)
    }
    return { responses, apiCalls }
  } finally {
    globalThis.fetch = realFetch
    console.warn = warn
    console.info = info
  }
}

// ---- merchantTools ------------------------------------------------------------

interface InputProperty {
  type: 'string' | 'integer' | 'number' | 'boolean'
  description?: string
  optional?: boolean
}

interface MerchantTool {
  name: string
  kind: 'payable' | 'free'
  title?: string
  description?: string
  annotations?: Json
  meta?: Json
  freeLimit?: FreeLimit
  input?: Record<string, InputProperty>
  /** `shape` passes `input` as a raw zod shape, `object` as a `z.object`. */
  inputAs?: 'shape' | 'object'
  /** The tool's customer; `null` for none. */
  customerRef?: string | null
}

function zodShape(input: Record<string, InputProperty>): Json {
  const shape: Json = {}
  for (const [name, property] of Object.entries(input)) {
    let field = property.type === 'integer' ? z.number().int() : z[property.type]()
    if (property.description) field = field.describe(property.description)
    if (property.optional) field = field.optional()
    shape[name] = field
  }
  return shape
}

async function merchantTools(args: Json): Promise<unknown> {
  const tools = args.tools as MerchantTool[]
  const register = ({ registerPayable, registerFree }: AdditionalToolsContext) => {
    for (const tool of tools) {
      const shape = tool.input ? zodShape(tool.input) : undefined
      const options = {
        handler: (async (received: Json, ctx: ResponseContext) =>
          ctx.respond({ received })) as never,
        getCustomerRef: () => (tool.customerRef ?? null) as string,
        ...(tool.title !== undefined ? { title: tool.title } : {}),
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
        ...(tool.meta !== undefined ? { meta: tool.meta } : {}),
        ...(shape ? { schema: tool.inputAs === 'object' ? z.object(shape) : shape } : {}),
      }
      if (tool.kind === 'free') {
        registerFree(tool.name, { ...options, limit: tool.freeLimit as FreeLimit } as never)
      } else {
        registerPayable(tool.name, options as never)
      }
    }
  }
  let server: McpServer
  try {
    server = createSolvaPayMcpServer({
      additionalTools: register,
      solvaPay: createSolvaPay({ apiKey: 'sk_sandbox_conformance', apiBaseUrl: CONFORMANCE_API }),
      productRef: args.productRef as string,
      resourceUri: 'ui://conformance/mcp-app.html',
      readHtml: async () => '',
      publicBaseUrl: 'https://mcp-si.conformance.test',
      apiBaseUrl: CONFORMANCE_API,
      // `{ audiences, bypass: false }`: the object form, with ChatGPT's bypass turned off.
      ...(args.hideToolsByAudience !== undefined
        ? {
            hideToolsByAudience: {
              audiences: (args.hideToolsByAudience as Json).audiences as string[],
              bypassWhen: () => (args.hideToolsByAudience as Json).bypass === true,
            },
          }
        : {}),
    })
  } catch {
    // Registration refused the tools (the message is for people).
    return { refused: true }
  }

  const [client, serverSide] = InMemoryTransport.createLinkedPair()
  const answers = new Map<number, (message: Json) => void>()
  client.onmessage = message => {
    const id = (message as { id?: unknown }).id
    if (typeof id === 'number') answers.get(id)?.(message as Json)
  }
  await server.connect(serverSide)
  await client.start()
  let nextId = 0
  const request = (method: string, params: Json = {}) =>
    new Promise<Json>((resolve, reject) => {
      const id = ++nextId
      answers.set(id, message => {
        answers.delete(id)
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
        else resolve(message.result as Json)
      })
      void client.send({ jsonrpc: '2.0', id, method, params })
    })
  try {
    await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: String(args.clientName ?? 'conformance'), version: '1.0.0' },
    })
    await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const names = new Set(tools.map(tool => tool.name))
    const listed = ((await request('tools/list')).tools as Json[])
      .filter(tool => names.has(tool.name as string))
      .map(tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        _meta: tool._meta,
        inputSchema: comparableSchema(tool.inputSchema),
      }))
      .sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1))
    const results: unknown[] = []
    for (const call of (args.calls ?? []) as Json[]) {
      const result = await request('tools/call', {
        name: call.name,
        arguments: (call.arguments ?? {}) as Json,
      })
      results.push({
        content: result.content,
        structuredContent: result.structuredContent,
        isError: result.isError === true ? true : undefined,
      })
    }
    return { tools: listed, ...(results.length > 0 ? { calls: results } : {}) }
  } finally {
    await server.close()
  }
}

export const MERCHANT_SIGN_IN_OPERATIONS: Record<string, Implementation[]> = {
  merchantMcpHttp: [{ name: 'mcp-fetch', run: args => merchantMcpHttp(args) }],
  merchantTools: [{ name: 'mcp', run: args => merchantTools(args) }],
}
