/**
 * Grep gate: Python MCP must not reimplement Rust MCP semantics.
 *
 * Usage: pnpm mcp-superseded-py:check
 */

import {
  formatMcpPySupersededReport,
  runMcpSupersededPyCheck,
} from './lib/superseded-mcp-py-check.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runMcpSupersededPyCheck(REPO_ROOT)
const report = formatMcpPySupersededReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
