/**
 * Scaffold a new catalog entry (+ optional bindings stub) into sdk-contract.yaml.
 *
 * Usage:
 *   pnpm gen:scaffold operation <id> --method POST --path /v1/sdk/foo
 *   pnpm gen:scaffold operation <id> --method GET --path /v1/sdk/foo/{ref}
 *
 * Derives request/response DTO refs and path-param names from the OpenAPI
 * snapshot. Fills all five language names via `deriveNames`. Leaves a docs
 * placeholder for human prose. Optionally scaffolds a `bindings:` stub.
 *
 * Full workflow: docs/contributing/sdk-codegen.md (Workflow A).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { insertSectionEntry, renderYamlFragment, sectionBounds } from './lib/manifest-edit.js'
import { deriveNames, toSnakeCase } from './lib/manifest-schema.js'
import type { OpenApiSpec } from './lib/openapi-pipeline.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'contract/manifest/sdk-contract.yaml')
const DEFAULT_SNAPSHOT = path.join(REPO_ROOT, 'contract/openapi/sdk-v1.snapshot.json')

const DEFAULT_SYNC = {
  ts: 'async',
  py: ['async', 'blocking'],
  rb: 'blocking',
  go: 'blocking',
  rust: ['async', 'blocking'],
} as const

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ScaffoldOptions {
  kind: 'operation'
  id: string
  method: HttpMethod
  path: string
  manifestPath: string
  snapshotPath: string
  withBindings: boolean
}

function printUsage(): string {
  return `Usage:
  pnpm gen:scaffold operation <id> --method <GET|POST|PUT|PATCH|DELETE> --path <route> [--no-bindings]
`
}

function schemaRefName(schema: unknown): string | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined
  }
  const ref = (schema as { $ref?: unknown }).$ref
  if (typeof ref !== 'string') {
    return undefined
  }
  const match = ref.match(/^#\/components\/schemas\/(.+)$/)
  return match?.[1]
}

function pathParamNames(routePath: string): string[] {
  const names: string[] = []
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(routePath)) !== null) {
    const name = match[1]
    if (name !== undefined) {
      names.push(name)
    }
  }
  return names
}

function openApiOperation(
  snapshot: OpenApiSpec,
  method: HttpMethod,
  routePath: string,
): Record<string, unknown> {
  const methods = snapshot.paths?.[routePath]
  if (!methods || typeof methods !== 'object') {
    throw new Error(`OpenAPI path not found: ${routePath}`)
  }
  const op = (methods as Record<string, unknown>)[method.toLowerCase()]
  if (!op || typeof op !== 'object') {
    throw new Error(`OpenAPI operation not found: ${method} ${routePath}`)
  }
  return op as Record<string, unknown>
}

function requestSchemaName(op: Record<string, unknown>): string | undefined {
  const body = op.requestBody
  if (!body || typeof body !== 'object') {
    return undefined
  }
  const content = (body as { content?: Record<string, { schema?: unknown }> }).content
  const json = content?.['application/json']
  return schemaRefName(json?.schema)
}

function responseSchemaName(op: Record<string, unknown>): string {
  const responses = op.responses
  if (!responses || typeof responses !== 'object') {
    throw new Error('OpenAPI operation has no responses')
  }
  const responseMap = responses as Record<string, unknown>
  for (const code of ['200', '201', '202', '204']) {
    const response = responseMap[code]
    if (!response || typeof response !== 'object') {
      continue
    }
    if (code === '204') {
      return 'void'
    }
    const content = (response as { content?: Record<string, { schema?: unknown }> }).content
    const json = content?.['application/json']
    const name = schemaRefName(json?.schema)
    if (name !== undefined) {
      return name
    }
  }
  throw new Error('Could not resolve success response schema from OpenAPI')
}

function buildParams(
  pathParams: string[],
  requestName: string | undefined,
): Array<Record<string, unknown>> {
  const params: Array<Record<string, unknown>> = pathParams.map(name => ({
    name,
    type: 'string',
    required: true,
  }))
  if (requestName !== undefined) {
    params.push({
      name: 'params',
      ref: requestName,
      required: true,
    })
  }
  return params
}

function operationBodyYaml(opts: {
  method: HttpMethod
  routePath: string
  id: string
  request?: string
  response: string
  params: Array<Record<string, unknown>>
  description?: string
}): string {
  const names = deriveNames(opts.id)
  const overlays = [opts.response, ...(opts.request !== undefined ? [opts.request] : [])]
  const docsSummary =
    opts.description?.trim() || `TODO: document ${opts.id} (${opts.method} ${opts.routePath}).`
  const doc: Record<string, unknown> = {
    route: { method: opts.method, path: opts.routePath },
    names,
    optionalOnClient: false,
    ...(opts.request !== undefined ? { request: opts.request } : {}),
    response: opts.response,
    overlays,
    normalization: [],
    shadow: { volatile: [] },
    idempotency: { kind: 'none' },
    errors: {
      default: {
        messageTemplate: `${opts.id} failed ({status}): {body}`,
      },
      cases: [],
    },
    params: opts.params,
    docs: {
      summary: docsSummary,
      params: Object.fromEntries(
        opts.params.map(p => {
          const name = String(p.name)
          return [name, `TODO: document param \`${name}\`.`]
        }),
      ),
      returns: `TODO: document return value of ${opts.id}.`,
    },
    sync: DEFAULT_SYNC,
  }
  // Strip the outer key — insertSectionEntry adds `  id:\n`.
  return renderYamlFragment(doc, 4)
}

function bindingBodyYaml(opts: {
  id: string
  method: HttpMethod
  routePath: string
  params: Array<Record<string, unknown>>
  request?: string
  emitOrder: number
}): string {
  const names = deriveNames(opts.id)
  const snake = toSnakeCase(opts.id)
  const pathRefs = opts.params.filter(p => p.type === 'string').map(p => String(p.name))
  const bodyParam = opts.params.find(p => typeof p.ref === 'string')
  const dtoType = opts.request ?? (typeof bodyParam?.ref === 'string' ? bodyParam.ref : undefined)
  const isSplit = pathRefs.length > 0
  const clientCallArgs = [
    ...pathRefs.map((_, i) => `&refs[${i}]`),
    ...(bodyParam !== undefined
      ? [bodyParam.name === 'overrides' ? 'Some(overrides)' : String(bodyParam.name)]
      : []),
  ]

  const doc: Record<string, unknown> = {
    core: `solvapay_transport::SolvaPayClient::${snake}`,
    names,
    catalog: { kind: 'operation', id: opts.id },
    args: [],
    splitPathRefs: pathRefs,
    return: 'value',
    sync: 'async',
    envelope: 'async',
    artifact: 'client',
    emitOrder: opts.emitOrder,
    section: 'Group B',
    doc: `\`${opts.method} ${opts.routePath}\``,
    rustFnName: snake,
    call: {
      kind: 'wrap',
      serialize: isSplit ? 'clientSplit' : 'clientAwait',
    },
    coreCall: snake,
    ...(dtoType !== undefined ? { dtoType } : {}),
    ...(isSplit ? { clientCallArgs } : {}),
  }
  return renderYamlFragment(doc, 4)
}

function nextClientEmitOrder(manifestRaw: string): number {
  const parsed = parseYaml(manifestRaw) as {
    bindings?: Record<string, { emitOrder?: number; artifact?: string }>
  }
  let max = -1
  for (const symbol of Object.values(parsed.bindings ?? {})) {
    if (symbol.artifact === 'client' && typeof symbol.emitOrder === 'number') {
      max = Math.max(max, symbol.emitOrder)
    }
  }
  return max + 1
}

function sectionHasEntry(text: string, sectionName: string, entryId: string): boolean {
  const { bodyStart, bodyEnd } = sectionBounds(text, sectionName)
  return new RegExp(`^  ${entryId}:\\n`, 'm').test(text.slice(bodyStart, bodyEnd))
}

export function parseArgs(argv: string[]): ScaffoldOptions {
  const kind = argv[0]
  const id = argv[1]
  if (kind !== 'operation' || !id || id.startsWith('--')) {
    throw new Error(printUsage().trim())
  }

  let method: HttpMethod | undefined
  let routePath: string | undefined
  let manifestPath = DEFAULT_MANIFEST
  let snapshotPath = DEFAULT_SNAPSHOT
  let withBindings = true

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--method') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('--method requires GET|POST|PUT|PATCH|DELETE')
      }
      const upper = next.toUpperCase()
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) {
        throw new Error(`Invalid method: ${next}`)
      }
      method = upper as HttpMethod
      i += 1
      continue
    }
    if (arg === '--path') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('--path requires a route path')
      }
      routePath = next
      i += 1
      continue
    }
    if (arg === '--manifest') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('--manifest requires a path')
      }
      manifestPath = path.resolve(next)
      i += 1
      continue
    }
    if (arg === '--snapshot') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('--snapshot requires a path')
      }
      snapshotPath = path.resolve(next)
      i += 1
      continue
    }
    if (arg === '--no-bindings') {
      withBindings = false
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error(printUsage().trim())
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (method === undefined || routePath === undefined) {
    throw new Error('--method and --path are required\n' + printUsage())
  }

  return {
    kind: 'operation',
    id,
    method,
    path: routePath,
    manifestPath,
    snapshotPath,
    withBindings,
  }
}

export function scaffoldOperation(options: ScaffoldOptions): {
  stdout: string
  manifestRaw: string
} {
  const snapshot = JSON.parse(readFileSync(options.snapshotPath, 'utf8')) as OpenApiSpec
  const op = openApiOperation(snapshot, options.method, options.path)
  const request = requestSchemaName(op)
  const response = responseSchemaName(op)
  const pathParams = pathParamNames(options.path)
  const params = buildParams(pathParams, request)
  const description =
    (typeof op.description === 'string' && op.description.trim()) ||
    (typeof op.summary === 'string' && op.summary.trim()) ||
    undefined

  let raw = readFileSync(options.manifestPath, 'utf8')
  if (sectionHasEntry(raw, 'operations', options.id)) {
    throw new Error(`operations.${options.id} already exists in manifest`)
  }

  const opBody = operationBodyYaml({
    method: options.method,
    routePath: options.path,
    id: options.id,
    request,
    response,
    params,
    description,
  })
  raw = insertSectionEntry(raw, 'operations', options.id, opBody)

  const lines = [`Scaffolded operations.${options.id}`]

  if (options.withBindings) {
    if (sectionHasEntry(raw, 'bindings', options.id)) {
      lines.push(`bindings.${options.id} already present — skipped`)
    } else {
      const emitOrder = nextClientEmitOrder(raw)
      const bindBody = bindingBodyYaml({
        id: options.id,
        method: options.method,
        routePath: options.path,
        params,
        request,
        emitOrder,
      })
      raw = insertSectionEntry(raw, 'bindings', options.id, bindBody)
      lines.push(`Scaffolded bindings.${options.id} (emitOrder ${emitOrder})`)
      lines.push(`Remember: add '${options.id}' to SHIM_JS_NAMES (or run pnpm gen:bindings --fix)`)
    }
  }

  lines.push('Fill/replace docs: prose, then run: pnpm gen && pnpm manifest:check')
  return { stdout: lines.join('\n') + '\n', manifestRaw: raw }
}

async function main(): Promise<void> {
  let options: ScaffoldOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }

  try {
    const result = scaffoldOperation(options)
    writeFileSync(options.manifestPath, result.manifestRaw)
    process.stdout.write(result.stdout)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  void main()
}
