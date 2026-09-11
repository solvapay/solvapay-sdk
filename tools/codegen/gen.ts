/**
 * Canonical dto-gen invocation for all six SDK surfaces.
 *
 * Modes:
 *   (default)  Regenerate Rust DTOs, TS/Python/Ruby/Go/Rust clients, binding shims.
 *   --check    Snapshot generated paths, regenerate, fail if those bytes changed.
 *              Compares working tree to itself (idempotence), not to git HEAD, so
 *              already-regenerated uncommitted files stay green.
 *
 * This is the single source of truth for dto-gen invocation — CI and humans share it.
 * dto-gen reads `contract/manifest/repo-paths.yaml` via `--config`.
 *
 * Runbook: docs/contributing/sdk-codegen.md
 *   pnpm gen | pnpm gen:check | pnpm gen:all
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../shared/paths.js'
import { dtoGenArgs, generatedDriftPaths, lookupPath } from '../shared/repo-paths.js'
import { runFacadeCoverage } from './facade-coverage.js'
import { runWasmProfiles } from './wasm-profiles.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'

/** dto-gen argv (paths relative to the repo root). Derived from repo-paths.yaml. */
export const DTO_GEN_ARGS = dtoGenArgs()

/** Repo-root-relative paths checked for drift after regen. */
export const GENERATED_PATHS = generatedDriftPaths()

export interface CliOptions {
  check: boolean
}

function printUsage(): string {
  return `Usage:
  pnpm gen
  pnpm gen:check
`
}

export function parseArgs(argv: string[]): CliOptions {
  let check = false
  for (const arg of argv) {
    if (arg === '--check') {
      check = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error(printUsage().trim())
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { check }
}

function runDtoGen(): CliResult {
  const result = spawnSync('cargo', ['run', '-q', '-p', 'dto-gen', '--', ...DTO_GEN_ARGS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.error) {
    return {
      exitCode: 1,
      stdout: result.stdout ?? '',
      stderr: `Failed to run dto-gen: ${result.error.message}\n`,
    }
  }
  if (result.status !== 0) {
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr || 'dto-gen failed\n',
    }
  }
  return {
    exitCode: 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function formatGeneratedGo(): CliResult {
  const goFiles = GENERATED_PATHS.filter(rel => rel.endsWith('.go'))
  if (goFiles.length === 0) {
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const result = spawnSync('gofmt', ['-w', ...goFiles], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.error) {
    return {
      exitCode: 1,
      stdout: result.stdout ?? '',
      stderr: `Failed to run gofmt: ${result.error.message}\n`,
    }
  }
  if (result.status !== 0) {
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr || 'gofmt failed\n',
    }
  }
  return { exitCode: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function runGenerateTypes(): CliResult {
  const result = spawnSync('tsx', [lookupPath('generateTypesScript')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.error) {
    return {
      exitCode: 1,
      stdout: result.stdout ?? '',
      stderr: `Failed to generate TypeScript OpenAPI types: ${result.error.message}\n`,
    }
  }
  if (result.status !== 0) {
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr || 'generate-types failed\n',
    }
  }
  return {
    exitCode: 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const SKIP_DIR_NAMES = new Set(['target', 'node_modules'])

function collectGeneratedFiles(root: string, rel: string, acc: string[]): void {
  const abs = path.join(root, ...rel.split('/'))
  if (!existsSync(abs)) {
    return
  }
  const st = statSync(abs)
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (SKIP_DIR_NAMES.has(name)) {
        continue
      }
      collectGeneratedFiles(root, `${rel}/${name}`, acc)
    }
    return
  }
  acc.push(rel)
}

/** SHA-256 of every file under the declared generated paths (working tree). */
export function hashGeneratedTree(root: string, rels: readonly string[]): Map<string, string> {
  const files: string[] = []
  for (const rel of rels) {
    collectGeneratedFiles(root, rel, files)
  }
  const hashes = new Map<string, string>()
  for (const rel of files) {
    const abs = path.join(root, ...rel.split('/'))
    const digest = createHash('sha256').update(readFileSync(abs)).digest('hex')
    hashes.set(rel, digest)
  }
  return hashes
}

export function diffGeneratedHashes(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const keys = new Set([...before.keys(), ...after.keys()])
  return [...keys].filter(rel => before.get(rel) !== after.get(rel)).sort()
}

export function formatIdempotenceResult(changed: readonly string[]): CliResult {
  if (changed.length === 0) {
    return {
      exitCode: 0,
      stdout: 'Generated artifacts are up to date\n',
      stderr: '',
    }
  }
  return {
    exitCode: 1,
    stdout: `${changed.join('\n')}\n`,
    stderr:
      'solvapay-dto / generated client artifacts / binding shims are out of date — run:\n' +
      '  pnpm gen\n',
  }
}

export function runGen(options: CliOptions): CliResult {
  const before = options.check ? hashGeneratedTree(REPO_ROOT, GENERATED_PATHS) : undefined
  const gen = runDtoGen()
  if (gen.exitCode !== 0) {
    return gen
  }
  const gofmt = formatGeneratedGo()
  if (gofmt.exitCode !== 0) {
    return {
      exitCode: gofmt.exitCode,
      stdout: `${gen.stdout}${gofmt.stdout}`,
      stderr: `${gen.stderr}${gofmt.stderr}`,
    }
  }
  const types = runGenerateTypes()
  if (types.exitCode !== 0) {
    return {
      exitCode: types.exitCode,
      stdout: `${gen.stdout}${types.stdout}`,
      stderr: `${gen.stderr}${types.stderr}`,
    }
  }
  const profiles = runWasmProfiles()
  if (profiles.exitCode !== 0) {
    return {
      exitCode: profiles.exitCode,
      stdout: `${gen.stdout}${types.stdout}${profiles.stdout}`,
      stderr: `${gen.stderr}${types.stderr}${profiles.stderr}`,
    }
  }
  const coverage = runFacadeCoverage({ check: false })
  if (coverage.exitCode !== 0) {
    return {
      exitCode: coverage.exitCode,
      stdout: `${gen.stdout}${types.stdout}${profiles.stdout}${coverage.stdout}`,
      stderr: `${gen.stderr}${types.stderr}${profiles.stderr}${coverage.stderr}`,
    }
  }
  if (!options.check) {
    return {
      exitCode: 0,
      stdout: `${gen.stdout}${types.stdout}${profiles.stdout}${coverage.stdout}Generated SDK surfaces from OpenAPI snapshot + contract manifest\n`,
      stderr: `${gen.stderr}${types.stderr}${profiles.stderr}${coverage.stderr}`,
    }
  }
  const after = hashGeneratedTree(REPO_ROOT, GENERATED_PATHS)
  const drift = formatIdempotenceResult(diffGeneratedHashes(before ?? new Map(), after))
  return {
    exitCode: drift.exitCode,
    stdout: `${gen.stdout}${types.stdout}${profiles.stdout}${coverage.stdout}${drift.stdout}`,
    stderr: `${gen.stderr}${types.stderr}${profiles.stderr}${coverage.stderr}${drift.stderr}`,
  }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    return parseErrorResult(error, printUsage())
  }
  return runGen(options)
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
