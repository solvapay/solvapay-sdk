import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PaywallStructuredContentSchema, paywallStructuredContentSchema } from '@solvapay/server'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectKinds(schema: unknown, into = new Set<string>()): Set<string> {
  if (!isRecord(schema)) {
    return into
  }
  const kind = isRecord(schema.properties) ? schema.properties.kind : undefined
  if (isRecord(kind) && typeof kind.const === 'string') {
    into.add(kind.const)
  }
  const branches = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : []
  for (const branch of branches) {
    collectKinds(branch, into)
  }
  return into
}

describe('registerPayable outputSchema union', () => {
  it('matches core union_payable_output_schema for a sample merchant schema', () => {
    const merchant = z.object({ result: z.string() })
    const tsUnion = z.toJSONSchema(z.union([merchant, PaywallStructuredContentSchema]), {
      io: 'input',
    })
    const coreUnion = {
      oneOf: [
        { type: 'object', required: ['result'], properties: { result: { type: 'string' } } },
        paywallStructuredContentSchema(),
      ],
    }

    expect(collectKinds(tsUnion)).toEqual(collectKinds(coreUnion))
    expect(collectKinds(coreUnion)).toEqual(new Set(['activation_required', 'payment_required']))

    const tsJson = JSON.stringify(tsUnion)
    expect(tsJson).toContain('"result"')
    expect(tsJson).toContain('payment_required')
    expect(tsJson).toContain('activation_required')
  })
})
