import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { execSync } from 'child_process'

// The backend was split from a single monolith into independent NestJS services,
// each of which now serves only its own slice of the API at its own
// `/v1/openapi.json`. There is no longer one aggregated document at
// `localhost:3001` (that port is the identity service, which owns no `/v1/sdk/*`
// routes), so we pull every service that owns SDK operations and merge them.
// Only these five expose external `/v1/sdk/*` operations today. Override with
// BACKEND_OPENAPI_URLS (comma/space separated) or BACKEND_OPENAPI_URL for a
// single aggregated source (e.g. a gateway or the committed docs spec served
// over http), mirroring docs/scripts/sync-backend-openapi.ts.
const DEFAULT_LOCAL_SOURCES = [
  'http://localhost:3002/v1/openapi.json', // provider-service
  'http://localhost:3003/v1/openapi.json', // payment-service
  'http://localhost:3004/v1/openapi.json', // billing-service
  'http://localhost:3005/v1/openapi.json', // commerce-service
  'http://localhost:3008/v1/openapi.json', // webhook-service
]

const OUTPUT_FILE = './src/types/generated.ts'
const TEMP_SPEC_FILE = './temp-filtered-openapi.json'
const PATH_PREFIX = '/v1/sdk/'
const EXCLUDED_PATH_PREFIXES = ['/v1/sdk/agents']

interface OpenAPISpec {
  paths?: Record<string, any>
  components?: {
    schemas?: Record<string, any>
    securitySchemes?: Record<string, any>
    [key: string]: any
  }
  [key: string]: any
}

const resolveSources = (): string[] => {
  const multi = process.env.BACKEND_OPENAPI_URLS?.trim()
  if (multi) {
    return multi
      .split(/[\s,]+/)
      .map(entry => entry.trim())
      .filter(Boolean)
  }

  const single = process.env.BACKEND_OPENAPI_URL?.trim()
  if (single) {
    return [single]
  }

  return DEFAULT_LOCAL_SOURCES
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function fetchOpenApi(url: string): Promise<OpenAPISpec> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec from ${url}: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as OpenAPISpec
}

// Deterministic key ordering so the generated file is stable across runs and
// across services (whose native path/schema order differs), keeping diffs
// reviewable. Matches the sort in docs/scripts/sync-backend-openapi.ts.
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce<Record<string, any>>((acc, key) => {
      acc[key] = sortDeep(value[key])
      return acc
    }, {})
}

// Reduce a source spec to its `/v1/sdk/*` operations and the schemas reachable
// from them, then merge into the shared paths/schemas maps. Services own
// disjoint paths, so path collisions are unexpected and warned; shared DTOs
// (e.g. error envelopes) may legitimately repeat and are deduped, while genuine
// shape conflicts between referenced definitions are surfaced.
function mergeSource(
  doc: OpenAPISpec,
  url: string,
  paths: Record<string, any>,
  schemas: Record<string, any>,
  securitySchemes: Record<string, any>,
  conflicts: string[],
): void {
  const sdkPaths: Record<string, any> = {}
  for (const [path, item] of Object.entries(doc.paths || {})) {
    if (EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) continue
    if (!path.startsWith(PATH_PREFIX)) continue
    if (path in paths) {
      conflicts.push(`duplicate path "${path}" (also in ${url})`)
      continue
    }
    sdkPaths[path] = item
    paths[path] = item
  }

  const docSchemas = isRecord(doc.components?.schemas) ? doc.components!.schemas! : {}
  const reachable = new Set<string>()
  collectSchemaRefs(sdkPaths, reachable)
  const queue = [...reachable]
  while (queue.length > 0) {
    const name = queue.pop()!
    const schema = docSchemas[name]
    if (!schema) continue
    const nested = new Set<string>()
    collectSchemaRefs(schema, nested)
    for (const ref of nested) {
      if (!reachable.has(ref)) {
        reachable.add(ref)
        queue.push(ref)
      }
    }
  }

  for (const name of reachable) {
    const schema = docSchemas[name]
    if (!schema) continue
    if (name in schemas) {
      if (JSON.stringify(schemas[name]) !== JSON.stringify(schema)) {
        conflicts.push(`schema "${name}" has conflicting shapes (also in ${url})`)
      }
      continue
    }
    schemas[name] = schema
  }

  const docSecurity = isRecord(doc.components?.securitySchemes) ? doc.components!.securitySchemes! : {}
  for (const [name, scheme] of Object.entries(docSecurity)) {
    if (!(name in securitySchemes)) securitySchemes[name] = scheme
  }
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
    if (match) {
      refs.add(match[1])
    }
  }

  for (const value of Object.values(objectNode)) {
    collectSchemaRefs(value, refs)
  }
}

