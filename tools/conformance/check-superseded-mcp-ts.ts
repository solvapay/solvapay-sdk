/**
 * Grep gate: MCP TypeScript must not reimplement Rust MCP semantics.
 *
 * Usage: pnpm mcp-superseded-ts:check
 */

import { formatMcpSupersededReport, runMcpSupersededTsCheck } from './lib/superseded-mcp-ts-check.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runMcpSupersededTsCheck(REPO_ROOT)
const report = formatMcpSupersededReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
