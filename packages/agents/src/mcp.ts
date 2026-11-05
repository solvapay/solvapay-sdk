// `@solvapay/agents/mcp`: an MCP server paid by SolvaPay agents. Requests on
// the MCP path whose bearer token comes from SolvaPay's agent issuer are
// verified and served by a server built for that agent; each paid tool call
// is authorized before it runs and completed at the cost it reports. Every
// other request is left to the merchant's own handler (`null`).
//
// A refusal is a tool error (`isError: true`) whose text is the sentence for
// the agent's human, and whose `structuredContent.refusal.reason` says which
// refusal it was, so an agent can act on it without parsing the text.
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { decodeJwt } from 'jose'
import type { MoneyAmount } from './client'
import type { AgentCalls, CallResult, Logger } from './calls'
import {
  isAgentKey,
  type AgentLayer,
  type AgentRejectionReason,
  type VerifiedAgent,
} from './identity'
import {
  authChallenge,
  canonicalResource,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  type ProtectedResource,
} from './oauth'
import { promptFacts } from './prompt'

/** The agent a request was verified as, and the token it presented. */
export interface AgentRequest {
  request: Request
  agent: VerifiedAgent
  /** As presented; SolvaPay verifies it again on every authorize. */
  agentToken: string
}

/** How a paid tool's upstream call went. */
export interface PaidToolRun {
  /** The status the upstream answered with; 400 and above charges nothing. */
  status: number
  /** What the upstream reported it cost, or null when it reported nothing. */
  cost: CallResult['cost']
  /** Set when the answer broke before it finished. */
  interrupted?: string
  /** What the agent gets back. */
  result: CallToolResult
}

type ToolConfig = Parameters<McpServer['registerTool']>[1]

export interface PaidTool<Args> {
  name: string
  title?: string
  description: string
  /**
   * The tool's input as a raw zod shape (`{ prompt: z.string() }`), from the
   * merchant's own zod; the MCP server validates calls against it.
   */
  inputSchema: Record<string, unknown>
  annotations?: ToolConfig['annotations']
  /** The merchant's label for what the call buys (a model id, a tool name). */
  item(args: Args): string
  /** What the call may cost, in the merchant's currency. */
  estimate(args: Args): MoneyAmount
  /** The text whose fingerprint shows repeats (loops); its end goes only when the token allows. */
  prompt?(args: Args): string | null
  /** Calls the upstream. A throw means it was never reached: the call is released, nothing charged. */
  run(
    args: Args,
    call: { callRef: string; requestId: string; agent: VerifiedAgent },
  ): Promise<PaidToolRun>
  /** What the agent reads when `run` throws; says nothing was charged. */
  unreachableMessage?: string
}

export interface AgentMcpOptions {
  /** SolvaPay's agent token issuer; only tokens from it are routed here. */
  issuer: string
  agentLayer: AgentLayer
  calls: AgentCalls
  log: Logger
  /** The MCP endpoint's path, e.g. `/mcp`. */
  mcpPath: string
  serverName: string
  serverVersion?: string
  /**
   * Registers the merchant's tools, with `paid` for the paid ones. `call` is
   * the verified agent; it is `undefined` only when the tools are listed for a
   * host that has not signed in yet (`protectedResource` set), and then no
   * paid tool can run: a call to one is answered with the sign-in challenge.
   */
  tools(
    server: McpServer,
    paid: <Args>(tool: PaidTool<Args>) => void,
    call: AgentRequest | undefined,
  ): void
  /**
   * Turns OAuth sign-in on for hosts such as Claude and ChatGPT: the route
   * serves this resource's RFC 9728 metadata and answers a paid call with no
   * agent token by the 401 challenge that sends the host to SolvaPay.
   * `authorizationServer` defaults to `issuer`.
   */
  protectedResource?: Omit<ProtectedResource, 'authorizationServer'> & {
    authorizationServer?: string
  }
  /**
   * With `protectedResource`: `true` (default) lets a host list tools and run
   * free ones before sign-in; `false` challenges every `tools/call` without
   * a token, while `initialize` and `tools/list` still answer.
   */
  lazyAuth?: boolean
  /** Tools anyone may call, signed in or not. */
  freeTools?(server: McpServer): void
}

const UNREACHABLE = 'The service behind this tool could not be reached. Nothing was charged.'

