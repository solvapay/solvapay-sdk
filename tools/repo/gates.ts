/**
 * Canonical local contract gate set.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderRun, runTasks, type RunnerDeps, type Task } from '../shared/task-runner.js'
import { REPO_ROOT } from '../shared/paths.js'

export const GATE_SCRIPTS = [
  'gen:check',
  'manifest:check',
  'parity:check',
  'test:fixtures',
  'snapshot:openapi:check',
  'docs:coverage',
  'delegation:check',
  'checks:required',
] as const

export function gateTasks(): Task[] {
  return GATE_SCRIPTS.map(script => ({
    id: script.replaceAll(':', '.'),
    label: script,
    command: 'pnpm',
    args: [script],
    cwd: REPO_ROOT,
  }))
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function runCli(argv: string[], deps?: Partial<RunnerDeps>): Promise<CliResult> {
  const json = argv.includes('--json')
  const bail = argv.includes('--bail')
  const summary = await runTasks(gateTasks(), { command: 'gates', json, bail }, deps)
  const rendered = renderRun(summary, json)
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
