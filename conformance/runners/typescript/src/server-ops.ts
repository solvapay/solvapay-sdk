/**
 * Operations that talk to a whole SolvaPay MCP server over MCP, the way a host
 * does: `describeServer` (what `tools/list`, `prompts/list` and `resources/list`
 * advertise) and `getPrompt` (a slash command's message). The server is
 * `@solvapay/mcp`'s `createSolvaPayMcpServer`, reached over an in-memory
 * transport after an `initialize` that names the client.
 */
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server'
import { createSolvaPayMcpServer, type AdditionalToolsContext } from '@solvapay/mcp'
import type { CustomerSnapshot, ResponseContext, ResponseOptions } from '@solvapay/mcp-core'
import { createSolvaPay, type FreeLimit } from '@solvapay/server'

const CONFORMANCE_API = 'https://api.conformance.test'
const CONFORMANCE_PUBLIC_URL = 'https://mcp.conformance.test'
const RESOURCE_URI = 'ui://conformance/mcp-app.html'

type Json = Record<string, unknown>

const str = (args: Json, key: string): string => {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`args.${key} must be a string`)
  return value
}

/** The server a case describes: the product, and optionally views, CSP and hidden audiences. */
function serverFor(args: Json, additionalTools?: (ctx: AdditionalToolsContext) => void): McpServer {
  return createSolvaPayMcpServer({
    ...(additionalTools ? { additionalTools } : {}),
    solvaPay: createSolvaPay({ apiKey: 'sk_sandbox_conformance', apiBaseUrl: CONFORMANCE_API }),
    productRef: str(args, 'productRef'),
    resourceUri: RESOURCE_URI,
    readHtml: async () => '',
    publicBaseUrl:
      typeof args.publicBaseUrl === 'string' ? args.publicBaseUrl : CONFORMANCE_PUBLIC_URL,
    apiBaseUrl: CONFORMANCE_API,
    getCustomerRef: () => (typeof args.customerRef === 'string' ? args.customerRef : null),
    ...(Array.isArray(args.views) ? { views: args.views as never } : {}),
    ...(args.csp !== undefined ? { csp: args.csp as never } : {}),
    ...(Array.isArray(args.hideToolsByAudience)
      ? { hideToolsByAudience: args.hideToolsByAudience as string[] }
      : {}),
  })
}

interface Session {
  request: (method: string, params?: Json) => Promise<Json>
  close: () => Promise<void>
}

/** Connects a raw JSON-RPC client to `server` and initializes as `clientName`. */
async function connect(server: McpServer, clientName: string): Promise<Session> {
  const [client, serverSide] = InMemoryTransport.createLinkedPair()
  const pending = new Map<number, (message: Json) => void>()
  client.onmessage = message => {
    const id = (message as { id?: unknown }).id
    if (typeof id === 'number') pending.get(id)?.(message as Json)
  }
  await server.connect(serverSide)
  await client.start()
  let nextId = 0
  const request = (method: string, params: Json = {}) =>
    new Promise<Json>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, message => {
        pending.delete(id)
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
        else resolve(message.result as Json)
      })
      void client.send({ jsonrpc: '2.0', id, method, params })
    })
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: clientName, version: '1.0.0' },
  })
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return { request, close: () => server.close() }
}

/** The parts of a JSON Schema the cases compare (see the README's `describeServer`). */
const SCHEMA_KEYS = [
  'type',
  'const',
  'enum',
  'description',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
] as const

export function comparableSchema(schema: unknown): Json {
  const node = (schema ?? {}) as Json
  const out: Json = {}
  for (const key of SCHEMA_KEYS) if (node[key] !== undefined) out[key] = node[key]
  if (node.properties && typeof node.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(node.properties as Json)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, value]) => [name, comparableSchema(value)]),
    )
    out.required = [...((node.required as string[] | undefined) ?? [])].sort()
  }
  return out
}

function comparableTool(tool: Json): Json {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
    _meta: tool._meta,
    inputSchema: comparableSchema(tool.inputSchema),
  }
}

const byName = (a: Json, b: Json) => (String(a.name) < String(b.name) ? -1 : 1)

async function describeServer(args: Json): Promise<unknown> {
  const session = await connect(serverFor(args), String(args.clientName ?? 'conformance'))
  try {
    const { tools } = (await session.request('tools/list')) as { tools: Json[] }
    const { prompts } = (await session.request('prompts/list')) as { prompts: Json[] }
    const { resources } = (await session.request('resources/list')) as { resources: Json[] }
    return {
      tools: tools.map(comparableTool).sort(byName),
      prompts: prompts
        .map(prompt => ({
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          arguments: ((prompt.arguments as Json[] | undefined) ?? [])
            .map(argument => ({ name: argument.name, required: argument.required === true }))
            .sort(byName),
        }))
        .sort(byName),
      resources: resources
        .map(resource => ({
          uri: resource.uri,
          name: resource.name,
          title: resource.title,
          description: resource.description,
          mimeType: resource.mimeType,
          _meta: resource._meta,
        }))
        .sort((a, b) => (String(a.uri) < String(b.uri) ? -1 : 1)),
    }
  } finally {
    await session.close()
  }
}

