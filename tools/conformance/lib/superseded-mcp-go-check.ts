/**
 * Negative grep gate: Go MCP must not reimplement Rust MCP semantics.
 */

import {
  SHARED_MCP_CONTENT_RULES,
  collectSupersededIssues,
  formatSupersededReport,
  type ContentRule,
  type SupersededIssue,
} from './superseded-common.js'

export type McpGoSupersededIssue = SupersededIssue

const SRC_ROOT = 'sdks/go/mcp'

const FORBIDDEN_FILES = ['narrate_local.go', 'oauth_routes.go'] as const

const CONTENT_RULES: readonly ContentRule[] = [
  ...SHARED_MCP_CONTENT_RULES,
  {
    token: 'host OAuth path helper',
    pattern: /strings\.TrimSuffix\(\w+, "\/"\)/,
    remediation: 'Call mcpOauthPath; do not reimplement slash helpers in Go.',
  },
]

export function runMcpSupersededGoCheck(repoRoot: string): McpGoSupersededIssue[] {
  return collectSupersededIssues({
    repoRoot,
    srcRels: [SRC_ROOT],
    forbiddenFiles: FORBIDDEN_FILES,
    contentRules: CONTENT_RULES,
    extensions: ['.go'],
    skipDirNames: [],
    skipFile: name => name.endsWith('_test.go'),
    missingRootRemediation: 'Expected the Go MCP package to exist for the superseded scan.',
  })
}

export function formatMcpGoSupersededReport(issues: readonly McpGoSupersededIssue[]): string {
  return formatSupersededReport(
    'mcp-superseded-go:check',
    issues,
    'Duplicate Go MCP implementations must be removed.',
  )
}
