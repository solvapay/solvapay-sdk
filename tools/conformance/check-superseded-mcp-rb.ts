/**
 * Grep gate: Ruby MCP must not reimplement Rust MCP semantics.
 *
 * Usage: pnpm mcp-superseded-rb:check
 */

import {
  formatMcpRbSupersededReport,
  runMcpSupersededRbCheck,
} from './lib/superseded-mcp-rb-check.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runMcpSupersededRbCheck(REPO_ROOT)
const report = formatMcpRbSupersededReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
