/**
 * Negative grep gate: Ruby MCP must not reimplement Rust MCP semantics.
 */

import {
  SHARED_MCP_CONTENT_RULES,
  collectSupersededIssues,
  formatSupersededReport,
  type ContentRule,
  type SupersededIssue,
} from './superseded-common.js'

export type McpRbSupersededIssue = SupersededIssue

const SRC_ROOT = 'sdks/ruby-mcp/lib/solvapay/mcp'

const FORBIDDEN_FILES = ['narrate_local.rb', 'oauth_routes.rb'] as const

const CONTENT_RULES: readonly ContentRule[] = [
  ...SHARED_MCP_CONTENT_RULES,
  {
    token: 'host OAuth path helper',
    pattern: /\.chomp\("\/"\)|sub\(\/\\\/\$\//,
    remediation: 'Call mcpOauthPath; do not reimplement slash helpers in Ruby.',
  },
]

export function runMcpSupersededRbCheck(repoRoot: string): McpRbSupersededIssue[] {
  return collectSupersededIssues({
    repoRoot,
    srcRels: [SRC_ROOT],
    forbiddenFiles: FORBIDDEN_FILES,
    contentRules: CONTENT_RULES,
    extensions: ['.rb'],
    missingRootRemediation: 'Expected the Ruby MCP package to exist for the superseded scan.',
  })
}

export function formatMcpRbSupersededReport(issues: readonly McpRbSupersededIssue[]): string {
  return formatSupersededReport(
    'mcp-superseded-rb:check',
    issues,
    'Duplicate Ruby MCP implementations must be removed.',
  )
}
