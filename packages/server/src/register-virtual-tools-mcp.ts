import type { SolvaPayClient } from './types'
import {
  createVirtualTools,
  type VirtualToolDefinition,
  type VirtualToolsOptions,
} from './virtual-tools'
import type { McpToolExtra } from './types'

type ZodRawShape = Record<string, unknown>
type JsonSchemaProperty = {
  type?: string
  enum?: unknown[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
}

export interface McpServerLike {
  registerTool: (
    name: string,
    config: Record<string, unknown>,
    handler: (args: Record<string, unknown>, extra?: McpToolExtra) => unknown,
  ) => unknown
}

export interface RegisterVirtualToolsMcpOptions extends Omit<
  VirtualToolsOptions,
  'getCustomerRef'
> {
  getCustomerRef?: VirtualToolsOptions['getCustomerRef']
  filter?: (definition: VirtualToolDefinition) => boolean
  mapDefinition?: (definition: VirtualToolDefinition) => VirtualToolDefinition
  wrapHandler?: (
    handler: VirtualToolDefinition['handler'],
    definition: VirtualToolDefinition,
  ) => (args: Record<string, unknown>, extra?: McpToolExtra) => Promise<unknown> | unknown
}

type NodeModuleBuiltin = {
  createRequire: (filename: string) => NodeRequire
}

/**
 * Resolve a Node `require` without a static `node:module` import.
 *
 * A static import is rewritten to bare `"module"` by the edge tsup bundle and
 * then fails Deno (`Import "module" not a dependency`). Lazy builtin lookup
 * keeps `createSolvaPay` (which re-exports this path) loadable on edge/Deno;
 * `registerVirtualToolsMcp` itself still requires Node when invoked.
 */
function getNodeRequire(): NodeRequire {
  try {
    return (0, eval)('require') as NodeRequire
  } catch {
    const nodeModule = (
      process as NodeJS.Process & {
        getBuiltinModule?: (id: string) => NodeModuleBuiltin | undefined
      }
    ).getBuiltinModule?.('module')
    if (!nodeModule?.createRequire) {
      throw new Error(
        'registerVirtualToolsMcp() requires Node.js (createRequire unavailable in this runtime)',
      )
    }
    return nodeModule.createRequire(`${process.cwd()}/package.json`)
  }
}

let cachedRequire: NodeRequire | undefined

function getZod() {
  cachedRequire ??= getNodeRequire()
  try {
    const zodModule = cachedRequire('zod') as { z?: Record<string, unknown> } & Record<
      string,
      unknown
    >
    // Zod CJS interop: some resolvers expose `{ z }`, others the namespace itself.
    return (zodModule.z ?? zodModule) as {
      enum: (values: [string, ...string[]]) => unknown
      literal: (value: unknown) => unknown
      union: (values: unknown[]) => unknown
      string: () => unknown
      number: () => { int: () => unknown }
      boolean: () => unknown
      array: (schema: unknown) => unknown
      object: (shape: ZodRawShape) => unknown
      any: () => unknown
    }
  } catch {
    throw new Error(
      'zod is required to use registerVirtualToolsMcp(). Install it as a dependency in your MCP server project.',
    )
  }
}

function isJsonSchemaObject(value: unknown): value is JsonSchemaProperty {
  return Boolean(value && typeof value === 'object')
}

function toZodSchema(property: JsonSchemaProperty): unknown {
  const z = getZod()

  if (Array.isArray(property.enum) && property.enum.length > 0) {
    if (property.enum.every(value => typeof value === 'string')) {
      const [first, ...rest] = property.enum as [string, ...string[]]
      return z.enum([first, ...rest])
    }

    if (property.enum.length === 1) {
      return z.literal(property.enum[0])
    }

    return z.union(property.enum.map(value => z.literal(value)))
  }

  switch (property.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(
        isJsonSchemaObject(property.items) ? (toZodSchema(property.items) as unknown) : z.any(),
      )
    case 'object':
      return z.object(jsonSchemaToZodRawShape(property.properties || {}))
    default:
      return z.any()
  }
}

export function jsonSchemaToZodRawShape(
  properties: Record<string, JsonSchemaProperty>,
  required: string[] = [],
): ZodRawShape {
  const requiredSet = new Set(required)

  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => {
      const schema = toZodSchema(property)
      const finalSchema = requiredSet.has(name)
        ? schema
        : (schema as { optional: () => unknown }).optional()

      return [name, finalSchema]
    }),
  )
}

function defaultGetCustomerRef(_args: Record<string, unknown>, extra?: McpToolExtra): string {
  const fromExtra = extra?.authInfo?.extra?.customer_ref
  return typeof fromExtra === 'string' && fromExtra.trim() ? fromExtra.trim() : 'anonymous'
}

export function registerVirtualToolsMcpImpl(
  server: McpServerLike,
  apiClient: SolvaPayClient,
  options: RegisterVirtualToolsMcpOptions,
): void {
  const { filter, mapDefinition, wrapHandler, getCustomerRef, ...virtualToolsOptions } = options

  const virtualTools = createVirtualTools(apiClient, {
    ...virtualToolsOptions,
    getCustomerRef: getCustomerRef || defaultGetCustomerRef,
  })

  for (const toolDefinition of virtualTools) {
    if (filter && !filter(toolDefinition)) continue

    const mappedDefinition = mapDefinition ? mapDefinition(toolDefinition) : toolDefinition
    const wrappedHandler = wrapHandler
      ? wrapHandler(mappedDefinition.handler, mappedDefinition)
      : mappedDefinition.handler

    server.registerTool(
      mappedDefinition.name,
      {
        description: mappedDefinition.description,
        inputSchema: jsonSchemaToZodRawShape(
          mappedDefinition.inputSchema.properties as Record<string, JsonSchemaProperty>,
          mappedDefinition.inputSchema.required || [],
        ),
      },
      wrappedHandler,
    )
  }
}
