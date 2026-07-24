/**
 * Validate the SDK contract manifest (schema + coverage + OpenAPI cross-check).
 *
 * Modes:
 *   (default)   Schema + semantic coverage/collision/name checks (offline).
 *   --check     Same as default, plus OpenAPI snapshot route/DTO cross-check.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  SdkContractManifestSchema,
  crossCheckOpenApi,
  validateManifestSemantics,
  type OpenApiSnapshot,
  type SdkContractManifest,
} from './lib/manifest-schema.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'contract/manifest/sdk-contract.yaml')
const DEFAULT_SNAPSHOT = path.join(REPO_ROOT, 'contract/openapi/sdk-v1.snapshot.json')

export interface CliOptions {
  mode: 'validate' | 'check'
  manifestPath: string
  snapshotPath: string
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

function printUsage(): string {
  return `Usage:
  pnpm manifest:validate [--manifest <path>]
  pnpm manifest:check [--manifest <path>] [--snapshot <path>]
  pnpm exec tsx scripts/manifest.ts --check [--manifest <path>] [--snapshot <path>]
`
}

export function parseArgs(argv: string[]): CliOptions {
  let manifestPath = DEFAULT_MANIFEST
  let snapshotPath = DEFAULT_SNAPSHOT
  let check = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') {
      check = true
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
    if (arg === '--help' || arg === '-h') {
      throw new Error(printUsage().trim())
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    mode: check ? 'check' : 'validate',
    manifestPath,
    snapshotPath,
  }
}

function formatZodIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): string {
  return error.issues
    .map(issue => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  - ${pathLabel}: ${issue.message}`
    })
    .join('\n')
}

function loadManifest(
  manifestPath: string,
): { ok: true; manifest: SdkContractManifest } | { ok: false; stderr: string } {
  let rawText: string
  try {
    rawText = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    return {
      ok: false,
      stderr: `Failed to read manifest: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }

  let parsed: unknown
  try {
    parsed = parseYaml(rawText)
  } catch (error) {
    return {
      ok: false,
      stderr: `Failed to parse manifest YAML: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }

  const result = SdkContractManifestSchema.safeParse(parsed)
  if (!result.success) {
    return {
      ok: false,
      stderr: `Manifest schema validation failed:\n${formatZodIssues(result.error)}\n`,
    }
  }

  return { ok: true, manifest: result.data }
}

function loadSnapshot(
  snapshotPath: string,
): { ok: true; snapshot: OpenApiSnapshot } | { ok: false; stderr: string } {
  try {
    const raw = JSON.parse(readFileSync(snapshotPath, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, stderr: `Invalid OpenAPI snapshot JSON: ${snapshotPath}\n` }
    }
    return { ok: true, snapshot: raw as OpenApiSnapshot }
  } catch (error) {
    return {
      ok: false,
      stderr: `Failed to read OpenAPI snapshot: ${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

export function runCheck(options: CliOptions): CliResult {
  const loaded = loadManifest(options.manifestPath)
  if (!loaded.ok) {
    return { exitCode: 1, stdout: '', stderr: loaded.stderr }
  }

  const semanticIssues = validateManifestSemantics(loaded.manifest)
  if (semanticIssues.length > 0) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Manifest semantic checks failed:\n${semanticIssues.map(i => `  - ${i}`).join('\n')}\n`,
    }
  }

  if (options.mode === 'check') {
    const snapshot = loadSnapshot(options.snapshotPath)
    if (!snapshot.ok) {
      return { exitCode: 1, stdout: '', stderr: snapshot.stderr }
    }
    const crossIssues = crossCheckOpenApi(loaded.manifest, snapshot.snapshot)
    if (crossIssues.length > 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `OpenAPI cross-check failed:\n${crossIssues.map(i => `  - ${i}`).join('\n')}\n`,
      }
    }
    return {
      exitCode: 0,
      stdout: 'SDK contract manifest check passed (schema, coverage, OpenAPI cross-check)\n',
      stderr: '',
    }
  }

  return {
    exitCode: 0,
    stdout: 'SDK contract manifest is valid (schema + coverage)\n',
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
    return runCheck(options)
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
