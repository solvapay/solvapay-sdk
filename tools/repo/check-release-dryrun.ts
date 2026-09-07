#!/usr/bin/env tsx
/**
 * CLI: release dry-run gate (Step 55-c).
 *
 * Usage: pnpm checks:release-dryrun
 *        tsx tools/repo/check-release-dryrun.ts
 *        tsx tools/repo/check-release-dryrun.ts --stable-versions-only
 *        tsx tools/repo/check-release-dryrun.ts --registry
 *        tsx tools/repo/check-release-dryrun.ts --assert-no-local-paths
 *
 * `--assert-no-local-paths` is the publish-time Gate A: it only fails on
 * `local-path-dep` so a preview snapshot's pre-release versions do not
 * trip the same command.
 */

import {
  failingReleaseDryrunIssues,
  formatReleaseDryrunReport,
  formatStableVersionFailure,
  npmRegistryProbe,
  runReleaseDryrunCheck,
} from './lib/release-dryrun.js'
import { REPO_ROOT } from '../shared/paths.js'

async function main(): Promise<void> {
  const stableOnly = process.argv.includes('--stable-versions-only')
  const useRegistry = process.argv.includes('--registry')
  const assertNoLocalPaths = process.argv.includes('--assert-no-local-paths')
  const issues = await runReleaseDryrunCheck(
    REPO_ROOT,
    useRegistry ? npmRegistryProbe() : undefined,
    { assertNoLocalPaths },
  )
  const filtered = stableOnly
    ? issues.filter(i => i.kind === 'prerelease-version')
    : assertNoLocalPaths
      ? issues.filter(i => i.kind === 'local-path-dep')
      : issues
  const failing = failingReleaseDryrunIssues(filtered)

  if (failing.length > 0) {
    if (stableOnly) {
      console.error(formatStableVersionFailure(filtered))
    } else {
      console.error(formatReleaseDryrunReport(filtered))
    }
    process.exit(1)
  }

  if (stableOnly) {
    console.log('All publishable workspace packages have stable versions.')
    process.exit(0)
  }

  console.log(formatReleaseDryrunReport(filtered))
}

void main()
