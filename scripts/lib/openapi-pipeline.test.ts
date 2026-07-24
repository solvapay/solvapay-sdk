import { describe, expect, it } from 'vitest'
import {
  addMissingSchemaPlaceholders,
  canonicalize,
  deriveSnapshot,
  filterSdkPaths,
  pruneUnreferencedSchemas,
  serializeSnapshot,
  type OpenApiSpec,
} from './openapi-pipeline.js'

function baseSpec(overrides: Partial<OpenApiSpec> = {}): OpenApiSpec {
  return {
    openapi: '3.0.0',
    info: { title: 'test', version: '1.0.0' },
    paths: {},
    components: { schemas: {} },
    ...overrides,
  }
}

describe('filterSdkPaths', () => {
  it('keeps /v1/sdk/* paths and drops non-sdk paths', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/customers': { get: { summary: 'list' } },
        '/v1/admin/users': { get: { summary: 'admin' } },
        '/health': { get: { summary: 'health' } },
      },
    })

    const filtered = filterSdkPaths(input)

    expect(Object.keys(filtered.paths ?? {})).toEqual(['/v1/sdk/customers'])
    expect(filtered.info).toEqual(input.info)
  })

  it('drops /v1/sdk/agents paths', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/customers': { get: { summary: 'list' } },
        '/v1/sdk/agents': { get: { summary: 'agents' } },
        '/v1/sdk/agents/foo': { get: { summary: 'agent foo' } },
      },
    })

    const filtered = filterSdkPaths(input)

    expect(Object.keys(filtered.paths ?? {})).toEqual(['/v1/sdk/customers'])
  })

  it('throws when no SDK paths remain', () => {
    const input = baseSpec({
      paths: {
        '/v1/admin/users': { get: { summary: 'admin' } },
        '/v1/sdk/agents': { get: { summary: 'agents' } },
      },
    })

    expect(() => filterSdkPaths(input)).toThrow(/No paths found matching prefix/)
  })

  it('does not mutate the input spec', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/customers': { get: { summary: 'list' } },
        '/v1/admin/users': { get: { summary: 'admin' } },
      },
    })
    const before = structuredClone(input)

    filterSdkPaths(input)

    expect(input).toEqual(before)
  })
})

describe('pruneUnreferencedSchemas', () => {
  it('removes unreachable schemas and keeps transitively reachable ones', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/customers': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Customer' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Customer: {
            type: 'object',
            properties: {
              address: { $ref: '#/components/schemas/Address' },
            },
          },
          Address: { type: 'object' },
          Orphan: { type: 'object' },
        },
      },
    })

    const { spec, pruned } = pruneUnreferencedSchemas(input)

    expect(pruned).toBe(1)
    expect(Object.keys(spec.components?.schemas ?? {}).sort()).toEqual(['Address', 'Customer'])
  })

  it('returns pruned count of zero when nothing is removed', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/customers': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Customer' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Customer: { type: 'object' },
        },
      },
    })

    const { pruned } = pruneUnreferencedSchemas(input)
    expect(pruned).toBe(0)
  })

  it('does not mutate the input spec', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Keep' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Keep: { type: 'object' },
          Drop: { type: 'object' },
        },
      },
    })
    const before = structuredClone(input)

    pruneUnreferencedSchemas(input)

    expect(input).toEqual(before)
  })
})

describe('addMissingSchemaPlaceholders', () => {
  it('adds exact fallback schema for dangling $ref values', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/MissingThing' },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: {} },
    })

    const { spec, added } = addMissingSchemaPlaceholders(input)

    expect(added).toBe(1)
    expect(spec.components?.schemas?.MissingThing).toEqual({
      type: 'object',
      additionalProperties: true,
      description: 'Auto-generated fallback schema for unresolved reference: MissingThing',
    })
  })

  it('does not overwrite existing schemas', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Existing' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Existing: { type: 'string' },
        },
      },
    })

    const { spec, added } = addMissingSchemaPlaceholders(input)

    expect(added).toBe(0)
    expect(spec.components?.schemas?.Existing).toEqual({ type: 'string' })
  })

  it('does not mutate the input spec', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Missing' },
                  },
                },
              },
            },
          },
        },
      },
    })
    const before = structuredClone(input)

    addMissingSchemaPlaceholders(input)

    expect(input).toEqual(before)
  })
})

describe('canonicalize + deriveSnapshot + serializeSnapshot', () => {
  it('sorts object keys recursively and preserves array order', () => {
    const value = {
      z: 1,
      a: [{ b: 2, a: 1 }, { z: 3 }],
      m: { y: true, x: false },
    }

    expect(canonicalize(value)).toEqual({
      a: [{ a: 1, b: 2 }, { z: 3 }],
      m: { x: false, y: true },
      z: 1,
    })
  })

  it('serializeSnapshot ends with a trailing newline and is byte-stable', () => {
    const spec = deriveSnapshot(
      baseSpec({
        paths: {
          '/v1/sdk/customers': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Customer' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Customer: { type: 'object', properties: { id: { type: 'string' } } },
            Orphan: { type: 'boolean' },
          },
        },
      }),
    )

    const once = serializeSnapshot(spec)
    const twice = serializeSnapshot(spec)

    expect(once.endsWith('\n')).toBe(true)
    expect(once).toBe(twice)
    expect(once).toContain('"Customer"')
    expect(once).not.toContain('"Orphan"')
  })

  it('deriveSnapshot does not mutate input and is idempotent', () => {
    const input = baseSpec({
      paths: {
        '/v1/sdk/customers': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Customer' },
                  },
                },
              },
            },
          },
        },
        '/v1/admin/users': { get: { summary: 'admin' } },
      },
      components: {
        schemas: {
          Customer: { type: 'object' },
          Orphan: { type: 'object' },
        },
      },
    })
    const before = structuredClone(input)

    const once = deriveSnapshot(input)
    const twice = deriveSnapshot(once)

    expect(input).toEqual(before)
    expect(twice).toEqual(once)
    expect(Object.keys(once.paths ?? {})).toEqual(['/v1/sdk/customers'])
    expect(once.components?.schemas?.Orphan).toBeUndefined()
  })
})
