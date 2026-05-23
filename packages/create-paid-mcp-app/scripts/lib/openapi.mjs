/* global console, process */
/**
 * Shared OpenAPI utilities for `create-paid-mcp-app/from-openapi`.
 *
 * Used by `describe.mjs`, `scaffold.mjs`, and `test.mjs`. Every script
 * re-parses the spec from disk; no cached state across modules.
 *
 * Public surface:
 *   - loadSpec(specPath) -> { spec, format }
 *   - listOperations(spec) -> Operation[]
 *   - resolveSecuritySchemes(spec) -> ResolvedScheme[]
 *   - suggestTier(operation) -> 'free' | 'paid' | 'skip'
 *   - synthesizeExamples(operation) -> { inputs, examplesQuality }
 *   - buildAdvisories(operations, schemes) -> Advisory[]
 *
 * The only non-stdlib dependency is `@apidevtools/swagger-parser`,
 * pulled on demand via `npx --package @apidevtools/swagger-parser`.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SUPPORTED_AUTH_KINDS = new Set(['http-bearer', 'apiKey-header', 'none'])

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Load + parse an OpenAPI document from disk and run `$ref` resolution
 * through swagger-parser's `dereference`. Accepts JSON or YAML.
 *
 * Returns the fully-dereferenced spec so downstream callers never have
 * to think about `$ref` lookup.
 */
export async function loadSpec(specPath) {
  const absolute = resolve(specPath)
  const SwaggerParser = await loadSwaggerParser()
  const raw = await readFile(absolute, 'utf8')
  const format = absolute.endsWith('.yaml') || absolute.endsWith('.yml') ? 'yaml' : 'json'
  const spec = await SwaggerParser.dereference(absolute)
  return { spec, format, raw }
}

/**
 * Lazy-load `@apidevtools/swagger-parser`. The skill ships a tiny
 * `scripts/package.json` declaring this single dep; the user runs
 * `npm install` inside `scripts/` once per checkout before invoking
 * `describe.mjs`, `scaffold.mjs`, or `test.mjs`. The error message
 * here exists for the case where someone skipped that step.
 */
async function loadSwaggerParser() {
  try {
    const mod = await import('@apidevtools/swagger-parser')
    return mod.default ?? mod
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        '`@apidevtools/swagger-parser` is not installed. Run `npm install` inside the ' +
          '`scripts/` directory of this skill (one-time setup), then re-run.',
      )
    }
    throw err
  }
}

/**
 * Resolve the spec's server URL list. Handles OpenAPI 3.x
 * (`spec.servers[*].url`) and Swagger 2.0 (`spec.host` + `basePath` +
 * `schemes`) uniformly so downstream callers (`describe.mjs`,
 * `scaffold.mjs`) don't have to branch on `spec.swagger`.
 *
 * Returns `[]` when no server is declared in either shape. Falling
 * back to a placeholder is the caller's responsibility.
 */
export function getServerUrls(spec) {
  if (Array.isArray(spec.servers)) {
    const urls = spec.servers.map(s => s?.url).filter(u => typeof u === 'string' && u.length > 0)
    if (urls.length > 0) return urls
  }
  if (typeof spec.host === 'string' && spec.host.length > 0) {
    const basePath = typeof spec.basePath === 'string' ? spec.basePath : ''
    const schemes = Array.isArray(spec.schemes) && spec.schemes.length > 0 ? spec.schemes : ['https']
    return schemes.map(scheme => `${scheme}://${spec.host}${basePath}`)
  }
  return []
}

/**
 * Walk `paths` and return one entry per operation. Skips path-level
 * `parameters` after merging them into each operation's `parameters`.
 */
export function listOperations(spec) {
  const operations = []
  const paths = spec.paths ?? {}
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue
    const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = pathItem[method]
      if (!op || typeof op !== 'object') continue
      const operationId = op.operationId ?? defaultOperationId(method, path)
      const parameters = mergeParameters(pathLevelParams, op.parameters ?? [])
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? null,
        description: op.description ?? null,
        deprecated: op.deprecated === true,
        tags: Array.isArray(op.tags) ? op.tags : [],
        parameters,
        requestBody: extractRequestBody(op.requestBody),
        security: op.security ?? spec.security ?? null,
        raw: op,
      })
    }
  }
  return operations
}

