/**
 * Validate the SDK contract manifest (schema + coverage + OpenAPI cross-check).
 *
 * Modes:
 *   (default)   Schema + semantic coverage/collision/name checks (offline).
 *   --check     Same as default, plus OpenAPI snapshot route/DTO cross-check.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  SdkContractManifestSchema,
  crossCheckOpenApi,
  validateManifestSemantics,
  type BindingReconcileEntry,
  type OpenApiSnapshot,
  type SdkContractManifest,
} from '../shared/manifest-schema.js'
import { REPO_ROOT } from '../shared/paths.js'
import { contractInputPath, generatedEntry } from '../shared/repo-paths.js'
import {
  isDirectRun,
  formatZodIssues,
  parseErrorResult,
  runScriptMain,
  type CliResult,
} from './lib/cli.js'

const DEFAULT_MANIFEST = contractInputPath('sdkManifest')
const DEFAULT_SNAPSHOT = contractInputPath('openapiSnapshot')

export interface CliOptions {
  mode: 'validate' | 'check'
  manifestPath: string
  snapshotPath: string
}

function printUsage(): string {
  return `Usage:
  pnpm manifest:validate [--manifest <path>]
  pnpm manifest:check [--manifest <path>] [--snapshot <path>]
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

function loadDerivedBindings(): Record<string, BindingReconcileEntry> {
  const rel = generatedEntry('bindingSymbols').path
  const filePath = path.join(REPO_ROOT, ...rel.split('/'))
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as {
    bindings: Record<
      string,
      { core: string; catalog: BindingReconcileEntry['catalog']; names: { ts: string } }
    >
  }
  const out: Record<string, BindingReconcileEntry> = {}
  for (const [id, symbol] of Object.entries(raw.bindings)) {
    out[id] = {
      core: symbol.core,
      catalog: symbol.catalog,
      names: { ts: symbol.names.ts },
    }
  }
  return out
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

  const semanticIssues = validateManifestSemantics(loaded.manifest, loadDerivedBindings())
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
    return parseErrorResult(error, printUsage())
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

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
