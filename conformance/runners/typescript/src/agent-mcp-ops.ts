/**
 * Suite `agent-mcp`: the MCP route agents call (`@solvapay/agents/mcp`), driven
 * as a fetch handler with real `Request`s, one route for the whole case.
 *
 * `agentMcpRoute` builds the route from `args.route`, `args.tools` and
 * `args.freeTools`, sends `args.requests` in order, and returns what each one
 * got and every SolvaPay API call the route made (see the README).
 * `agentRefusalStatuses` maps refusal reasons to the HTTP status an API answers
 * with.
 */
import { fromJsonSchema, type CallToolResult, type McpServer } from '@modelcontextprotocol/server'
import {
  createAgentCalls,
  createAgentKeyVerifier,
  createAgentLayer,
  createAgentTokenVerifier,
  createSolvaPayAgentClient,
  type Logger,
  type RefusalReason,
} from '@solvapay/agents'
import { refusalStatus } from '@solvapay/agents/http'
import { createAgentMcpRoute, type PaidToolRun } from '@solvapay/agents/mcp'
import type { Implementation } from './operations'

type Json = Record<string, unknown>

const CONFORMANCE_API = 'https://api.conformance.test'
const MERCHANT_ORIGIN = 'https://merchant-am.test'

interface ApiExchange {
  method: string
  path: string
  status?: number
  body: unknown
}

/**
 * The route's request id for each paid call is a random UUID, the one value a
 * case can't fix. Each becomes `<uuid-N>`, numbered by first appearance, so a
 * case still shows which calls share an id (an approval wait asks again with
 * the same one).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function withoutUuids(value: unknown, seen = new Map<string, string>()): unknown {
  if (typeof value === 'string') {
    if (!UUID.test(value)) return value
    if (!seen.has(value)) seen.set(value, `<uuid-${seen.size + 1}>`)
    return seen.get(value)
  }
  if (Array.isArray(value)) return value.map(v => withoutUuids(v, seen))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Json).map(([k, v]) => [k, withoutUuids(v, seen)]),
    )
  }
  return value
}

// ---- the parts of an answer a case compares ---------------------------------

const SCHEMA_KEYS = ['type', 'description', 'minimum', 'maximum', 'minLength', 'maxLength'] as const

function comparableSchema(schema: unknown): Json {
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

function parsedJson(text: unknown): unknown {
  if (typeof text !== 'string' || !/^[[{]/.test(text)) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** One JSON-RPC message from the MCP server, reduced to what a host reads. */
function comparableMessage(message: Json): Json {
  const out: Json = { id: message.id ?? null }
  const error = message.error as Json | undefined
  if (error) {
    // Only the route's own errors (-32001) carry a message the SDKs share.
    out.error = error.code === -32001 ? error : { code: error.code }
    return out
  }
  const result = (message.result ?? {}) as Json
  if (Array.isArray(result.tools)) {
    out.result = {
      tools: (result.tools as Json[])
        .map(tool => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          annotations: tool.annotations,
          inputSchema: comparableSchema(tool.inputSchema),
        }))
        .sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1)),
    }
  } else if (result.serverInfo) {
    const info = result.serverInfo as Json
    out.result = { serverInfo: { name: info.name, version: info.version } }
  } else if (Array.isArray(result.content)) {
    out.result = {
      content: (result.content as Json[]).map(block => {
        const json = block.type === 'text' ? parsedJson(block.text) : undefined
        return json === undefined ? block : { type: 'text', json }
      }),
      structuredContent: result.structuredContent,
      isError: result.isError === true ? true : undefined,
    }
  } else {
    out.result = result
  }
  return out
}

/** The JSON body, or the JSON of each `data:` line of an event stream. */
function bodyOf(text: string, contentType: string): unknown {
  if (text === '') return null
  if (contentType.startsWith('text/event-stream')) {
    const data = text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => JSON.parse(line.slice(5)) as unknown)
    return data.length === 1 ? data[0] : data
  }
  return JSON.parse(text) as unknown
}

const ROUTE_HEADERS = [
  'www-authenticate',
  'access-control-expose-headers',
  'access-control-allow-origin',
  'cache-control',
] as const