async function getPrompts(args: Json): Promise<unknown> {
  const session = await connect(serverFor(args), 'conformance')
  try {
    const results: unknown[] = []
    for (const call of args.calls as Json[]) {
      const result = await session.request('prompts/get', {
        name: str(call, 'name'),
        arguments: (call.arguments ?? {}) as Json,
      })
      results.push({ messages: result.messages })
    }
    return results
  } finally {
    await session.close()
  }
}

/** One API call a case expects, and the response it gets. */
interface ApiExchange {
  method: string
  path: string
  status?: number
  body: unknown
}

/** Answers `fetch` from `api`; every exchange must be used, and nothing else called. */
async function withApi<T>(api: ApiExchange[] | undefined, run: () => Promise<T>): Promise<T> {
  const pending = [...(api ?? [])]
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const at = pending.findIndex(call => call.method === method && call.path === url.pathname)
    if (at < 0) throw new Error(`Unexpected API call: ${method} ${url.pathname}`)
    const [call] = pending.splice(at, 1)
    return new Response(JSON.stringify(call.body), {
      status: call.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const result = await run()
    if (pending.length > 0) {
      throw new Error(`API calls not made: ${pending.map(c => `${c.method} ${c.path}`).join(', ')}`)
    }
    return result
  } finally {
    globalThis.fetch = realFetch
  }
}

const snapshot = (customer: CustomerSnapshot): Json => ({
  ref: customer.ref,
  balance: customer.balance,
  isCreditBased: customer.isCreditBased,
  remaining: customer.remaining,
  withinLimits: customer.withinLimits,
  overage: customer.overage,
  plan: customer.plan,
})

/**
 * The merchant handler a `callPaidTool` case scripts: emit blocks, read a fresh
 * snapshot, gate, throw, then answer with `ctx.respond` (see the README).
 */
function scriptedHandler(script: Json) {
  return async (_args: unknown, ctx: ResponseContext) => {
    for (const block of (script.emit as Json[] | undefined) ?? []) {
      await ctx.emit(block as never)
    }
    const fresh = script.fresh === true ? await ctx.customer.fresh() : undefined
    if ('gate' in script) {
      if (typeof script.gate === 'string') ctx.gate(script.gate)
      else ctx.gate()
    }
    if (typeof script.throw === 'string') throw new Error(script.throw)
    const respond = (script.respond ?? {}) as Json
    let data = respond.data ?? null
    if (respond.echo === true) {
      data = {
        ...(data as Json),
        customer: snapshot(ctx.customer),
        ...(fresh ? { freshCustomer: snapshot(fresh) } : {}),
        product: ctx.product,
      }
    }
    const options: ResponseOptions = {}
    if (typeof respond.text === 'string') options.text = respond.text
    if (respond.nudge !== undefined) options.nudge = respond.nudge as ResponseOptions['nudge']
    if (typeof respond.dataInText === 'boolean') options.dataInText = respond.dataInText
    return Object.keys(options).length > 0 ? ctx.respond(data, options) : ctx.respond(data)
  }
}

/** A text block's JSON object or array, or undefined when the text is not entirely JSON. */
function parsedJson(text: unknown): unknown {
  if (typeof text !== 'string' || !/^[[{]/.test(text)) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * Registers one merchant tool (`kind: "payable"` or `"free"`) on the server and
 * calls it as `customerRef`, with the API answering from `api`. The outcome is
 * compared as `callTool`'s is.
 */
async function callPaidTool(args: Json): Promise<unknown> {
  const tool = args.tool as Json
  const name = str(tool, 'name')
  const customerRef = str(args, 'customerRef')
  const handler = scriptedHandler((args.handler ?? {}) as Json)
  const server = serverFor(args, ({ registerPayable, registerFree }) => {
    const common = { getCustomerRef: () => customerRef, handler: handler as never }
    if (tool.kind === 'free') {
      registerFree(name, { ...common, limit: tool.freeLimit as FreeLimit })
    } else {
      registerPayable(name, common)
    }
  })
  return withApi(args.api as ApiExchange[] | undefined, async () => {
    const session = await connect(server, 'conformance')
    try {
      const result = await session.request('tools/call', { name, arguments: {} })
      return {
        content: (result.content as Json[]).map(block => {
          const json = block.type === 'text' ? parsedJson(block.text) : undefined
          return json === undefined ? block : { type: 'text', json }
        }),
        structuredContent: result.structuredContent,
        isError: result.isError === true ? true : undefined,
      }
    } finally {
      await session.close()
    }
  })
}

/** Reads one resource as `customerRef`, the API answering from `api`. JSON text compares parsed. */
async function readResource(args: Json): Promise<unknown> {
  const server = serverFor(args)
  return withApi(args.api as ApiExchange[] | undefined, async () => {
    const session = await connect(server, 'conformance')
    try {
      const result = await session.request('resources/read', { uri: str(args, 'uri') })
      return {
        contents: (result.contents as Json[]).map(content => {
          const json = parsedJson(content.text)
          if (json === undefined) return content
          const { text: _text, ...rest } = content
          return { ...rest, json }
        }),
      }
    } finally {
      await session.close()
    }
  })
}

export const SERVER_OPERATIONS = {
  readResource: [{ name: 'mcp', run: (args: Json) => readResource(args) }],
  describeServer: [{ name: 'mcp', run: (args: Json) => describeServer(args) }],
  getPrompts: [{ name: 'mcp', run: (args: Json) => getPrompts(args) }],
  callPaidTool: [{ name: 'mcp', run: (args: Json) => callPaidTool(args) }],
}
