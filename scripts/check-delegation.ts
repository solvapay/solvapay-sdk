#!/usr/bin/env tsx
/**
 * CLI: node-binding-delegation grep gate (Step 37R-e).
 *
 * Usage: pnpm delegation:check
 *        tsx scripts/check-delegation.ts
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatDelegationReport, runDelegationCheck } from './lib/delegation-check.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowlistPath = path.join(repoRoot, 'contract/delegation-allowlist.json')

const issues = runDelegationCheck(repoRoot, allowlistPath)
const report = formatDelegationReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
