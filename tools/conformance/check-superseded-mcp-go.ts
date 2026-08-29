/**
 * Grep gate: Go MCP must not reimplement Rust MCP semantics.
 *
 * Usage: pnpm mcp-superseded-go:check
 */

import {
  formatMcpGoSupersededReport,
  runMcpSupersededGoCheck,
} from './lib/superseded-mcp-go-check.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runMcpSupersededGoCheck(REPO_ROOT)
const report = formatMcpGoSupersededReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