/**
 * Resolve the spec's `securitySchemes` to a normalised list with a
 * `supported` flag. v1 supports only `http` bearer and `apiKey` in
 * header. Anything else carries `supported: false` and routes through
 * the advisories path.
 */
export function resolveSecuritySchemes(spec) {
  const schemes = spec.components?.securitySchemes ?? {}
  const resolved = []
  for (const [name, scheme] of Object.entries(schemes)) {
    if (!scheme || typeof scheme !== 'object') continue
    const entry = { name, type: scheme.type, supported: false, kind: 'unsupported' }
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      entry.supported = true
      entry.kind = 'http-bearer'
      entry.headerName = 'Authorization'
      entry.scheme = 'bearer'
    } else if (scheme.type === 'apiKey' && scheme.in === 'header') {
      entry.supported = true
      entry.kind = 'apiKey-header'
      entry.headerName = scheme.name
      entry.in = 'header'
    } else if (scheme.type === 'apiKey') {
      entry.kind = 'apiKey-unsupported'
      entry.in = scheme.in
      entry.headerName = scheme.name
      entry.reason = `apiKey \`in: ${scheme.in}\` is not supported in v1 (only \`header\` is)`
    } else if (scheme.type === 'oauth2') {
      entry.kind = 'oauth2'
      entry.reason = 'oauth2 is not supported in v1'
    } else if (scheme.type === 'openIdConnect') {
      entry.kind = 'openIdConnect'
      entry.reason = 'openIdConnect is not supported in v1'
    } else {
      entry.reason = `unrecognised auth type \`${scheme.type}\``
    }
    resolved.push(entry)
  }
  return resolved
}

/**
 * Tier heuristic: GET -> free, mutating -> paid, deprecated/x-internal -> skip.
 */
export function suggestTier(operation) {
  if (operation.deprecated) return 'skip'
  if (operation.raw?.['x-internal'] === true) return 'skip'
  if (operation.method === 'GET' || operation.method === 'HEAD') return 'free'
  if (MUTATING_METHODS.has(operation.method)) return 'paid'
  return 'free'
}

/**
 * Synthesise sample inputs for one operation by walking parameters +
 * the JSON request body. For each value, pick the first defined source:
 * `parameter.example` -> `parameter.examples[0].value` ->
 * `schema.default` -> `schema.example` -> first `enum` value -> a
 * type-driven placeholder.
 *
 * `examplesQuality` is `'real'` if every value came from a real
 * `example` / `default` / `enum`, `'placeholder'` if any value fell
 * back to a type-driven default. `test.mjs` uses this to decide whether
 * to call the tool or report `skipped`.
 */
export function synthesizeExamples(operation) {
  const inputs = {}
  let quality = 'real'
  for (const param of operation.parameters) {
    const { value, source } = pickParamValue(param)
    inputs[param.name] = value
    if (source === 'placeholder') quality = 'placeholder'
  }
  if (operation.requestBody) {
    if (operation.requestBody.example !== undefined) {
      // Media-type-level example takes precedence over schema synthesis.
      const value = operation.requestBody.example
      Object.assign(inputs, isPlainObject(value) ? value : { body: value })
    } else if (operation.requestBody.schema) {
      const { value, source } = pickSchemaValue(operation.requestBody.schema)
      Object.assign(inputs, isPlainObject(value) ? value : { body: value })
      if (source === 'placeholder') quality = 'placeholder'
    }
  }
  return { inputs, examplesQuality: quality }
}

/**
 * For each operation that requires an unsupported security scheme,
 * emit one advisory describing the offending operation + the two
 * remediations: mark the operation `skip`, or set
 * `upstreamAuth.kind = "none"`.
 */
export function buildAdvisories(operations, schemes) {
  const unsupported = new Map(
    schemes.filter(s => !s.supported).map(s => [s.name, s]),
  )
  if (unsupported.size === 0) return []
  const advisories = []
  for (const op of operations) {
    const requirements = op.security ?? []
    for (const req of requirements) {
      for (const schemeName of Object.keys(req)) {
        if (unsupported.has(schemeName)) {
          advisories.push({
            kind: 'unsupported-auth',
            operationId: op.operationId,
            schemeName,
            reason: unsupported.get(schemeName).reason,
            remediations: [
              `Mark \`${op.operationId}\` as \`tier: "skip"\` in selections.json (drop it from the generated worker).`,
              `Set top-level \`upstreamAuth.kind = "none"\` (only viable if the upstream tolerates anonymous calls).`,
            ],
          })
        }
      }
    }
  }
  return advisories
}

