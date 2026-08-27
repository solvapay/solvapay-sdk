/**
 * Layer-3 MCP adapter line-budget gate.
 *
 * Usage: pnpm mcp-layer3-budget:check
 */

import { formatLayer3BudgetReport, runLayer3BudgetCheck } from './lib/mcp-layer3-budget.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runLayer3BudgetCheck(REPO_ROOT)
const report = formatLayer3BudgetReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
