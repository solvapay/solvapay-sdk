import { buildPaywallGate, createSolvaPay, PaywallError, type FreeLimit } from '@solvapay/server'
import { runAgentCallsScenario } from './agent-calls'
import { agentIdentityStep } from './agent-identity'
import type { ScenarioCase, ScenarioStep, StepExpect } from './cases'

/**
 * Runs a scenario: several steps against ONE SolvaPay instance, so state the
 * SDK keeps between calls (the limits cache, the customer mapping) is part of
 * what the case pins down.
 *
 * - The clock is fixed at each step's `clock` for the whole step, so request
 *   ids, usage timestamps, durations and cache ages come out the same in every
 *   language.
 * - The API answers from each step's `api` list. Every exchange must be used
 *   during its step, and any other call fails the step.
 * - Every request the SDK makes is recorded, in order, as `apiCalls`.
 */

const CONFORMANCE_API = 'https://api.conformance.test'

interface ApiExchange {
  method: string
  path: string
  status?: number
  body?: unknown
  /** An answer that is not JSON, sent as text/plain. */
  rawBody?: string
}

export interface ApiCall {
  method: string
  path: string
  query?: Record<string, string>
  body?: unknown
}

/** The random part of a request id (`solvapay_<ms>_<9 chars>`) is the only value a case can't fix. */
const REQUEST_ID = /^(solvapay_\d+_)[a-z0-9]{9}(:.*)?$/

export function withoutRandomness(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = REQUEST_ID.exec(value)
    return match ? `${match[1]}<random>${match[2] ?? ''}` : value
  }
  if (Array.isArray(value)) return value.map(withoutRandomness)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withoutRandomness(v)]),
    )
  }
  return value
}

const RealDate = Date
let fixedNow: number | undefined

class ScenarioDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fixedNow ?? RealDate.now())
    else super(...(args as [string]))
  }
  static now(): number {
    return fixedNow ?? RealDate.now()
  }
}

const str = (args: Record<string, unknown>, key: string): string => {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`args.${key} must be a string`)
  return value
}

const optional = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

type Session = ReturnType<typeof createSolvaPay>

type StepOutcome = Omit<StepExpect, 'apiCalls'>

async function runStep(
  solvaPay: Session,
  productRef: string,
  step: ScenarioStep,
): Promise<StepOutcome> {
  const args = step.args
  const freeLimit = args.freeLimit as FreeLimit | undefined
  switch (step.fn) {
    case 'decide': {
      const decision = await solvaPay.paywall.decide(
        { auth: { customer_ref: str(args, 'customerRef') } },
        {
          product: productRef,
          meterName: optional(args, 'meter'),
          toolName: optional(args, 'toolName'),
          freeLimit,
        },
      )
      return {
        result: {
          outcome: decision.outcome,
          customerRef: decision.customerRef,
          consequence: decision.outcome === 'allow' ? decision.consequence : undefined,
          gate: decision.outcome === 'gate' ? decision.gate : undefined,
        },
      }
    }
    case 'paidCall': {
      const handler = await solvaPay
        .payable({
          product: productRef,
          meterName: optional(args, 'meter'),
          toolName: str(args, 'toolName'),
          freeLimit,
        })
        .function(async () => {
          if (args.handler === 'fail') {
            throw Object.assign(new Error('the handler failed'), { code: 'handler_failed' })
          }
          // The handler gates the call itself (as `ctx.gate()` does).
          if (args.handler === 'gate') {
            throw new PaywallError(
              'Payment required',
              buildPaywallGate(productRef, { withinLimits: false, remaining: 0 }),
            )
          }
          return { ok: true }
        })
      try {
        return { result: await handler({ auth: { customer_ref: str(args, 'customerRef') } }) }
      } catch (error) {
        if (error instanceof PaywallError) return { gate: error.structuredContent }
        throw error
      }
    }
    case 'decideConcurrently': {
      // `count` calls for one customer start together, as parallel tool calls do.
      const count = args.count as number
      const decisions = await Promise.all(
        Array.from({ length: count }, () =>
          solvaPay.paywall.decide(
            { auth: { customer_ref: str(args, 'customerRef') } },
            { product: productRef, meterName: optional(args, 'meter') },
          ),
        ),
      )
      return { result: decisions.map(decision => decision.outcome) }
    }
    case 'invalidateLimits':
      solvaPay.paywall.invalidateLimits(str(args, 'customerRef'), optional(args, 'productRef'))
      return { result: null }
    // ---- customer resolution with details ----
    case 'ensureCustomer': {
      const email = optional(args, 'email')
      const name = optional(args, 'name')
      const ref = await solvaPay.ensureCustomer(
        str(args, 'customerRef'),
        optional(args, 'externalRef'),
        email !== undefined || name !== undefined ? { email, name } : undefined,
      )
      return { result: ref }
    }
    default: {
      // ---- @solvapay/agents identity steps (suite `agent-identity`)
      const agentIdentity = await agentIdentityStep(solvaPay, step.fn, args)
      if (agentIdentity) return agentIdentity
      throw new Error(
        `No TypeScript mapping for scenario step "${step.fn}". Add it to conformance/runners/typescript/src/scenarios.ts.`,
      )
    }
  }
}

/** Runs every step and returns each step's outcome and API calls, in order. */
export async function runScenario(data: ScenarioCase): Promise<StepExpect[]> {
  // ---- agent-calls (see agent-calls.ts) ----
  if (data.setup.agentCalls !== undefined) return runAgentCallsScenario(data)
  const ttl = data.setup.limitsCacheTtlMs
  const productRef = data.setup.productRef
  const realFetch = globalThis.fetch
  let pending: ApiExchange[] = []
  let calls: ApiCall[] = []

  globalThis.Date = ScenarioDate as DateConstructor
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const call: ApiCall = { method, path: url.pathname }
    if (url.search) call.query = Object.fromEntries(url.searchParams)
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

  const outcomes: StepExpect[] = []
  try {
    const solvaPay = createSolvaPay({
      apiKey: 'sk_sandbox_conformance',
      apiBaseUrl: CONFORMANCE_API,
      ...(ttl !== undefined ? { limitsCacheTTL: ttl } : {}),
    })
    for (const [index, step] of data.steps.entries()) {
      fixedNow = new RealDate(step.clock).getTime()
      pending = [...(step.api ?? [])]
      calls = []
      let outcome: StepOutcome
      try {
        outcome = await runStep(solvaPay, productRef, step)
      } catch (error) {
        const code = (error as { code?: unknown }).code
        if (typeof code !== 'string') {
          throw new Error(
            `step ${index + 1} (${step.fn}) threw an error without a code: ${(error as Error).message}`,
          )
        }
        outcome = { error: { code } }
      }
      if (pending.length > 0) {
        throw new Error(
          `step ${index + 1} (${step.fn}): API exchanges not used: ${pending.map(e => `${e.method} ${e.path}`).join(', ')}`,
        )
      }
      outcomes.push(
        withoutRandomness(
          JSON.parse(JSON.stringify({ ...outcome, apiCalls: calls })),
        ) as StepExpect,
      )
    }
  } finally {
    globalThis.Date = RealDate
    globalThis.fetch = realFetch
    fixedNow = undefined
  }
  return outcomes
}
