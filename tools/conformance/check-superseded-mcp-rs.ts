/**
 * Grep gate: Rust MCP host must not reimplement core MCP semantics.
 *
 * Usage: pnpm mcp-superseded-rs:check
 */

import {
  formatMcpRsSupersededReport,
  runMcpSupersededRsCheck,
} from './lib/superseded-mcp-rs-check.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runMcpSupersededRsCheck(REPO_ROOT)
const report = formatMcpRsSupersededReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
