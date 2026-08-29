/**
 * Negative grep gate: Rust MCP host crate must not reimplement Rust MCP semantics.
 */

import {
  SHARED_MCP_CONTENT_RULES,
  collectSupersededIssues,
  formatSupersededReport,
  type ContentRule,
  type SupersededIssue,
} from './superseded-common.js'

export type McpRsSupersededIssue = SupersededIssue

const SRC_ROOT = 'sdks/rust-mcp/src'

const FORBIDDEN_FILES = ['narrate_local.rs', 'oauth_routes.rs'] as const

const CONTENT_RULES: readonly ContentRule[] = [
  ...SHARED_MCP_CONTENT_RULES,
  {
    token: 'host OAuth path helper',
    pattern: /\.strip_suffix\('\/'\)/,
    remediation: 'Call mcpOauthPath; do not reimplement slash helpers in the Rust MCP host.',
  },
]

export function runMcpSupersededRsCheck(repoRoot: string): McpRsSupersededIssue[] {
  return collectSupersededIssues({
    repoRoot,
    srcRels: [SRC_ROOT],
    forbiddenFiles: FORBIDDEN_FILES,
    contentRules: CONTENT_RULES,
    extensions: ['.rs'],
    missingRootRemediation: 'Expected the Rust MCP crate to exist for the superseded scan.',
  })
}

export function formatMcpRsSupersededReport(issues: readonly McpRsSupersededIssue[]): string {
  return formatSupersededReport(
    'mcp-superseded-rs:check',
    issues,
    'Duplicate Rust MCP host implementations must be removed.',
  )
}