/** A route for the merchant's fetch handler: a response for an agent's request, else `null`. */
export function createAgentMcpRoute(
  options: AgentMcpOptions,
): (request: Request) => Promise<Response | null> {
  const resource: ProtectedResource | undefined = options.protectedResource
    ? {
        ...options.protectedResource,
        resource: canonicalResource(options.protectedResource.resource),
        authorizationServer: options.protectedResource.authorizationServer ?? options.issuer,
      }
    : undefined
  const metadataPaths = resource
    ? new Set([
        protectedResourceMetadataPath(resource),
        `${options.mcpPath}/.well-known/oauth-protected-resource`,
      ])
    : new Set<string>()

  return async request => {
    const path = new URL(request.url).pathname
    if (resource && request.method === 'GET' && metadataPaths.has(path)) {
      return Response.json(
        protectedResourceMetadata({ ...resource, serverName: options.serverName }),
        { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } },
      )
    }
    if (path !== options.mcpPath) return null
    const token = agentBearer(request, options.issuer)
    if (!token) return resource ? anonymous(options, resource, request) : null

    const identity = await options.agentLayer.identify(token)
    if (identity.kind === 'rejected') {
      options.log.info('call.rejected', {
        reason: `agent_token_${identity.reason}`,
        detail: identity.detail,
      })
      // The other environment is not fixed by signing in again here.
      if (resource && identity.reason !== 'environment_mismatch') {
        return authChallenge({
          protectedResource: resource,
          description:
            identity.reason === 'expired'
              ? 'The sign-in has expired: sign in again'
              : 'The agent token was not accepted: sign in again',
          jsonRpcId: await jsonRpcId(request),
        })
      }
      return agentTokenRejected(identity.reason)
    }
    if (identity.kind !== 'agent') {
      throw new Error(
        isAgentKey(token)
          ? 'An agent key reached the agent route, but its agent layer has no verifyAgentKey'
          : 'A token from the agent issuer was not read as one',
      )
    }
    const call: AgentRequest = { request, agent: identity.agent, agentToken: token }
    const handler = createMcpHandler(() => buildServer(options, call), { responseMode: 'json' })
    return handler.fetch(request)
  }
}

/**
 * A request with no agent token, while OAuth is on. A bearer that is not ours
 * is the merchant's own auth: it gets its handler (`null`) unless it is a
 * paid call. With no bearer at all the route answers itself, from a server
 * that lists every tool and runs only the free ones: a host lists tools
 * before its user signs in, and a paid call is what sends it to sign in.
 */
async function anonymous(
  options: AgentMcpOptions,
  resource: ProtectedResource,
  request: Request,
): Promise<Response | null> {
  const paidNames = new Set<string>()
  const build = () => {
    const server = new McpServer({
      name: options.serverName,
      version: options.serverVersion ?? '0.1.0',
    })
    options.freeTools?.(server)
    options.tools(server, tool => listPaidTool(server, tool, paidNames), undefined)
    return server
  }
  build()
  const calls = await toolCalls(request)
  const lazy = options.lazyAuth ?? true
  const needsAgent = calls.some(call => !lazy || paidNames.has(call.name))
  if (needsAgent) {
    return authChallenge({
      protectedResource: resource,
      description: 'Sign in to pay for this tool',
      jsonRpcId: calls[0]?.id ?? null,
    })
  }
  if (/^Bearer\s/i.test(request.headers.get('authorization') ?? '')) return null
  return createMcpHandler(build, { responseMode: 'json' }).fetch(request)
}

/** Lists a paid tool for a host that has not signed in; the route never lets it run. */
function listPaidTool<Args>(server: McpServer, tool: PaidTool<Args>, names: Set<string>): void {
  names.add(tool.name)
  server.registerTool(tool.name, toolConfig(tool), (async () => {
    throw new Error(
      `Paid tool ${tool.name} reached without an agent: the route should have challenged`,
    )
  }) as Parameters<McpServer['registerTool']>[2])
}

/** The `tools/call` requests in a JSON-RPC body (one, or a batch), read from a copy. */
async function toolCalls(request: Request): Promise<{ id: unknown; name: string }[]> {
  if (request.method !== 'POST') return []
  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    // Not JSON: the MCP handler answers it with its own parse error.
    return []
  }
  const messages = Array.isArray(body) ? body : [body]
  return messages.flatMap(message => {
    if (!message || typeof message !== 'object') return []
    const { method, id, params } = message as { method?: unknown; id?: unknown; params?: unknown }
    if (method !== 'tools/call') return []
    const name = (params as { name?: unknown } | undefined)?.name
    return typeof name === 'string' ? [{ id, name }] : []
  })
}

