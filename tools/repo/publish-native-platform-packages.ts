#!/usr/bin/env tsx
/**
 * Publish the 8 `@solvapay/server-native-*` platform packages.
 * Requires `prepare-native-publish.ts` to have stamped versions and binaries.
 * Skips a package when that exact version is already on the registry.
 */

import { execFileSync } from 'node:child_process'
import { isDirectRun } from '../codegen/lib/cli.js'
import { joinRel, lookupRel, REPO_ROOT } from '../shared/paths.js'
import {
  collectNativePlatformPublishTargets,
  npmPackageVersionExists,
} from './lib/native-platform-publish.js'

export type PublishNativePlatformOptions = {
  repoRoot: string
  registry: string
  dryRun: boolean
  versionExists?: (packageName: string, version: string) => Promise<boolean>
  publish?: (input: { cwd: string; packageName: string; npmArgs: string[] }) => void
}

export async function publishNativePlatformPackages(
  options: PublishNativePlatformOptions,
): Promise<{ published: string[]; skipped: string[] }> {
  const targets = collectNativePlatformPublishTargets(options.repoRoot)
  const npmRel = lookupRel('nodeNativeNpm')
  const published: string[] = []
  const skipped: string[] = []
  const versionExists =
    options.versionExists ??
    ((name, version) => npmPackageVersionExists(name, version, { registry: options.registry }))
  const publish =
    options.publish ??
    ((input: { cwd: string; npmArgs: string[] }) => {
      execFileSync('npm', input.npmArgs, { cwd: input.cwd, stdio: 'inherit' })
    })

  for (const target of targets) {
    if (await versionExists(target.name, target.version)) {
      console.log(`skip ${target.name}@${target.version} (already on npm)`)
      skipped.push(target.name)
      continue
    }
    const cwd = joinRel(options.repoRoot, npmRel, target.dir)
    const npmArgs = ['publish', '--access', 'public', '--registry', options.registry]
    if (options.dryRun) npmArgs.push('--dry-run')
    console.log(`npm ${npmArgs.join(' ')} (${target.name})`)
    publish({ cwd, packageName: target.name, npmArgs })
    published.push(target.name)
  }

  return { published, skipped }
}

async function main(): Promise<void> {
  const registry = process.argv.includes('--registry')
    ? process.argv[process.argv.indexOf('--registry') + 1]
    : 'https://registry.npmjs.org/'
  if (!registry) {
    throw new Error('publish-native-platform-packages: --registry requires a URL')
  }
  const dryRun = process.argv.includes('--dry-run')
  await publishNativePlatformPackages({
    repoRoot: REPO_ROOT,
    registry,
    dryRun,
  })
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void main()
}
