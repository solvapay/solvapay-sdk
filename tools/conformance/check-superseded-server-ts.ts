#!/usr/bin/env tsx
/**
 * CLI: Step 53 superseded TypeScript semantic gate for `@solvapay/server`.
 *
 * Usage: pnpm server-superseded-ts:check
 *        tsx scripts/check-superseded-server-ts.ts
 */

import {
  formatSupersededReport,
  runSupersededServerTsCheck,
} from './lib/superseded-server-ts-check.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runSupersededServerTsCheck(REPO_ROOT)
const report = formatSupersededReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
