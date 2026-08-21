#!/usr/bin/env tsx
/**
 * CLI: release dry-run gate (Step 55-c).
 *
 * Usage: pnpm checks:release-dryrun
 *        tsx scripts/check-release-dryrun.ts
 *        tsx scripts/check-release-dryrun.ts --stable-versions-only
 */

import {
  formatReleaseDryrunReport,
  formatStableVersionFailure,
  runReleaseDryrunCheck,
} from './lib/release-dryrun.js'
import { REPO_ROOT } from '../shared/paths.js'

const stableOnly = process.argv.includes('--stable-versions-only')
const issues = runReleaseDryrunCheck(REPO_ROOT)
const filtered = stableOnly ? issues.filter(i => i.kind === 'prerelease-version') : issues

if (filtered.length > 0) {
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