const isMcpAnswer = (body: unknown): boolean => {
  const messages = Array.isArray(body) ? body : [body]
  return messages.every(
    m =>
      m !== null &&
      typeof m === 'object' &&
      ('result' in m || ('error' in m && (m as { error: Json }).error.code !== -32001)),
  )
}

/**
 * What one request got. The route's own answers (metadata, challenges,
 * rejections) compare whole, with their headers; the MCP server's answers
 * compare as JSON-RPC messages reduced to what a host reads.
 */
async function outcomeOf(response: Response): Promise<Json> {
  const body = bodyOf(await response.text(), response.headers.get('content-type') ?? '')
  if (isMcpAnswer(body)) {
    return {
      status: response.status,
      mcp: Array.isArray(body)
        ? (body as Json[]).map(comparableMessage)
        : comparableMessage(body as Json),
    }
  }
  const headers: Json = {}
  for (const name of ROUTE_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) headers[name] = value
  }
  return { status: response.status, headers, body }
}

// ---- the route a case describes ---------------------------------------------

interface InputProperty {
  type: 'string' | 'integer' | 'number' | 'boolean'
  description?: string
  optional?: boolean
}

function inputSchema(input: Record<string, InputProperty>) {
  const properties: Json = {}
  const required: string[] = []
  for (const [name, property] of Object.entries(input)) {
    properties[name] = {
      type: property.type,
      ...(property.description ? { description: property.description } : {}),
    }
    if (!property.optional) required.push(name)
  }
  return fromJsonSchema({ type: 'object', properties, required } as never)
}

interface ToolSpec {
  name: string
  title?: string
  description: string
  annotations?: Json
  input: Record<string, InputProperty>
  item: string
  estimate: { amount: string; currency: string }
  /** The argument whose value is the prompt; absent for a tool without one. */
  prompt?: string
  run:
    | { throw: string }
    | {
        status: number
        cost: { amount: number; currency: string } | null
        interrupted?: string
        /** The text the agent gets; `echo` instead answers what `run` received. */
        text?: string
        echo?: boolean
      }
  unreachableMessage?: string
}

function runOf(tool: ToolSpec) {
  return async (
    args: Json,
    call: { callRef: string; agent: { agentRef: string; principalRef: string } },
  ): Promise<PaidToolRun> => {
    const run = tool.run
    if ('throw' in run) throw new Error(run.throw)
    const text = run.echo
      ? JSON.stringify({
          args,
          callRef: call.callRef,
          agentRef: call.agent.agentRef,
          principalRef: call.agent.principalRef,
        })
      : (run.text ?? '')
    const result: CallToolResult = { content: [{ type: 'text', text }] }
    return {
      status: run.status,
      cost: run.cost,
      ...(run.interrupted ? { interrupted: run.interrupted } : {}),
      result,
    }
  }
}

/**
 * The case's public keys, by `kid`, as `createLocalJWKSet` resolves them. An
 * unknown `kid` throws, which the verifier reports as an invalid token.
 */
function localKeys(jwks: { keys: (JsonWebKey & { kid?: string })[] }) {
  return async (header: { kid?: string }) => {
    const jwk = jwks.keys.find(key => key.kid === header.kid)
    if (!jwk) throw new Error(`No key with kid ${String(header.kid)}`)
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ])
  }
}

let fixedNow: number | undefined
const RealDate = Date
class CaseDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fixedNow ?? RealDate.now())
    else super(...(args as [string]))
  }
  static now(): number {
    return fixedNow ?? RealDate.now()
  }
}

const silent: Logger = { info: () => undefined, error: () => undefined }

