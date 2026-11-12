import { buildPaywallGate, verifyWebhook } from '@solvapay/server'
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

export const OPERATIONS: Record<string, Implementation[]> = {
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
}

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
