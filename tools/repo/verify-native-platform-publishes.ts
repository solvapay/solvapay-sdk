#!/usr/bin/env tsx
/**
 * Gate B — every `@solvapay/server-native-*` platform package must be
 * fetchable at the loader version before changesets publishes the loader.
 *
 * Usage: tsx tools/repo/verify-native-platform-publishes.ts
 */

import { isDirectRun, runScriptMain, type CliResult } from '../codegen/lib/cli.js'
import { REPO_ROOT } from '../shared/paths.js'
import {
  collectNativePlatformPublishTargets,
  probeNpmPackageVersion,
  verifyNativePlatformPublishes,
} from './lib/native-platform-publish.js'

export async function runVerifyNativePlatformPublishes(
  repoRoot: string,
  registry?: string,
): Promise<CliResult> {
  const packages = collectNativePlatformPublishTargets(repoRoot)
  const { missing } = await verifyNativePlatformPublishes({
    packages,
    probe: (name, version) => probeNpmPackageVersion(name, version, { registry }),
  })
  if (missing.length > 0) {
    const lines = missing.map(pkg => `  - ${pkg.name}@${pkg.version}`)
    return {
      exitCode: 1,
      stdout: '',
      stderr: `native platform publish verification failed:\n${lines.join('\n')}\n`,
    }
  }
  return {
    exitCode: 0,
    stdout: `All ${packages.length} native platform package(s) verified on npm.\n`,
    stderr: '',
  }
}

async function runCli(argv: string[]): Promise<CliResult> {
  const registryFlag = argv.indexOf('--registry')
  const registry = registryFlag === -1 ? undefined : argv[registryFlag + 1]
  return runVerifyNativePlatformPublishes(REPO_ROOT, registry)
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
