const PATH_PREFIX = '/v1/sdk/'
const EXCLUDED_PATH_PREFIXES = ['/v1/sdk/agents'] as const

export interface OpenApiSpec {
  openapi?: string
  info?: Record<string, unknown>
  paths?: Record<string, unknown>
  components?: {
    schemas?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

function deepClone<T>(value: T): T {
  return structuredClone(value)
}

function collectSchemaRefs(node: unknown, refs: Set<string>): void {
  if (!node || typeof node !== 'object') {
    return
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectSchemaRefs(item, refs)
    }
    return
  }

  const objectNode = node as Record<string, unknown>
  const refValue = objectNode.$ref
  if (typeof refValue === 'string') {
    const match = refValue.match(/^#\/components\/schemas\/(.+)$/)
    if (match?.[1]) {
      refs.add(match[1])
    }
  }

  for (const value of Object.values(objectNode)) {
    collectSchemaRefs(value, refs)
  }
}

/**
 * Keep `/v1/sdk/*` paths, drop non-SDK routes and `/v1/sdk/agents*`.
 * Returns a deep clone; does not mutate `spec`.
 */
export function filterSdkPaths(spec: OpenApiSpec): OpenApiSpec {
  const filteredPaths: Record<string, unknown> = {}

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    const isExcluded = EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))
    if (isExcluded) {
      continue
    }
    if (path.startsWith(PATH_PREFIX)) {
      filteredPaths[path] = methods
    }
  }

  if (Object.keys(filteredPaths).length === 0) {
    throw new Error(`No paths found matching prefix "${PATH_PREFIX}"`)
  }

  return {
    ...deepClone(spec),
    paths: filteredPaths,
  }
}

/**
 * Remove schemas not reachable via `$ref` from paths (transitive).
 * Returns a deep clone plus the pruned count; does not mutate `spec`.
 */
export function pruneUnreferencedSchemas(spec: OpenApiSpec): {
  spec: OpenApiSpec
  pruned: number
} {
  const next = deepClone(spec)
  const reachable = new Set<string>()
  const queue: string[] = []

  collectSchemaRefs(next.paths, reachable)
  queue.push(...reachable)

  while (queue.length > 0) {
    const name = queue.pop()
    if (name === undefined) {
      continue
    }
    const schema = next.components?.schemas?.[name]
    if (!schema) {
      continue
    }
    const nested = new Set<string>()
    collectSchemaRefs(schema, nested)
    for (const ref of nested) {
      if (!reachable.has(ref)) {
        reachable.add(ref)
        queue.push(ref)
      }
    }
  }

  let pruned = 0
  if (next.components?.schemas) {
    for (const name of Object.keys(next.components.schemas)) {
      if (!reachable.has(name)) {
        delete next.components.schemas[name]
        pruned += 1
      }
    }
  }

  return { spec: next, pruned }
}

/**
 * Add placeholder schemas for dangling `#/components/schemas/*` refs.
 * Returns a deep clone plus the added count; does not mutate `spec`.
 */
export function addMissingSchemaPlaceholders(spec: OpenApiSpec): {
  spec: OpenApiSpec
  added: number
} {
  const next = deepClone(spec)
  const refs = new Set<string>()
  collectSchemaRefs(next, refs)

  next.components ??= {}
  next.components.schemas ??= {}

  let added = 0
  for (const schemaName of refs) {
    if (next.components.schemas[schemaName]) {
      continue
    }

    next.components.schemas[schemaName] = {
      type: 'object',
      additionalProperties: true,
      description: `Auto-generated fallback schema for unresolved reference: ${schemaName}`,
    }
    added += 1
  }

  return { spec: next, added }
}

/** Recursively sort object keys; preserve array order. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key])
    }
    return sorted
  }

  return value
}

/**
 * Filter → prune → placeholders → canonicalize.
 * Deep-clones at each stage; does not mutate `spec`. Idempotent.
 */
export function deriveSnapshot(spec: OpenApiSpec): OpenApiSpec {
  const filtered = filterSdkPaths(spec)
  const { spec: pruned } = pruneUnreferencedSchemas(filtered)
  const { spec: withPlaceholders } = addMissingSchemaPlaceholders(pruned)
  return canonicalize(withPlaceholders) as OpenApiSpec
}

/** Canonical JSON: 2-space indent, sorted keys (via canonicalize), trailing newline. */
export function serializeSnapshot(spec: OpenApiSpec): string {
  return `${JSON.stringify(canonicalize(spec), null, 2)}\n`
}

/** Path-filter only (schemas intact). Used for the committed CI source artifact. */
export function deriveSource(spec: OpenApiSpec): OpenApiSpec {
  return canonicalize(filterSdkPaths(spec)) as OpenApiSpec
}

export { PATH_PREFIX, EXCLUDED_PATH_PREFIXES }
