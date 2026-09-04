/**
 * Aggregate builder: core tier by default, `--native` adds bindings.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSelectFlags, selectBuildTasks } from '../shared/surfaces.js'
import { renderRun, runTasks, type RunnerDeps } from '../shared/task-runner.js'
import { nativeOnlyBlobWarning, type BlobWarningDeps } from './lib/external-blob-warning.js'

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

export async function runCli(
  argv: string[],
  deps?: Partial<RunnerDeps> & BlobWarningDeps & { skipBlobWarning?: boolean },
): Promise<CliResult> {
  const selected = selectBuildTasks(argv)
  if ('error' in selected) {
    return { exitCode: 1, stdout: '', stderr: `${selected.error}\n${printUsage()}` }
  }
  const flags = parseSelectFlags(argv.filter(arg => arg === '--json' || arg === '--bail'))
  const { skipBlobWarning, digest, registryText, manifest, root, stagedPaths, ...runnerDeps } =
    deps ?? {}
  const summary = await runTasks(
    selected,
    { command: 'build:all', json: flags.json, bail: flags.bail },
    runnerDeps,
  )
  const rendered = renderRun(summary, flags.json)
  let stderr = rendered.stderr
  if (!skipBlobWarning && summary.exitCode === 0) {
    const warning = nativeOnlyBlobWarning(argv, {
      digest,
      registryText,
      manifest,
      root,
      stagedPaths,
    })
    if (warning !== undefined) {
      stderr =
        stderr.length > 0 && !stderr.endsWith('\n')
          ? `${stderr}\n${warning}\n`
          : `${stderr}${warning}\n`
    }
  }
  return { exitCode: summary.exitCode, stdout: rendered.stdout, stderr }
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
