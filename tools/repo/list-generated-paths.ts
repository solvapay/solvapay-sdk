/**
 * Print `generatedDriftPaths()` one per line for husky restage.
 *
 *   pnpm -s exec tsx tools/repo/list-generated-paths.ts
 */

import { existsSync } from 'node:fs'
import { isDirectRun, runScriptMain, type CliResult } from '../codegen/lib/cli.js'
import { joinRoot } from '../shared/paths.js'
import { generatedDriftPaths } from '../shared/repo-paths.js'

export function runCli(_argv: string[] = []): CliResult {
  const rels = generatedDriftPaths().filter(rel => existsSync(joinRoot(rel)))
  return {
    exitCode: 0,
    stdout: `${rels.join('\n')}\n`,
    stderr: '',
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(async () => runCli())
}
