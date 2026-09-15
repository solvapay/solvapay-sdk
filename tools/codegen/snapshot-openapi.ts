/**
 * Regenerate or check the checked-in `/v1/sdk/*` OpenAPI snapshot.
 *
 * Modes:
 *   --from-url [url]   Fetch live OpenAPI (default: http://localhost:3001/v1/openapi.json)
 *                      and write source + snapshot under --out.
 *   --from-file <path> Derive source + snapshot from a recorded/full OpenAPI JSON file.
 *   --from-stack       Merge each service's /v1/openapi.json from local-stack.yaml.
 *   --check            Offline CI gate: derive snapshot from source, diff vs committed
 *                      snapshot, and confirm double-derive is byte-identical.
 *   --check --from-stack
 *                      Stack-aware drift gate: merge the running stack, derive the
 *                      snapshot, and fail on any diff vs the committed file.
 *
 * Never invokes openapi-typescript or writes generated.ts.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  deriveSnapshot,
  deriveSource,
  mergeSpecs,
  serializeSnapshot,
  type OpenApiSpec,
} from './lib/openapi-pipeline.js'
import { lookupPath } from '../shared/repo-paths.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'

const DEFAULT_URL = 'http://localhost:3001/v1/openapi.json'
const DEFAULT_STACK_ORIGIN = 'http://localhost'
const DEFAULT_OUT_DIR = lookupPath('openapiDir')
const DEFAULT_SOURCE = path.join(DEFAULT_OUT_DIR, 'sdk-v1.source.json')
const DEFAULT_SNAPSHOT = path.join(DEFAULT_OUT_DIR, 'sdk-v1.snapshot.json')

export interface StackService {
  name: string
  port: number
}

export function loadLocalStack(): StackService[] {
  const raw: unknown = parseYaml(readFileSync(lookupPath('openapiLocalStack'), 'utf8'))
  if (typeof raw !== 'object' || raw === null || !('services' in raw)) {
    throw new Error('local-stack.yaml is missing services')
  }
  const services = (raw as { services: unknown }).services
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error('local-stack.yaml services must be a non-empty array')
  }
  return services.map(item => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('local-stack.yaml service entry must be an object')
    }
    const record = item as { name?: unknown; port?: unknown }
    if (typeof record.name !== 'string' || typeof record.port !== 'number') {
      throw new Error('local-stack.yaml service requires name and port')
    }
    return { name: record.name, port: record.port }
  })
}

export interface CliOptions {
  mode: 'write' | 'check'
  fromUrl?: string
  fromFile?: string
  fromStack?: string
  outDir: string
  sourcePath: string
  snapshotPath: string
}

function printUsage(): string {
  return `Usage:
  pnpm snapshot:openapi --from-url [url] [--out <dir>]
  pnpm snapshot:openapi --from-stack [origin] [--out <dir>]
  pnpm snapshot:openapi --from-file <path> [--out <dir>]
  pnpm snapshot:openapi:check
  pnpm snapshot:openapi:check --from-stack [origin]
`
}

export function parseArgs(argv: string[]): CliOptions {
  let fromUrl: string | undefined
  let fromFile: string | undefined
  let fromStack: string | undefined
  let outDir = DEFAULT_OUT_DIR
  let sourcePath = DEFAULT_SOURCE
  let snapshotPath = DEFAULT_SNAPSHOT
  let check = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') {
      check = true
      continue
    }
    if (arg === '--from-url') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        fromUrl = next
        i += 1
      } else {
        fromUrl = DEFAULT_URL
      }
      continue
    }
    if (arg === '--from-stack') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        fromStack = next.replace(/\/$/, '')
        i += 1
      } else {
        fromStack = DEFAULT_STACK_ORIGIN
      }
      continue
    }
    if (arg === '--from-file') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('--from-file requires a path')
      }
      fromFile = next
      i += 1
      continue
    }
    if (arg === '--out') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('--out requires a directory path')
      }
      outDir = path.resolve(next)
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
    if (arg === '--help' || arg === '-h') {
      throw new Error(printUsage().trim())
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (check) {
    if (fromUrl !== undefined) {
      throw new Error('--check does not support --from-url')
    }
    if (fromFile !== undefined && fromStack !== undefined) {
      throw new Error('Use only one of --from-file or --from-stack with --check')
    }
    if (fromStack !== undefined) {
      return {
        mode: 'check',
        fromStack,
        outDir,
        sourcePath,
        snapshotPath,
      }
    }
    if (fromFile) {
      sourcePath = path.resolve(fromFile)
    }
    return {
      mode: 'check',
      fromFile: sourcePath,
      outDir,
      sourcePath,
      snapshotPath,
    }
  }

  if (fromUrl === undefined && fromFile === undefined && fromStack === undefined) {
    fromUrl = DEFAULT_URL
  }

  const sources = [fromUrl, fromFile, fromStack].filter(value => value !== undefined)
  if (sources.length > 1) {
    throw new Error('Use only one of --from-url, --from-file, or --from-stack')
  }

  return {
    mode: 'write',
    fromUrl,
    fromFile: fromFile ? path.resolve(fromFile) : undefined,
    fromStack,
    outDir,
    sourcePath: path.join(outDir, 'sdk-v1.source.json'),
    snapshotPath: path.join(outDir, 'sdk-v1.snapshot.json'),
  }
}

function isOpenApiSpec(value: unknown): value is OpenApiSpec {
  return typeof value === 'object' && value !== null
}

export interface SnapshotDeps {
  fetchJson?: (url: string) => Promise<unknown>
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenAPI spec from ${url}: ${response.status} ${response.statusText}`,
    )
  }
  return response.json()
}

function specFromUnknown(raw: unknown, label: string): OpenApiSpec {
  if (!isOpenApiSpec(raw)) {
    throw new Error(`Invalid OpenAPI JSON from ${label}`)
  }
  return raw
}

async function loadSpec(
  options: CliOptions,
  fetchJson: SnapshotDeps['fetchJson'],
): Promise<OpenApiSpec> {
  const load = fetchJson ?? defaultFetchJson
  if (options.fromFile) {
    const raw = JSON.parse(readFileSync(options.fromFile, 'utf8')) as unknown
    return specFromUnknown(raw, options.fromFile)
  }

  if (options.fromStack !== undefined) {
    const services = loadLocalStack()
    const named = []
    for (const service of services) {
      const url = `${options.fromStack}:${service.port}/v1/openapi.json`
      try {
        const raw = await load(url)
        named.push({ name: service.name, spec: specFromUnknown(raw, url) })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Failed to fetch OpenAPI spec from ${service.name} on port ${service.port} (${url}): ${detail}`,
        )
      }
    }
    return mergeSpecs(named)
  }

  if (!options.fromUrl) {
    throw new Error('No input specified')
  }

  const raw = await load(options.fromUrl)
  return specFromUnknown(raw, options.fromUrl)
}

export function pathDiffReport(spec: OpenApiSpec, snapshotPath: string): string {
  const derivedPaths = Object.keys(spec.paths ?? {}).sort()
  const committedRaw = JSON.parse(readFileSync(snapshotPath, 'utf8')) as OpenApiSpec
  const committedPaths = Object.keys(committedRaw.paths ?? {}).sort()
  const derivedSet = new Set(derivedPaths)
  const committedSet = new Set(committedPaths)
  const added = derivedPaths.filter(item => !committedSet.has(item))
  const removed = committedPaths.filter(item => !derivedSet.has(item))
  const lines = [
    `merged ${derivedPaths.length} paths from ${loadLocalStack().length} services (committed: ${committedPaths.length})`,
  ]
  if (added.length > 0) {
    lines.push(`added paths:\n${added.map(item => `  ${item}`).join('\n')}`)
  }
  if (removed.length > 0) {
    lines.push(`removed paths:\n${removed.map(item => `  ${item}`).join('\n')}`)
  }
  return `${lines.join('\n')}\n`
}

function writeArtifacts(spec: OpenApiSpec, options: CliOptions, fromStack: boolean): string {
  mkdirSync(options.outDir, { recursive: true })

  const source = serializeSnapshot(deriveSource(spec))
  const snapshot = serializeSnapshot(deriveSnapshot(spec))

  writeFileSync(options.sourcePath, source)
  writeFileSync(options.snapshotPath, snapshot)

  const wrote = `Wrote ${options.sourcePath}\nWrote ${options.snapshotPath}\n`
  if (!fromStack) {
    return wrote
  }
  return `${pathDiffReport(deriveSource(spec), options.snapshotPath)}${wrote}`
}

export function unifiedDiff(expected: string, actual: string): string {
  const expectedLines = expected.split('\n')
  const actualLines = actual.split('\n')
  const max = Math.max(expectedLines.length, actualLines.length)
  const lines: string[] = ['--- committed snapshot', '+++ derived snapshot']

  for (let i = 0; i < max; i += 1) {
    const left = expectedLines[i]
    const right = actualLines[i]
    if (left === right) {
      continue
    }
    if (left !== undefined) {
      lines.push(`-${left}`)
    }
    if (right !== undefined) {
      lines.push(`+${right}`)
    }
  }

  if (lines.length === 2) {
    return 'Snapshots differ (unable to render line diff)'
  }
  return lines.join('\n')
}

export function runCheck(options: CliOptions): CliResult {
  const sourceRaw = JSON.parse(readFileSync(options.sourcePath, 'utf8')) as unknown
  if (!isOpenApiSpec(sourceRaw)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Invalid source OpenAPI JSON: ${options.sourcePath}\n`,
    }
  }

  const committed = readFileSync(options.snapshotPath, 'utf8')
  const derivedOnce = serializeSnapshot(deriveSnapshot(sourceRaw))
  const derivedTwice = serializeSnapshot(deriveSnapshot(deriveSnapshot(sourceRaw)))

  if (derivedOnce !== derivedTwice) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Idempotence check failed: deriveSnapshot is not byte-stable across two runs\n${unifiedDiff(derivedOnce, derivedTwice)}\n`,
    }
  }

  if (derivedOnce !== committed) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `OpenAPI snapshot mismatch: derived snapshot differs from committed file\n${unifiedDiff(committed, derivedOnce)}\n`,
    }
  }

  return {
    exitCode: 0,
    stdout: 'OpenAPI snapshot check passed (zero diff, idempotent)\n',
    stderr: '',
  }
}

export async function runStackCheck(
  options: CliOptions,
  deps: SnapshotDeps = {},
): Promise<CliResult> {
  const spec = await loadSpec(options, deps.fetchJson)
  const derived = serializeSnapshot(deriveSnapshot(spec))
  const committed = readFileSync(options.snapshotPath, 'utf8')
  if (derived !== committed) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `OpenAPI snapshot mismatch against running stack: derived snapshot differs from committed file\n${unifiedDiff(committed, derived)}\n`,
    }
  }
  return {
    exitCode: 0,
    stdout: 'OpenAPI snapshot matches the running stack (zero diff)\n',
    stderr: '',
  }
}

export async function runCli(argv: string[], deps: SnapshotDeps = {}): Promise<CliResult> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    return parseErrorResult(error, printUsage())
  }

  try {
    if (options.mode === 'check') {
      if (options.fromStack !== undefined) {
        return await runStackCheck(options, deps)
      }
      return runCheck(options)
    }

    const spec = await loadSpec(options, deps.fetchJson)
    return {
      exitCode: 0,
      stdout: writeArtifacts(spec, options, options.fromStack !== undefined),
      stderr: '',
    }
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(argv => runCli(argv))
}
