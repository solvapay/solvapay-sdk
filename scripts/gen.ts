/**
 * Canonical dto-gen invocation for all five SDK surfaces.
 *
 * Modes:
 *   (default)  Regenerate Rust DTOs, TS/Python/Ruby/Go/Rust clients, binding shims.
 *   --check    Regenerate then fail if any generated path drifts from git HEAD.
 *
 * This is the single source of truth for dto-gen flags — CI and humans share it.
 *
 * Runbook: docs/contributing/sdk-codegen.md
 *   pnpm gen | pnpm gen:check | pnpm gen:all
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUST_DIR = path.join(REPO_ROOT, 'rust')

/** dto-gen argv (paths relative to `rust/`). */
export const DTO_GEN_ARGS = [
  '--snapshot',
  '../contract/openapi/sdk-v1.snapshot.json',
  '--manifest',
  '../contract/manifest/sdk-contract.yaml',
  '--out',
  'crates/solvapay-dto/src',
  '--ts-out',
  '../packages/server/src/types/overlays.generated.d.ts',
  '--ts-client-out',
  '../packages/server/src/types/client.generated.d.ts',
  '--ts-parity-out',
  '../packages/server/src/__generated__/signature-parity.generated.test.ts',
  '--dump-bindings',
  '../contract/manifest/binding-symbols.snapshot.json',
  '--node-bindings-out',
  'bindings/node/src',
  '--wasm-bindings-out',
  'bindings/wasm/src',
  '--python-bindings-out',
  'bindings/python/src',
  '--ruby-bindings-out',
  'bindings/ruby/ext/solvapay/src',
  '--native-ts-out',
  '../packages/server/src/native.ts',
  '--wasm-ts-out',
  '../packages/server/src/wasm.ts',
  '--native-py-out',
  'bindings/python/python/solvapay/_native.py',
  '--py-stub-out',
  'bindings/python/python/solvapay/__init__.pyi',
  '--py-parity-out',
  'bindings/python/tests/signature_parity_generated_test.py',
  '--native-rb-out',
  'bindings/ruby/lib/solvapay/_native.rb',
  '--rb-client-out',
  'bindings/ruby/lib/solvapay/client.rb',
  '--rb-rbs-out',
  'bindings/ruby/sig/solvapay.rbs',
  '--rb-parity-out',
  'bindings/ruby/test/signature_parity_generated_test.rb',
  '--rs-client-out',
  'crates/solvapay/src/client_generated.rs',
  '--rs-parity-out',
  'crates/solvapay/tests/signature_parity_generated.rs',
  '--go-bindings-out',
  'bindings/go/wasm/src',
  '--go-client-out',
  'bindings/go/client_generated.go',
  '--go-parity-out',
  'bindings/go/signature_parity_generated_test.go',
] as const

/** Repo-root-relative paths checked for drift after regen. */
export const GENERATED_PATHS = [
  'rust/crates/solvapay-dto',
  'packages/server/src/types/overlays.generated.d.ts',
  'packages/server/src/types/client.generated.d.ts',
  'packages/server/src/__generated__/signature-parity.generated.test.ts',
  'packages/server/src/native.ts',
  'packages/server/src/wasm.ts',
  'contract/manifest/binding-symbols.snapshot.json',
  'rust/bindings/node/src/args.rs',
  'rust/bindings/node/src/decisions.rs',
  'rust/bindings/node/src/payload_builders.rs',
  'rust/bindings/node/src/native_client.rs',
  'rust/bindings/wasm/src/args.rs',
  'rust/bindings/wasm/src/decisions.rs',
  'rust/bindings/wasm/src/payload_builders.rs',
  'rust/bindings/wasm/src/wasm_client.rs',
  'rust/bindings/python/src/args.rs',
  'rust/bindings/python/src/decisions.rs',
  'rust/bindings/python/src/payload_builders.rs',
  'rust/bindings/python/src/client.rs',
  'rust/bindings/python/src/register.rs',
  'rust/bindings/python/python/solvapay/_native.py',
  'rust/bindings/python/python/solvapay/__init__.pyi',
  'rust/bindings/python/tests/signature_parity_generated_test.py',
  'rust/bindings/ruby/ext/solvapay/src/args.rs',
  'rust/bindings/ruby/ext/solvapay/src/decisions.rs',
  'rust/bindings/ruby/ext/solvapay/src/payload_builders.rs',
  'rust/bindings/ruby/ext/solvapay/src/client.rs',
  'rust/bindings/ruby/ext/solvapay/src/register.rs',
  'rust/bindings/ruby/lib/solvapay/_native.rb',
  'rust/bindings/ruby/lib/solvapay/client.rb',
  'rust/bindings/ruby/lib/solvapay/helpers.generated.rb',
  'rust/bindings/ruby/sig/solvapay.rbs',
  'rust/bindings/ruby/test/signature_parity_generated_test.rb',
  'rust/crates/solvapay/src/client_generated.rs',
  'rust/crates/solvapay/src/blocking_generated.rs',
  'rust/crates/solvapay/tests/signature_parity_generated.rs',
  'rust/bindings/go/wasm/src/args.rs',
  'rust/bindings/go/wasm/src/client.rs',
  'rust/bindings/go/wasm/src/webhook.rs',
  'rust/bindings/go/client_generated.go',
  'rust/bindings/go/signature_parity_generated_test.go',
] as const

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
  pnpm exec tsx scripts/gen.ts [--check]
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
    cwd: RUST_DIR,
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
