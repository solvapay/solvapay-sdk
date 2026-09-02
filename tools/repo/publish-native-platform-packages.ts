#!/usr/bin/env tsx
/**
 * Publish the 8 `@solvapay/server-native-*` platform packages.
 * Requires `prepare-native-publish.ts` to have stamped versions and binaries.
 */

import { execFileSync } from 'node:child_process'
import { joinRel, lookupRel, REPO_ROOT } from '../shared/paths.js'
import { loadSupportMatrix } from './lib/support-matrix.js'

const registry = process.argv.includes('--registry')
  ? process.argv[process.argv.indexOf('--registry') + 1]
  : 'https://registry.npmjs.org/'

const dryRun = process.argv.includes('--dry-run')
const matrix = loadSupportMatrix(REPO_ROOT)

for (const target of matrix.nodeNative.targets) {
  const cwd = joinRel(REPO_ROOT, lookupRel('nodeNativeNpm'), target.dir)
  const args = ['publish', '--access', 'public', '--registry', registry]
  if (dryRun) args.push('--dry-run')
  console.log(`npm ${args.join(' ')} (${target.packageName})`)
  execFileSync('npm', args, { cwd, stdio: 'inherit' })
}
