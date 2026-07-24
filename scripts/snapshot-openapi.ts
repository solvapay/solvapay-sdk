/**
 * Regenerate or check the checked-in `/v1/sdk/*` OpenAPI snapshot.
 *
 * Modes:
 *   --from-url [url]   Fetch live OpenAPI (default: http://localhost:3001/v1/openapi.json)
 *                      and write source + snapshot under --out.
 *   --from-file <path> Derive source + snapshot from a recorded/full OpenAPI JSON file.
 *   --check            Offline CI gate: derive snapshot from source, diff vs committed
 *                      snapshot, and confirm double-derive is byte-identical.
 *
 * Never invokes openapi-typescript or writes generated.ts.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deriveSnapshot,
  deriveSource,
  serializeSnapshot,
  type OpenApiSpec,
} from './lib/openapi-pipeline.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_URL = 'http://localhost:3001/v1/openapi.json'
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'contract/openapi')
const DEFAULT_SOURCE = path.join(DEFAULT_OUT_DIR, 'sdk-v1.source.json')
const DEFAULT_SNAPSHOT = path.join(DEFAULT_OUT_DIR, 'sdk-v1.snapshot.json')

export interface CliOptions {
  mode: 'write' | 'check'
  fromUrl?: string
  fromFile?: string
  outDir: string
  sourcePath: string
  snapshotPath: string
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

function printUsage(): string {
  return `Usage:
  pnpm snapshot:openapi --from-url [url] [--out <dir>]
  pnpm snapshot:openapi --from-file <path> [--out <dir>]
  pnpm snapshot:openapi:check
  pnpm exec tsx scripts/snapshot-openapi.ts --check [--from-file <source>] [--snapshot <path>]
`
}

export function parseArgs(argv: string[]): CliOptions {
  let fromUrl: string | undefined
  let fromFile: string | undefined
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

  if (fromUrl === undefined && fromFile === undefined) {
    fromUrl = DEFAULT_URL
  }

  if (fromUrl !== undefined && fromFile !== undefined) {
    throw new Error('Use only one of --from-url or --from-file')
  }

  return {
    mode: 'write',
    fromUrl,
    fromFile: fromFile ? path.resolve(fromFile) : undefined,
    outDir,
    sourcePath: path.join(outDir, 'sdk-v1.source.json'),
    snapshotPath: path.join(outDir, 'sdk-v1.snapshot.json'),
  }
}

function isOpenApiSpec(value: unknown): value is OpenApiSpec {
  return typeof value === 'object' && value !== null
}

async function loadSpec(options: CliOptions): Promise<OpenApiSpec> {
  if (options.fromFile) {
    const raw = JSON.parse(readFileSync(options.fromFile, 'utf8')) as unknown
    if (!isOpenApiSpec(raw)) {
      throw new Error(`Invalid OpenAPI JSON: ${options.fromFile}`)
    }
    return raw
  }

  if (!options.fromUrl) {
    throw new Error('No input specified')
  }

  const response = await fetch(options.fromUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenAPI spec from ${options.fromUrl}: ${response.status} ${response.statusText}`,
    )
  }
  const raw = (await response.json()) as unknown
  if (!isOpenApiSpec(raw)) {
    throw new Error(`Invalid OpenAPI JSON from ${options.fromUrl}`)
  }
  return raw
}

function writeArtifacts(spec: OpenApiSpec, options: CliOptions): string {
  mkdirSync(options.outDir, { recursive: true })

  const source = serializeSnapshot(deriveSource(spec))
  const snapshot = serializeSnapshot(deriveSnapshot(spec))

  writeFileSync(options.sourcePath, source)
  writeFileSync(options.snapshotPath, snapshot)

  return `Wrote ${options.sourcePath}\nWrote ${options.snapshotPath}\n`
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

export async function runCli(argv: string[]): Promise<CliResult> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${message}\n${printUsage()}`,
    }
  }

  try {
    if (options.mode === 'check') {
      return runCheck(options)
    }

    const spec = await loadSpec(options)
    return {
      exitCode: 0,
      stdout: writeArtifacts(spec, options),
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

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  process.exit(result.exitCode)
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  void main()
}
