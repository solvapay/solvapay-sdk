/**
 * Probe arguments for a tool `verify` calls to look for a paywall gate.
 *
 * A server validates arguments against the tool's `inputSchema`, and some do
 * it before the paywall runs (the Python SDK does). So a probe has to be valid:
 * one placeholder per required property, of the type the schema asks for.
 * Optional properties are left out.
 */
import type { JsonSchema, ToolDescriptor } from './mcp-client'

const STRING_BY_FORMAT: Record<string, string> = {
  email: 'probe@example.com',
  uri: 'https://example.com/',
  url: 'https://example.com/',
  date: '2026-01-01',
  'date-time': '2026-01-01T00:00:00Z',
  uuid: '00000000-0000-4000-8000-000000000000',
}

const schemaType = (schema: JsonSchema): string | undefined => {
  if (Array.isArray(schema.type)) return schema.type.find(type => type !== 'null')
  if (schema.type) return schema.type
  if (schema.properties) return 'object'
  return undefined
}

const placeholder = (schema: JsonSchema): unknown => {
  if (schema.const !== undefined) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if (schema.default !== undefined) return schema.default

  switch (schemaType(schema)) {
    case 'integer':
    case 'number': {
      if (typeof schema.minimum === 'number') return schema.minimum
      if (typeof schema.exclusiveMinimum === 'number') return schema.exclusiveMinimum + 1
      if (typeof schema.maximum === 'number' && schema.maximum < 1) return schema.maximum
      return 1
    }
    case 'boolean':
      return false
    case 'array': {
      const count = schema.minItems ?? 0
      return Array.from({ length: count }, () => placeholder(schema.items ?? {}))
    }
    case 'object':
      return objectArguments(schema)
    default: {
      const value = (schema.format && STRING_BY_FORMAT[schema.format]) || 'probe'
      return value.length >= (schema.minLength ?? 0) ? value : value.padEnd(schema.minLength!, 'x')
    }
  }
}

const objectArguments = (schema: JsonSchema): Record<string, unknown> => {
  const args: Record<string, unknown> = {}
  for (const name of schema.required ?? []) {
    args[name] = placeholder(schema.properties?.[name] ?? {})
  }
  return args
}

export const probeArguments = (tool: ToolDescriptor): Record<string, unknown> =>
  objectArguments(tool.inputSchema ?? {})