async function agentMcpRoute(args: Json, clock: Date | undefined): Promise<unknown> {
  const route = args.route as Json
  const protectedResource = route.protectedResource as Json | undefined
  const pending = [...((args.api as ApiExchange[] | undefined) ?? [])]
  const apiCalls: Json[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    apiCalls.push({
      method,
      path: url.pathname,
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    })
    const at = pending.findIndex(e => e.method === method && e.path === url.pathname)
    if (at < 0) throw new Error(`Unexpected API call: ${method} ${url.pathname}`)
    const [exchange] = pending.splice(at, 1)
    return new Response(JSON.stringify(exchange.body), {
      status: exchange.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const client = createSolvaPayAgentClient({
    apiBaseUrl: CONFORMANCE_API,
    secretKey: 'sk_sandbox_conformance',
    fetchImpl,
  })
  const issuer = args.issuer as string
  const environment = route.environment as 'sandbox' | 'live' | undefined
  const tools = (args.tools ?? []) as ToolSpec[]
  const freeTools = (args.freeTools ?? []) as { name: string; description: string; text: string }[]

  const handler = createAgentMcpRoute({
    issuer,
    agentLayer: createAgentLayer({
      verifyAgentToken: createAgentTokenVerifier({
        issuer,
        providerRef: args.providerRef as string,
        keys: localKeys(args.jwks as { keys: JsonWebKey[] }),
        ...(protectedResource ? { resource: protectedResource.resource as string } : {}),
        ...(environment ? { environment } : {}),
      }),
      ...(route.agentKeys === false
        ? {}
        : {
            verifyAgentKey: createAgentKeyVerifier({
              client,
              ...(environment ? { environment } : {}),
            }),
          }),
    }),
    calls: createAgentCalls({
      client,
      maxWaitSeconds: route.maxWaitSeconds as number,
      log: silent,
      now: () => Date.now(),
      // Waiting for the owner moves the case's clock on instead of sleeping.
      sleep: async ms => {
        fixedNow = (fixedNow ?? RealDate.now()) + ms
      },
    }),
    log: silent,
    mcpPath: route.mcpPath as string,
    serverName: route.serverName as string,
    ...(typeof route.serverVersion === 'string' ? { serverVersion: route.serverVersion } : {}),
    ...(protectedResource ? { protectedResource: protectedResource as never } : {}),
    ...(typeof route.lazyAuth === 'boolean' ? { lazyAuth: route.lazyAuth } : {}),
    ...(freeTools.length > 0
      ? {
          freeTools: (server: McpServer) => {
            for (const tool of freeTools) {
              server.registerTool(tool.name, { description: tool.description }, async () => ({
                content: [{ type: 'text', text: tool.text }],
              }))
            }
          },
        }
      : {}),
    tools: (_server, paid) => {
      for (const tool of tools) {
        paid<Json>({
          name: tool.name,
          ...(tool.title ? { title: tool.title } : {}),
          description: tool.description,
          inputSchema: inputSchema(tool.input) as never,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
          item: () => tool.item,
          estimate: () => tool.estimate,
          ...(tool.prompt ? { prompt: a => String(a[tool.prompt as string]) } : {}),
          run: runOf(tool),
          ...(tool.unreachableMessage ? { unreachableMessage: tool.unreachableMessage } : {}),
        })
      }
    },
  })

  const responses: unknown[] = []
  fixedNow = clock?.getTime()
  globalThis.Date = CaseDate as DateConstructor
  try {
    for (const spec of args.requests as Json[]) {
      const headers: Record<string, string> = { accept: 'application/json, text/event-stream' }
      if (typeof spec.authorization === 'string') headers.authorization = spec.authorization
      const method = (spec.method as string | undefined) ?? 'POST'
      let body: string | undefined
      if (typeof spec.rawBody === 'string') body = spec.rawBody
      else if (spec.body !== undefined) body = JSON.stringify(spec.body)
      if (body !== undefined) headers['content-type'] = 'application/json'
      const request = new Request(`${MERCHANT_ORIGIN}${spec.path as string}`, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
      })
      let response: Response | null
      try {
        response = await handler(request)
      } catch {
        // The route fails loudly (a misconfigured agent layer): no answer at all.
        responses.push({ thrown: true })
        continue
      }
      responses.push(response === null ? { merchant: true } : await outcomeOf(response))
    }
  } finally {
    globalThis.Date = RealDate
    fixedNow = undefined
  }
  if (pending.length > 0) {
    throw new Error(`API calls not made: ${pending.map(e => `${e.method} ${e.path}`).join(', ')}`)
  }
  return withoutUuids({ responses, apiCalls })
}

export const AGENT_MCP_OPERATIONS: Record<string, Implementation[]> = {
  agentMcpRoute: [{ name: 'agents-mcp', run: (args, clock) => agentMcpRoute(args, clock) }],
  agentRefusalStatuses: [
    {
      name: 'agents-http',
      run: args =>
        Object.fromEntries(
          (args.reasons as RefusalReason[]).map(reason => [reason, refusalStatus(reason)]),
        ),
    },
  ],
}
