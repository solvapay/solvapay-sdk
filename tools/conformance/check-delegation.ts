#!/usr/bin/env tsx
/**
 * CLI: node-binding-delegation grep gate (Step 37R-e).
 *
 * Usage: pnpm delegation:check
 *        tsx scripts/check-delegation.ts
 */

import { formatDelegationReport, runDelegationCheck } from './lib/delegation-check.js'
import { checkFacadeDecisionDenylist } from './lib/facade-decision-denylist.js'
import { REPO_ROOT } from '../shared/paths.js'
import { lookupPath } from '../shared/repo-paths.js'

const allowlistPath = lookupPath('delegationAllowlist')

const issues = runDelegationCheck(REPO_ROOT, allowlistPath)
const denylist = checkFacadeDecisionDenylist()
const report = formatDelegationReport(issues)
if (issues.length > 0 || denylist.length > 0) {
  if (issues.length > 0) console.error(report)
  if (denylist.length > 0) {
    console.error(`facade-decision-denylist: ${denylist.length} issue(s)`)
    for (const item of denylist) console.error(`  ${item}`)
  }
  process.exit(1)
}
console.log(report)
if (denylist.length === 0) console.log('facade-decision-denylist: OK')