function pruneUnreferencedSchemas(spec: OpenAPISpec): number {
  const reachable = new Set<string>()
  const queue: string[] = []

  collectSchemaRefs(spec.paths, reachable)
  queue.push(...reachable)

  while (queue.length > 0) {
    const name = queue.pop()!
    const schema = spec.components?.schemas?.[name]
    if (!schema) continue
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
  if (spec.components?.schemas) {
    for (const name of Object.keys(spec.components.schemas)) {
      if (!reachable.has(name)) {
        delete spec.components.schemas[name]
        pruned++
      }
    }
  }
  return pruned
}

function addMissingSchemaPlaceholders(spec: OpenAPISpec): number {
  const refs = new Set<string>()
  collectSchemaRefs(spec, refs)

  spec.components ??= {}
  spec.components.schemas ??= {}

  let addedCount = 0
  for (const schemaName of refs) {
    if (spec.components.schemas[schemaName]) {
      continue
    }

    spec.components.schemas[schemaName] = {
      type: 'object',
      additionalProperties: true,
      description: `Auto-generated fallback schema for unresolved reference: ${schemaName}`,
    }
    addedCount += 1
  }

  return addedCount
}

async function main(): Promise<void> {
  const sources = resolveSources()
  console.log(`Fetching OpenAPI spec from ${sources.length} source(s):`)
  for (const url of sources) console.log(`  - ${url}`)

  try {
    // Fetch and merge the SDK slice of every source into one document.
    const mergedPaths: Record<string, any> = {}
    const mergedSchemas: Record<string, any> = {}
    const mergedSecuritySchemes: Record<string, any> = {}
    const conflicts: string[] = []
    let firstDoc: OpenAPISpec | undefined

    for (const url of sources) {
      const doc = await fetchOpenApi(url)
      firstDoc ??= doc
      mergeSource(doc, url, mergedPaths, mergedSchemas, mergedSecuritySchemes, conflicts)
    }

    console.log(
      `Merged to ${Object.keys(mergedPaths).length} SDK paths (matching ${PATH_PREFIX}*)`,
    )
    if (conflicts.length > 0) {
      console.warn(`Merge conflicts (${conflicts.length}):`)
      for (const conflict of conflicts) console.warn(`  ! ${conflict}`)
    }

    if (Object.keys(mergedPaths).length === 0) {
      console.error(`ERROR: No paths found matching prefix "${PATH_PREFIX}"`)
      console.error('Is the backend running and serving /v1/sdk/* routes on the configured sources?')
      process.exit(1)
    }

    // Assemble a minimal, valid OpenAPI document for openapi-typescript.
    const filteredSpec: OpenAPISpec = {
      openapi: (firstDoc?.openapi as string) || '3.0.0',
      info: firstDoc?.info || { title: 'SolvaPay SDK API', version: '1.0' },
      paths: mergedPaths,
      components: {
        schemas: mergedSchemas,
        securitySchemes: mergedSecuritySchemes,
      },
    }

    const prunedSchemas = pruneUnreferencedSchemas(filteredSpec)
    console.log(`Pruned ${prunedSchemas} unreachable schemas`)

    const missingSchemasAdded = addMissingSchemaPlaceholders(filteredSpec)
    if (missingSchemasAdded > 0) {
      console.warn(
        `Added ${missingSchemasAdded} placeholder component schema(s) for unresolved $ref values`,
      )
    }

    // Deterministic ordering so the generated file is stable across runs.
    const stableSpec = sortDeep(filteredSpec)

    // Write filtered spec to temp file
    console.log('Writing filtered spec to', TEMP_SPEC_FILE)
    writeFileSync(TEMP_SPEC_FILE, JSON.stringify(stableSpec, null, 2))

    // Generate types from filtered spec
    console.log('Generating TypeScript types...')
    execSync(`npx openapi-typescript ${TEMP_SPEC_FILE} -o ${OUTPUT_FILE}`, { stdio: 'inherit' })

    // Post-process: Convert @description tags to TypeDoc-compatible format
    console.log('Converting @description tags to TypeDoc-compatible format...')
    let generatedContent = readFileSync(OUTPUT_FILE, 'utf-8')

    // Replace @description tags with inline descriptions
    // Pattern: /**\n * @description Text\n * @example ...\n */
    // Becomes: /**\n * Text\n * @example ...\n */
    // Match: /** followed by newline, then * @description <text>, then rest of comment
    generatedContent = generatedContent.replace(
      /(\/\*\*)\n(\s*)\*\s*@description\s+([^\n]+)/g,
      (match, commentStart, indent, description) => {
        // Remove @description and put description text directly
        return `${commentStart}\n${indent}* ${description.trim()}`
      },
    )

    writeFileSync(OUTPUT_FILE, generatedContent)

    // Format to repo style (single-quote, no-semi) so the committed file is
    // stable regardless of openapi-typescript's raw output style.
    console.log('Formatting with Prettier...')
    execSync(`npx prettier --write ${OUTPUT_FILE}`, { stdio: 'inherit' })

    // Clean up temp file
    console.log('Cleaning up...')
    unlinkSync(TEMP_SPEC_FILE)

    console.log('✅ Types generated successfully!')
  } catch (error) {
    // Clean up temp file if it exists
    try {
      unlinkSync(TEMP_SPEC_FILE)
    } catch {}

    console.error('❌ Error generating types:', (error as Error).message)
    process.exit(1)
  }
}

main()
