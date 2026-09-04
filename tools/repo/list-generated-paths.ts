/**
 * Print `generatedDriftPaths()` one per line for husky restage.
 *
 *   pnpm -s exec tsx tools/repo/list-generated-paths.ts
 */

import { isDirectRun, runScriptMain, type CliResult } from '../codegen/lib/cli.js'
import { generatedDriftPaths } from '../shared/repo-paths.js'

export function runCli(_argv: string[] = []): CliResult {
  return {
    exitCode: 0,
    stdout: `${generatedDriftPaths().join('\n')}\n`,
    stderr: '',
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(async () => runCli())
}
