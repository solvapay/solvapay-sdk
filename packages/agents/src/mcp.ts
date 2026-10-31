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
import { isAgentKey, type AgentLayer, type VerifiedAgent } from './identity'
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
  /** Registers the merchant's tools on the agent's server, with `paid` for the paid ones. */
  tools(server: McpServer, paid: <Args>(tool: PaidTool<Args>) => void, call: AgentRequest): void
}

const UNREACHABLE = 'The service behind this tool could not be reached. Nothing was charged.'

/** A route for the merchant's fetch handler: a response for an agent's request, else `null`. */
export function createAgentMcpRoute(
  options: AgentMcpOptions,
): (request: Request) => Promise<Response | null> {
  return async request => {
    if (new URL(request.url).pathname !== options.mcpPath) return null
    const token = agentBearer(request, options.issuer)
    if (!token) return null

    const identity = await options.agentLayer.identify(token)
    if (identity.kind === 'rejected') {
      options.log.info('call.rejected', {
        reason: `agent_token_${identity.reason}`,
        detail: identity.detail,
      })
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
  server.registerTool(
    tool.name,
    {
      ...(tool.title ? { title: tool.title } : {}),
      description: tool.description,
      // The merchant's zod may be another copy than the server's; the shape is the same.
      inputSchema: tool.inputSchema as ToolConfig['inputSchema'],
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    },
    (async (args: Args): Promise<CallToolResult> => {
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
    }) as Parameters<McpServer['registerTool']>[2],
  )
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
function agentTokenRejected(reason: string): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: `The agent token was not accepted (${reason}).` },
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer error="invalid_token", error_description="${reason}"`,
      },
    },
  )
}
