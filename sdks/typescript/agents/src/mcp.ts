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
import type { MoneyAmount } from './client'
import type { AgentCalls, CallResult, Logger } from './calls'
import { agentMcpRouteStep, agentRefusalToolResult } from './core'
import type { AgentLayer, Identification, VerifiedAgent } from './identity'
import type { ProtectedResource } from './oauth'
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

/** Where the core sends one request (`agentMcpRouteStep`). */
type Route =
  | { kind: 'pass' }
  | { kind: 'anonymous' }
  | { kind: 'paid_tools' }
  | { kind: 'identify'; token: string }
  | { kind: 'agent'; agentToken: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'response'
      status: number
      headers: Record<string, string>
      body: unknown
      log?: Record<string, unknown>
    }

/** A route for the merchant's fetch handler: a response for an agent's request, else `null`. */
export function createAgentMcpRoute(
  options: AgentMcpOptions,
): (request: Request) => Promise<Response | null> {
  /** The listing server: every tool is listed, and only the free ones run. */
  const listing = () => {
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
    return { build, paidTools: [...paidNames] }
  }

  return async request => {
    const input = {
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get('authorization'),
      body: await jsonBody(request),
      issuer: options.issuer,
      mcpPath: options.mcpPath,
      serverName: options.serverName,
      ...(options.protectedResource ? { protectedResource: options.protectedResource } : {}),
      ...(options.lazyAuth === undefined ? {} : { lazyAuth: options.lazyAuth }),
    }
    // Which requests are ours, and how each is answered, is the Rust core's call.
    let route = agentMcpRouteStep(input) as Route
    let identity: Identification | undefined
    let anonymous: ReturnType<typeof listing> | undefined
    if (route.kind === 'identify') {
      identity = await options.agentLayer.identify(route.token)
      route = agentMcpRouteStep({ ...input, identity }) as Route
    } else if (route.kind === 'anonymous' || route.kind === 'paid_tools') {
      // A host that has not signed in: a call to a paid tool is what sends it to sign in.
      anonymous = listing()
      route = agentMcpRouteStep({ ...input, paidTools: anonymous.paidTools }) as Route
    }

    switch (route.kind) {
      case 'pass':
        return null
      case 'error':
        throw new Error(route.message)
      case 'response':
        if (route.log) options.log.info('call.rejected', route.log)
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: route.headers,
        })
      case 'anonymous':
        if (!anonymous) throw new Error('The route listed tools with no protected resource')
        return createMcpHandler(anonymous.build, { responseMode: 'json' }).fetch(request)
      case 'agent': {
        if (identity?.kind !== 'agent')
          throw new Error('The route served an agent it did not verify')
        const call: AgentRequest = { request, agent: identity.agent, agentToken: route.agentToken }
        const handler = createMcpHandler(() => buildServer(options, call), { responseMode: 'json' })
        return handler.fetch(request)
      }
      default:
        throw new Error(`The route did not settle (${route.kind})`)
    }
  }
}

/** The JSON-RPC body of a POST, read from a copy; `null` when it is not JSON. */
async function jsonBody(request: Request): Promise<unknown> {
  if (request.method !== 'POST') return null
  try {
    return await request.clone().json()
  } catch {
    // Not JSON: the MCP handler answers it with its own parse error.
    return null
  }
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

function buildServer(options: AgentMcpOptions, call: AgentRequest): McpServer {
  const server = new McpServer({
    name: options.serverName,
    version: options.serverVersion ?? '0.1.0',
  })
  options.freeTools?.(server)
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
    if (begun.kind === 'refused') return agentRefusalToolResult(begun) as CallToolResult

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
