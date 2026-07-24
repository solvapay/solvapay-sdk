#!/usr/bin/env tsx
/**
 * CLI: Step 53 superseded TypeScript semantic gate for `@solvapay/server`.
 *
 * Usage: pnpm server-superseded-ts:check
 *        tsx scripts/check-superseded-server-ts.ts
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatSupersededReport,
  runSupersededServerTsCheck,
} from './lib/superseded-server-ts-check.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const issues = runSupersededServerTsCheck(repoRoot)
const report = formatSupersededReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
