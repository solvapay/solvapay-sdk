#!/usr/bin/env tsx
/**
 * CLI: required-checks drift gate (Step 55-b).
 *
 * Usage: pnpm checks:required
 *        tsx scripts/check-required-checks.ts
 */

import { formatRequiredChecksReport, runRequiredChecks } from './lib/required-checks.js'
import { REPO_ROOT } from '../shared/paths.js'
const issues = runRequiredChecks(REPO_ROOT)
const report = formatRequiredChecksReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