export function isSupportedAuthKind(kind) {
  return SUPPORTED_AUTH_KINDS.has(kind)
}

// — helpers ————————————————————————————————————————————————————————————

function mergeParameters(pathLevel, opLevel) {
  const map = new Map()
  for (const p of pathLevel) {
    if (!p || typeof p !== 'object') continue
    map.set(`${p.in}:${p.name}`, normaliseParameter(p))
  }
  for (const p of opLevel) {
    if (!p || typeof p !== 'object') continue
    map.set(`${p.in}:${p.name}`, normaliseParameter(p))
  }
  return Array.from(map.values())
}

function normaliseParameter(param) {
  const schema = param.schema ?? {}
  // Parameter-level `description` takes precedence over the inner
  // `schema.description` (OpenAPI 3 allows both; the parameter one is
  // the author's primary intent — schema-level usually describes the
  // shared component). Fall back to schema-level when only that is
  // present.
  const description =
    typeof param.description === 'string' && param.description.length > 0
      ? param.description
      : typeof schema.description === 'string' && schema.description.length > 0
        ? schema.description
        : null
  return {
    name: param.name,
    in: param.in,
    required: param.required === true || param.in === 'path',
    description,
    type: schema.type ?? 'string',
    format: schema.format ?? null,
    enum: Array.isArray(schema.enum) ? schema.enum : null,
    example: param.example,
    examples: param.examples ?? null,
    default: schema.default,
    schemaExample: schema.example,
  }
}

function extractRequestBody(requestBody) {
  if (!requestBody || typeof requestBody !== 'object') return null
  const json = requestBody.content?.['application/json']
  if (!json) return null
  return {
    required: requestBody.required === true,
    schema: json.schema ?? null,
    example: json.example ?? (json.examples ? Object.values(json.examples)[0]?.value : undefined),
  }
}

function pickParamValue(param) {
  if (param.example !== undefined) return { value: param.example, source: 'example' }
  if (param.examples && typeof param.examples === 'object') {
    const first = Object.values(param.examples)[0]
    if (first && first.value !== undefined) return { value: first.value, source: 'examples' }
  }
  if (param.default !== undefined) return { value: param.default, source: 'default' }
  if (param.schemaExample !== undefined) return { value: param.schemaExample, source: 'schema.example' }
  if (param.enum && param.enum.length > 0) return { value: param.enum[0], source: 'enum' }
  return { value: typedPlaceholder(param.type, param.format), source: 'placeholder' }
}

function pickSchemaValue(schema) {
  if (!schema || typeof schema !== 'object') {
    return { value: {}, source: 'placeholder' }
  }
  if (schema.example !== undefined) return { value: schema.example, source: 'schema.example' }
  if (schema.default !== undefined) return { value: schema.default, source: 'default' }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return { value: schema.enum[0], source: 'enum' }
  }
  if (schema.type === 'object' && schema.properties) {
    const out = {}
    let anyPlaceholder = false
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const picked = pickSchemaValue(propSchema)
      out[key] = picked.value
      if (picked.source === 'placeholder') anyPlaceholder = true
    }
    return { value: out, source: anyPlaceholder ? 'placeholder' : 'real' }
  }
  if (schema.type === 'array') {
    return { value: [], source: 'placeholder' }
  }
  return { value: typedPlaceholder(schema.type, schema.format), source: 'placeholder' }
}

function typedPlaceholder(type, format) {
  if (format === 'uuid') return '00000000-0000-0000-0000-000000000000'
  if (format === 'date') return '2026-01-01'
  if (format === 'date-time') return '2026-01-01T00:00:00.000Z'
  if (format === 'email') return 'user@example.com'
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return true
  if (type === 'array') return []
  if (type === 'object') return {}
  return 'string'
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function defaultOperationId(method, path) {
  const slug = path
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map((seg, i) => (i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
    .join('')
  return `${method}${slug.charAt(0).toUpperCase()}${slug.slice(1)}`
}
