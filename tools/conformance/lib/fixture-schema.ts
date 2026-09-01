/**
 * Zod schema for the §5.3 golden-fixture format.
 *
 * No filesystem I/O — callers load JSON and pass plain objects in.
 */

import { z } from 'zod'

const FixtureError = z.object({
  /** Asserted by the TS harness against `Error.name`. */
  name: z.string().min(1).optional(),
  /** Byte-exact message asserted by the TS harness. */
  message: z.string(),
  /** Optional HTTP status asserted when present. */
  status: z.number().int().optional(),
  /**
   * Rust-era taxonomy (§5.3). Carried for later runners; the TS harness
   * does not invent or assert these fields.
   */
  kind: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
})

const FixtureExpect = z
  .object({
    result: z.unknown().optional(),
    error: FixtureError.optional(),
  })
  .superRefine((value, ctx) => {
    const hasResult = Object.prototype.hasOwnProperty.call(value, 'result')
    const hasError = Object.prototype.hasOwnProperty.call(value, 'error')
    if (hasResult === hasError) {
      ctx.addIssue({
        code: 'custom',
        message: 'expect must contain exactly one of result or error',
      })
    }
  })

const WireRequest = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  /** Asserted when present; captured from `URL.searchParams`. */
  query: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
})

const WireResponse = z.object({
  status: z.number().int(),
  body: z.unknown(),
})

const WireExchange = z.object({
  request: WireRequest,
  response: WireResponse,
})

const Wire = z
  .object({
    request: WireRequest.optional(),
    response: WireResponse.optional(),
    /** Optional route table for multi-call driver loops. */
    exchanges: z.array(WireExchange).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasRequest = value.request !== undefined
    const hasResponse = value.response !== undefined
    if (hasRequest !== hasResponse) {
      ctx.addIssue({
        code: 'custom',
        message: 'wire.request and wire.response must be paired',
      })
    }
    const hasPair = hasRequest && hasResponse
    const hasExchanges = value.exchanges !== undefined && value.exchanges.length > 0
    if (!hasPair && !hasExchanges) {
      ctx.addIssue({
        code: 'custom',
        message: 'wire must include request/response or exchanges[]',
      })
    }
  })

export const FixtureSchema = z.object({
  suite: z.string().min(1),
  case: z.string().min(1),
  input: z.object({
    fn: z.string().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
    clock: z.string().min(1).optional(),
    rngSeed: z.number().int().optional(),
  }),
  wire: Wire.optional(),
  expect: FixtureExpect,
})

export type Fixture = z.infer<typeof FixtureSchema>
export type FixtureErrorExpect = z.infer<typeof FixtureError>
export type FixtureWire = z.infer<typeof Wire>
export type FixtureWireExchange = z.infer<typeof WireExchange>

/** Route table: `wire.exchanges` when present, otherwise the single pair. */
export function wireExchanges(wire: FixtureWire): FixtureWireExchange[] {
  if (wire.exchanges !== undefined && wire.exchanges.length > 0) {
    return wire.exchanges
  }
  if (wire.request !== undefined && wire.response !== undefined) {
    return [{ request: wire.request, response: wire.response }]
  }
  return []
}

export function parseFixture(raw: unknown): Fixture {
  return FixtureSchema.parse(raw)
}
