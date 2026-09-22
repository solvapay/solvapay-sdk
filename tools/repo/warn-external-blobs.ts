/**
 * Print a warning when staged (or current) external blobs drifted from the
 * committed sha256 registry. Always exits 0 — this is a footgun guard, not a gate.
 *
 *   pnpm -s exec tsx tools/repo/warn-external-blobs.ts --staged
 */

import { isDirectRun, runScriptMain, type CliResult } from '../codegen/lib/cli.js'
import { nativeOnlyBlobWarning, warnStagedExternalBlobs } from './lib/external-blob-warning.js'

export function runCli(argv: string[]): CliResult {
  const warning = argv.includes('--staged')
    ? warnStagedExternalBlobs()
    : nativeOnlyBlobWarning(['--native-only'])
  if (warning === undefined) {
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  return { exitCode: 0, stdout: '', stderr: `${warning}\n` }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(async args => runCli(args))
}
