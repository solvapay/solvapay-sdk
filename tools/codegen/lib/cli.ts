/**
 * Shared CLI shell for codegen TypeScript scripts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function formatZodIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): string {
  return error.issues
    .map(issue => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  - ${pathLabel}: ${issue.message}`
    })
    .join('\n')
}

export function parseErrorResult(error: unknown, usage: string): CliResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    exitCode: 1,
    stdout: '',
    stderr: `${message}\n${usage}`,
  }
}

export async function runScriptMain(runCli: (argv: string[]) => Promise<CliResult>): Promise<void> {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  process.exit(result.exitCode)
}

export function isDirectRun(metaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && path.resolve(argv1) === fileURLToPath(metaUrl)
}