/** The JSON-RPC id of a single request, for an error the host can match to it. */
async function jsonRpcId(request: Request): Promise<unknown> {
  try {
    const body = (await request.clone().json()) as { id?: unknown }
    return body && typeof body === 'object' && !Array.isArray(body) ? (body.id ?? null) : null
  } catch {
    return null
  }
}

function buildServer(options: AgentMcpOptions, call: AgentRequest): McpServer {
  const server = new McpServer({
    name: options.serverName,
    version: options.serverVersion ?? '0.1.0',
  })
  options.tools(server, tool => registerPaidTool(server, options, call, tool), call)
  return server
}

/** Registers one paid tool: authorize, run, complete; a refusal becomes a tool error. */
export function registerPaidTool<Args>(
  server: McpServer,
  deps: Pick<AgentMcpOptions, 'calls' | 'log'>,
  call: AgentRequest,
  tool: PaidTool<Args>,
): void {
  server.registerTool(tool.name, toolConfig(tool), (async (args: Args): Promise<CallToolResult> => {
    const requestId = crypto.randomUUID()
    const text = tool.prompt ? tool.prompt(args) : null
    const begun = await deps.calls.begin({
      requestId,
      agentToken: call.agentToken,
      agent: call.agent,
      item: tool.item(args),
      estimate: tool.estimate(args),
      prompt: text === null ? null : promptFacts(text),
      signal: call.request.signal,
      logFields: { tool: tool.name },
    })
    if (begun.kind === 'refused') {
      return {
        isError: true,
        content: [{ type: 'text', text: begun.message }],
        structuredContent: { refusal: { reason: begun.reason, message: begun.message } },
      }
    }

    let run: PaidToolRun
    try {
      run = await tool.run(args, { callRef: begun.callRef, requestId, agent: call.agent })
    } catch (error) {
      await begun.release('upstream_unreachable')
      deps.log.error('call.upstream_failed', {
        requestId,
        tool: tool.name,
        callRef: begun.callRef,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        isError: true,
        content: [{ type: 'text', text: tool.unreachableMessage ?? UNREACHABLE }],
      }
    }

    const completed = await begun.finish({
      status: run.status,
      cost: run.cost,
      ...(run.interrupted ? { interrupted: run.interrupted } : {}),
    })
    deps.log.info('call.completed', {
      requestId,
      tool: tool.name,
      agentRef: call.agent.agentRef,
      userRef: call.agent.principalRef,
      callRef: begun.callRef,
      item: begun.item,
      estimate: begun.estimate,
      status: run.status,
      cost: run.cost,
      // `null` when SolvaPay could not be told; the SDK logged why.
      completed: completed ? { source: completed.source, amount: completed.amount } : null,
    })
    return run.result
  }) as Parameters<McpServer['registerTool']>[2])
}

/**
 * A paid tool's config. Without a title the name stands in, and without
 * annotations it says it is neither read-only nor destructive: directories
 * flag tools that leave them out, and a paid call is never read-only in the
 * money sense. `openWorldHint` stays the merchant's call.
 */
function toolConfig<Args>(tool: PaidTool<Args>): ToolConfig {
  return {
    title: tool.title ?? tool.name,
    description: tool.description,
    // The merchant's zod may be another copy than the server's; the shape is the same.
    inputSchema: tool.inputSchema as ToolConfig['inputSchema'],
    annotations: tool.annotations ?? { readOnlyHint: false, destructiveHint: false },
  }
}

/**
 * The bearer token, when it is an agent key or SolvaPay's agent issuer signed
 * it (read unverified, only to route).
 */
function agentBearer(request: Request, issuer: string): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  if (!match) return null
  if (isAgentKey(match[1])) return match[1]
  try {
    return decodeJwt(match[1]).iss === issuer ? match[1] : null
  } catch {
    // Not a JWT at all: the merchant's own handler answers it.
    return null
  }
}

/** A JSON-RPC error for an agent token that did not verify; the agent needs a new one. */
/** 401 for a token that did not verify; 403 for one from the other environment, as SolvaPay answers. */
function agentTokenRejected(reason: AgentRejectionReason): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: `The agent token was not accepted (${reason}).` },
    },
    {
      status: reason === 'environment_mismatch' ? 403 : 401,
      headers: {
        'WWW-Authenticate': `Bearer error="invalid_token", error_description="${reason}"`,
      },
    },
  )
}
