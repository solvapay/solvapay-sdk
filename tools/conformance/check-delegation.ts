#!/usr/bin/env tsx
/**
 * CLI: node-binding-delegation grep gate (Step 37R-e).
 *
 * Usage: pnpm delegation:check
 *        tsx scripts/check-delegation.ts
 */

import { formatDelegationReport, runDelegationCheck } from './lib/delegation-check.js'
import { REPO_ROOT } from '../shared/paths.js'
import { lookupPath } from '../shared/repo-paths.js'

const allowlistPath = lookupPath('delegationAllowlist')

const issues = runDelegationCheck(REPO_ROOT, allowlistPath)
const report = formatDelegationReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
