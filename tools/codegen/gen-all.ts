/**
 * Full local codegen pipeline:
 *   1. Refresh OpenAPI snapshot when the local five-service stack is reachable
 *   2. Regenerate all surfaces (`pnpm gen`)
 *   3. Run `manifest:check` + `parity:check`
 *
 * Runbook: docs/contributing/sdk-codegen.md
 */

import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from '../shared/paths.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'
import { loadLocalStack } from './snapshot-openapi.js'

const STACK_ORIGIN = 'http://localhost'

export interface AllCliDeps {
  liveStack?: () => Promise<boolean>
  run?: (command: string, args: string[]) => number
}

function defaultRun(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  return result.status ?? 1
}

export async function liveStackAvailable(): Promise<boolean> {
  for (const service of loadLocalStack()) {
    const url = `${STACK_ORIGIN}:${service.port}/v1/openapi.json`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (!response.ok) {
        return false
      }
    } catch {
      return false
    }
  }
  return true
}

export async function runCli(_argv: string[] = [], deps: AllCliDeps = {}): Promise<CliResult> {
  const lines: string[] = []
  const run = deps.run ?? defaultRun
  const stackUp = await (deps.liveStack ?? liveStackAvailable)()
  if (stackUp) {
    lines.push(`Live OpenAPI stack at ${STACK_ORIGIN} — refreshing snapshot via --from-stack…`)
    const snapshotCode = run('pnpm', ['snapshot:openapi', '--from-stack', STACK_ORIGIN])
    if (snapshotCode !== 0) {
      return {
        exitCode: snapshotCode,
        stdout: `${lines.join('\n')}\n`,
        stderr: `snapshot:openapi exited ${snapshotCode}\n`,
      }
    }
  } else {
    lines.push(`No live OpenAPI stack at ${STACK_ORIGIN} — using committed OpenAPI snapshot`)
  }

  for (const args of [['gen'], ['manifest:check'], ['parity:check']] as const) {
    const code = run('pnpm', [...args])
    if (code !== 0) {
      return {
        exitCode: code,
        stdout: `${lines.join('\n')}\n`,
        stderr: `pnpm ${args[0]} exited ${code}\n`,
      }
    }
  }
  lines.push('gen:all complete')
  return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
}

export async function runCliEntry(argv: string[]): Promise<CliResult> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return parseErrorResult(new Error('Usage: pnpm gen:all'), '')
  }
  if (argv.length > 0) {
    return parseErrorResult(new Error(`Unknown argument: ${argv[0]}`), 'Usage: pnpm gen:all\n')
  }
  return runCli()
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCliEntry)
}
