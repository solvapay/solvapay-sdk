import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { paywallStructuredContentSchema } from '../native-decisions'
import { PaywallStructuredContentSchema } from './paywall-schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function branchKind(branch: unknown): string {
  if (!isRecord(branch) || !isRecord(branch.properties) || !isRecord(branch.properties.kind)) {
    throw new Error('schema branch is missing properties.kind')
  }
  const kind = branch.properties.kind
  if (typeof kind.const === 'string') {
    return kind.const
  }
  if (Array.isArray(kind.enum) && typeof kind.enum[0] === 'string') {
    return kind.enum[0]
  }
  throw new Error('schema branch kind is neither const nor a string enum')
}

function requiredSet(branch: unknown): string[] {
  if (!isRecord(branch) || !Array.isArray(branch.required)) {
    throw new Error('schema branch is missing required')
  }
  return [...branch.required].filter((key): key is string => typeof key === 'string').sort()
}

function propertyKeys(branch: unknown): string[] {
  if (!isRecord(branch) || !isRecord(branch.properties)) {
    throw new Error('schema branch is missing properties')
  }
  return Object.keys(branch.properties).sort()
}

function oneOfBranches(schema: unknown): unknown[] {
  if (!isRecord(schema)) {
    throw new Error('schema is not an object')
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf
  }
  throw new Error('schema has neither oneOf nor anyOf')
}

describe('PaywallStructuredContentSchema', () => {
  it('matches the core JSON Schema for every branch and field', () => {
    const core = paywallStructuredContentSchema()
    const derived = z.toJSONSchema(PaywallStructuredContentSchema, { io: 'input' })
    const coreBranches = oneOfBranches(core)
    const derivedBranches = oneOfBranches(derived)

    expect(coreBranches).toHaveLength(2)
    expect(derivedBranches).toHaveLength(2)

    const coreByKind = new Map(coreBranches.map(branch => [branchKind(branch), branch]))
    const derivedByKind = new Map(derivedBranches.map(branch => [branchKind(branch), branch]))

    expect([...coreByKind.keys()].sort()).toEqual(['activation_required', 'payment_required'])
    expect([...derivedByKind.keys()].sort()).toEqual([...coreByKind.keys()].sort())

    for (const [kind, coreBranch] of coreByKind) {
      const derivedBranch = derivedByKind.get(kind)
      expect(derivedBranch, `missing derived branch for ${kind}`).toBeDefined()
      expect(requiredSet(derivedBranch)).toEqual(requiredSet(coreBranch))
      expect(propertyKeys(derivedBranch)).toEqual(propertyKeys(coreBranch))
    }
  })
})
