/**
 * Aggregate builder: core tier by default, `--native` adds bindings.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSelectFlags, selectBuildTasks } from '../shared/surfaces.js'
import { renderRun, runTasks, type RunnerDeps } from '../shared/task-runner.js'

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

function printUsage(): string {
  return `Usage:
  pnpm build:all [--native | --native-only] [--only <surface>] [--json] [--bail]
`
}

export async function runCli(argv: string[], deps?: Partial<RunnerDeps>): Promise<CliResult> {
  const selected = selectBuildTasks(argv)
  if ('error' in selected) {
    return { exitCode: 1, stdout: '', stderr: `${selected.error}\n${printUsage()}` }
  }
  const flags = parseSelectFlags(argv.filter(arg => arg === '--json' || arg === '--bail'))
  const summary = await runTasks(
    selected,
    { command: 'build:all', json: flags.json, bail: flags.bail },
    deps,
  )
  const rendered = renderRun(summary, flags.json)
  return { exitCode: summary.exitCode, stdout: rendered.stdout, stderr: rendered.stderr }
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
