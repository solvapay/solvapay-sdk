import {
  buildSolvaPayDescriptors,
  narrateActivatePlan,
  narratedToolResult,
  parseMode,
  type BootstrapPayload,
  type SolvaPayCallToolResult,
} from '@solvapay/mcp-core'
import {
  buildNudgeMessage,
  buildPaywallGate,
  createSolvaPay,
  verifyWebhook,
} from '@solvapay/server'
import { verifyWebhook as verifyWebhookEdge } from '@solvapay/server/edge'
import type { ConformanceCase } from './cases'

/**
 * Maps each language-neutral `fn` to the TypeScript SDK. An operation with
 * more than one implementation (the Node and the edge webhook verifier) lists
 * each; every implementation runs every case.
 */
export interface Implementation {
  name: string
  run: (args: Record<string, unknown>, clock: Date | undefined) => unknown | Promise<unknown>
}

const str = (args: Record<string, unknown>, key: string): string => {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`args.${key} must be a string`)
  return value
}

/**
 * Runs `run` with `new Date()` and `Date.now()` reading `clock`, for code that
 * takes no clock argument (the account narrator reads the current time to say
 * how many days a cancelled plan has left). Synchronous only.
 */
function atClock<T>(clock: Date | undefined, run: () => T): T {
  if (clock === undefined) return run()
  const RealDate = Date
  const fixed = clock.getTime()
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed)
      else super(...(args as [string]))
    }
    static now(): number {
      return fixed
    }
  }
  globalThis.Date = FixedDate as DateConstructor
  try {
    return run()
  } finally {
    globalThis.Date = RealDate
  }
}

/** The API the `callTool` cases run against, and the MCP server's public URL. */
const CONFORMANCE_API = 'https://api.conformance.test'
const CONFORMANCE_PUBLIC_URL = 'https://mcp.conformance.test'

/** One API call a `callTool` case expects, and the response it gets. */
interface ApiExchange {
  method: string
  path: string
  status?: number
  body: unknown
}

/**
 * A tool result as the cases compare it. A text block holding JSON (what
 * `toolResult` writes) is compared parsed, as `json`: key order is not part of
 * what the widget reads.
 */
function toolOutcome(result: SolvaPayCallToolResult): Record<string, unknown> {
  const content = result.content.map(block => {
    const text = (block as { text?: unknown }).text
    if (block.type === 'text' && typeof text === 'string' && /^[[{]/.test(text)) {
      return { type: 'text', json: JSON.parse(text) as unknown }
    }
    return block
  })
  return {
    content,
    structuredContent: result.structuredContent,
    isError: result.isError === true ? true : undefined,
  }
}

/**
 * Calls one of the server's built-in tools with `fetch` answering from
 * `args.api`. Every exchange must be used, and nothing else may be called.
 */
async function callTool(args: Record<string, unknown>): Promise<unknown> {
  const pending = [...((args.api as ApiExchange[] | undefined) ?? [])]
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
    const customerRef = typeof args.customerRef === 'string' ? args.customerRef : null
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: createSolvaPay({ apiKey: 'sk_sandbox_conformance', apiBaseUrl: CONFORMANCE_API }),
      productRef: str(args, 'productRef'),
      resourceUri: 'ui://conformance/mcp-app.html',
      readHtml: async () => '',
      publicBaseUrl: CONFORMANCE_PUBLIC_URL,
      getCustomerRef: () => customerRef,
    })
    const name = str(args, 'tool')
    const tool = tools.find(candidate => candidate.name === name)
    if (!tool) throw new Error(`No tool named ${name}`)
    const result = await tool.handler((args.arguments ?? {}) as Record<string, unknown>, undefined)
    if (pending.length > 0) {
      throw new Error(`API calls not made: ${pending.map(c => `${c.method} ${c.path}`).join(', ')}`)
    }
    return toolOutcome(result)
  } finally {
    globalThis.fetch = realFetch
  }
}

export const OPERATIONS: Record<string, Implementation[]> = {
  callTool: [{ name: 'mcp-core', run: args => callTool(args) }],
  verifyWebhook: [
    {
      name: 'node',
      run: (args, clock) =>
        verifyWebhook({
          body: str(args, 'body'),
          signature: str(args, 'signature'),
          secret: str(args, 'secret'),
          now: clock,
        }),
    },
    {
      name: 'edge',
      run: (args, clock) =>
        verifyWebhookEdge({
          body: str(args, 'body'),
          signature: str(args, 'signature'),
          secret: str(args, 'secret'),
          now: clock,
        }),
    },
  ],
  buildPaywallGate: [
    {
      name: 'server',
      run: args =>
        buildPaywallGate(
          str(args, 'productRef'),
          args.limits as Parameters<typeof buildPaywallGate>[1],
        ),
    },
  ],
  narrateAccount: [
    {
      name: 'mcp-core',
      run: (args, clock) => {
        const result = atClock(clock, () =>
          narratedToolResult(
            str(args, 'view'),
            args.payload as BootstrapPayload,
            parseMode(args.mode),
          ),
        )
        return { content: result.content }
      },
    },
  ],
  narrateActivatePlan: [
    {
      name: 'mcp-core',
      run: args => narrateActivatePlan(args.result as Parameters<typeof narrateActivatePlan>[0]),
    },
  ],
}

// ---- paywall nudge copy ----------------------------------------------------
// `state` is the kind the classifier would have produced; `limits` may be null.
OPERATIONS.buildNudgeMessage = [
  {
    name: 'server',
    run: args =>
      buildNudgeMessage(
        { kind: str(args, 'state') } as Parameters<typeof buildNudgeMessage>[0],
        args.limits as Parameters<typeof buildNudgeMessage>[1],
      ),
  },
]

export function implementationsFor(data: ConformanceCase): Implementation[] {
  const implementations = OPERATIONS[data.input.fn]
  if (!implementations) {
    throw new Error(
      `No TypeScript mapping for fn "${data.input.fn}". Add it to conformance/runners/typescript/src/operations.ts.`,
    )
  }
  return implementations
}

export type Outcome = { result: unknown } | { error: { code: string } }

/** Runs one implementation and reports the result or the error's code. */
export async function outcomeOf(
  implementation: Implementation,
  data: ConformanceCase,
): Promise<Outcome> {
  const clock = data.input.clock === undefined ? undefined : new Date(data.input.clock)
  try {
    return { result: await implementation.run(data.input.args, clock) }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (typeof code !== 'string') {
      // An error without a code is a bug in the SDK, not an outcome a case can pin.
      throw new Error(
        `${implementation.name} threw an error without a code: ${(error as Error).message}`,
      )
    }
    return { error: { code } }
  }
}
