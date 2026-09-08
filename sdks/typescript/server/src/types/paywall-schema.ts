/**
 * Zod schema for `PaywallStructuredContent`, derived from the
 * `paywall_structured_content_schema` JSON Schema in `solvapay-core`.
 *
 * Exported from both the Node and edge bundles so `@solvapay/mcp` can import
 * it on Cloudflare Workers. Built lazily so first evaluation happens after
 * the edge entry installs the WASM sync API.
 */

import { z } from 'zod'
import { paywallStructuredContentSchema } from '../native-decisions'

const ALLOWED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'const',
  'oneOf',
  'items',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!isRecord(schema)) {
    throw new Error(`unsupported JSON Schema node: ${JSON.stringify(schema)}`)
  }

  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      throw new Error(`unsupported JSON Schema keyword: ${key}`)
    }
  }

  if ('const' in schema) {
    const value = schema.const
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return z.literal(value)
    }
    throw new Error(`unsupported JSON Schema const: ${JSON.stringify(value)}`)
  }

  if ('oneOf' in schema) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2) {
      throw new Error('JSON Schema oneOf must contain at least two branches')
    }
    const variants = schema.oneOf.map(jsonSchemaToZod) as [
      z.ZodTypeAny,
      z.ZodTypeAny,
      ...z.ZodTypeAny[],
    ]
    return z.union(variants)
  }

  if (Object.keys(schema).length === 0) {
    return z.unknown()
  }

  if (schema.type === 'string') {
    return z.string()
  }
  if (schema.type === 'number') {
    return z.number()
  }
  if (schema.type === 'boolean') {
    return z.boolean()
  }
  if (schema.type === 'array') {
    const items = schema.items === undefined ? z.unknown() : jsonSchemaToZod(schema.items)
    return z.array(items)
  }
  if (schema.type === 'object') {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((key): key is string => typeof key === 'string')
        : [],
    )
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, propertySchema] of Object.entries(properties)) {
      const field = jsonSchemaToZod(propertySchema)
      shape[key] = required.has(key) ? field : field.optional()
    }
    const objectSchema = z.object(shape)
    if (schema.additionalProperties === true) {
      return objectSchema.passthrough()
    }
    if (schema.additionalProperties === false) {
      return objectSchema.strict()
    }
    if (schema.additionalProperties !== undefined) {
      throw new Error(
        `unsupported JSON Schema additionalProperties: ${JSON.stringify(schema.additionalProperties)}`,
      )
    }
    return objectSchema
  }

  throw new Error(`unsupported JSON Schema type: ${JSON.stringify(schema.type)}`)
}

let memoized: z.ZodTypeAny | undefined

function buildPaywallStructuredContentSchema(): z.ZodTypeAny {
  return jsonSchemaToZod(paywallStructuredContentSchema())
}

export const PaywallStructuredContentSchema: z.ZodTypeAny = z.lazy(() => {
  memoized ??= buildPaywallStructuredContentSchema()
  return memoized
})
