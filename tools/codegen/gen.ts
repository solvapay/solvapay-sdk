/**
 * Canonical dto-gen invocation for all five SDK surfaces.
 *
 * Modes:
 *   (default)  Regenerate Rust DTOs, TS/Python/Ruby/Go/Rust clients, binding shims.
 *   --check    Regenerate then fail if any generated path drifts from git HEAD.
 *
 * This is the single source of truth for dto-gen flags — CI and humans share it.
 * Flags and drift paths are derived from `contract/manifest/repo-paths.yaml`.
 *
 * Runbook: docs/contributing/sdk-codegen.md
 *   pnpm gen | pnpm gen:check | pnpm gen:all
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT } from '../shared/paths.js'
import { dtoGenArgs, generatedDriftPaths } from '../shared/repo-paths.js'

/** dto-gen argv (paths relative to the repo root). Derived from repo-paths.yaml. */
export const DTO_GEN_ARGS = dtoGenArgs()

/** Repo-root-relative paths checked for drift after regen. */
export const GENERATED_PATHS = generatedDriftPaths()

export interface CliOptions {
  check: boolean
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
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

function checkDrift(): CliResult {
  const result = spawnSync('git', ['diff', '--exit-code', '--', ...GENERATED_PATHS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Failed to run git diff: ${result.error.message}\n`,
    }
  }
  if (result.status === 0) {
    return {
      exitCode: 0,
      stdout: 'Generated artifacts are up to date\n',
      stderr: '',
    }
  }
  return {
    exitCode: 1,
    stdout: result.stdout ?? '',
    stderr:
      'solvapay-dto / generated client artifacts / binding shims are out of date — run:\n' +
      '  pnpm gen\n',
  }
}

export function runGen(options: CliOptions): CliResult {
  const gen = runDtoGen()
  if (gen.exitCode !== 0) {
    return gen
  }
  if (!options.check) {
    return {
      exitCode: 0,
      stdout: `${gen.stdout}Generated SDK surfaces from OpenAPI snapshot + contract manifest\n`,
      stderr: gen.stderr,
    }
  }
  const drift = checkDrift()
  return {
    exitCode: drift.exitCode,
    stdout: `${gen.stdout}${drift.stdout}`,
    stderr: `${gen.stderr}${drift.stderr}`,
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
  return runGen(options)
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
