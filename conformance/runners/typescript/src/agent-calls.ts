// ---- agent-calls: an agent's paid call (authorize → upstream → complete) ----
//
// A scenario whose `setup` has `agentCalls` runs against ONE
// `createAgentCalls` session over `createSolvaPayAgentClient`, so the handle
// `beginCall` returns is what later `finishCall` / `releaseCall` steps act on.
//
// - Time is virtual: each step starts at its `clock`, and waiting for the
//   owner advances it by the `retryAfterSeconds` SolvaPay asked for, without
//   sleeping. `clientGoneAfterSeconds` makes the caller go away that many
//   seconds into the step (the request's `AbortSignal`).
// - The API answers from the step's `api` list, each exchange once, in order
//   per method and path; every request is compared, with its body.
// - The step's result is `{ outcome, log }`: what the SDK returned, and every
//   log line (event and fields, without `error`, whose text is for people).
import {
  createAgentCalls,
  createSolvaPayAgentClient,
  promptFacts,
  type Allowed,
  type AgentEnvironment,
  type MoneyAmount,
} from '@solvapay/agents'
import type { ScenarioCase, ScenarioStep, StepExpect } from './cases'
import type { ApiCall } from './scenarios'

const CONFORMANCE_API = 'https://api.conformance.test'

interface ApiExchange {
  method: string
  path: string
  status?: number
  body?: unknown
  /** An answer that is not JSON, sent as text/plain. */
  rawBody?: string
}

interface LogLine {
  event: string
  fields: Record<string, unknown>
}

interface BeginArgs {
  requestId: string
  agentToken: string
  agent: {
    agentRef: string
    principalRef: string
    promptExcerpt: boolean
    environment: AgentEnvironment
  }
  item: string
  estimate: MoneyAmount
  prompt?: { text: string; toolError?: boolean }
  logFields?: Record<string, unknown>
  clientGoneAfterSeconds?: number
}

export async function runAgentCallsScenario(data: ScenarioCase): Promise<StepExpect[]> {
  const setup = data.setup.agentCalls
  if (setup === undefined) throw new Error('setup.agentCalls is missing')
  let pending: ApiExchange[] = []
  let calls: ApiCall[] = []
  let log: LogLine[] = []
  let now = 0
  let goneAt: { at: number; controller: AbortController } | undefined

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const call: ApiCall = { method, path: url.pathname }
    if (typeof init?.body === 'string') call.body = JSON.parse(init.body)
    calls.push(call)
    const at = pending.findIndex(e => e.method === method && e.path === url.pathname)
    if (at < 0) throw new Error(`Unexpected API call: ${method} ${url.pathname}`)
    const [exchange] = pending.splice(at, 1)
    if (exchange.rawBody !== undefined) {
      return new Response(exchange.rawBody, {
        status: exchange.status ?? 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    return new Response(JSON.stringify(exchange.body), {
      status: exchange.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const record = (event: string, fields: Record<string, unknown> = {}) => {
    const { error: _message, ...rest } = fields
    log.push({ event, fields: rest })
  }
  const session = createAgentCalls({
    client: createSolvaPayAgentClient({
      apiBaseUrl: CONFORMANCE_API,
      secretKey: 'sk_sandbox_conformance',
      fetchImpl,
    }),
    maxWaitSeconds: setup.maxWaitSeconds,
    log: { info: record, error: record },
    now: () => now,
    sleep: async (ms, signal) => {
      if (goneAt && !signal.aborted && goneAt.at <= now + ms) {
        now = Math.max(now, goneAt.at)
        goneAt.controller.abort()
        return
      }
      now += ms
    },
  })
  const allowed = new Map<string, Allowed>()

  async function runStep(step: ScenarioStep): Promise<unknown> {
    const args = step.args
    switch (step.fn) {
      case 'beginCall': {
        const a = args as unknown as BeginArgs
        const controller = new AbortController()
        goneAt =
          a.clientGoneAfterSeconds === undefined
            ? undefined
            : { at: now + a.clientGoneAfterSeconds * 1000, controller }
        if (a.clientGoneAfterSeconds === 0) controller.abort()
        const begun = await session.begin({
          requestId: a.requestId,
          agentToken: a.agentToken,
          agent: a.agent,
          item: a.item,
          estimate: a.estimate,
          prompt: a.prompt ? promptFacts(a.prompt.text, a.prompt.toolError ?? false) : null,
          signal: controller.signal,
          ...(a.logFields ? { logFields: a.logFields } : {}),
        })
        if (begun.kind === 'allow') allowed.set(a.requestId, begun)
        return begun
      }
      case 'finishCall':
      case 'releaseCall': {
        const handle = allowed.get(args.requestId as string)
        if (!handle) throw new Error(`No allowed call for requestId ${String(args.requestId)}`)
        try {
          if (step.fn === 'releaseCall') return await handle.release(args.reason as string)
          return await handle.finish({
            status: args.status as number,
            cost: args.cost as { amount: number; currency: string } | null,
            ...(args.interrupted !== undefined ? { interrupted: args.interrupted as string } : {}),
          })
        } catch {
          // Completing a call twice throws; the message is for people.
          return 'threw'
        }
      }
      default:
        throw new Error(
          `No TypeScript mapping for agent-calls step "${step.fn}". Add it to conformance/runners/typescript/src/agent-calls.ts.`,
        )
    }
  }

  const outcomes: StepExpect[] = []
  for (const [index, step] of data.steps.entries()) {
    now = new Date(step.clock).getTime()
    pending = [...((step.api ?? []) as ApiExchange[])]
    calls = []
    log = []
    const outcome = await runStep(step)
    if (pending.length > 0) {
      throw new Error(
        `step ${index + 1} (${step.fn}): API exchanges not used: ${pending.map(e => `${e.method} ${e.path}`).join(', ')}`,
      )
    }
    outcomes.push(
      JSON.parse(
        JSON.stringify({ result: { outcome: outcome ?? null, log }, apiCalls: calls }),
      ) as StepExpect,
    )
  }
  return outcomes
}
