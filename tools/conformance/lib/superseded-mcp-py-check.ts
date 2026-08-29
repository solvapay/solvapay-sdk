/**
 * Negative grep gate: Python MCP must not reimplement Rust MCP semantics.
 */

import {
  SHARED_MCP_CONTENT_RULES,
  collectSupersededIssues,
  formatSupersededReport,
  type ContentRule,
  type SupersededIssue,
} from './superseded-common.js'

export type McpPySupersededIssue = SupersededIssue

const PYTHON_ROOT = 'sdks/python-mcp/python/solvapay_mcp'

const FORBIDDEN_FILES = [
  'server/narrate_local.py',
  'server/builtin_handlers.py',
  'server/dispatch_builtin.py',
  'server/bootstrap.py',
  'server/descriptors.py',
] as const

const CONTENT_RULES: readonly ContentRule[] = [
  {
    token: '_plans_list_lines',
    pattern: /\b_plans_list_lines\b/,
    remediation: 'Delete host-local plan formatters; call mcpNarrate.',
  },
  ...SHARED_MCP_CONTENT_RULES,
  {
    token: 'native_available skip',
    pattern: /pytest\.skip.*native_available|native_available\(\).*skip/i,
    remediation: 'Do not skip when the native binding is missing; fail loudly.',
  },
  {
    token: 'host OAuth path helper',
    pattern: /value\[:-1\] if value\.endswith\("\/"\)/,
    remediation: 'Call mcpOauthPath; do not reimplement slash helpers in Python.',
  },
]

export function runMcpSupersededPyCheck(repoRoot: string): McpPySupersededIssue[] {
  return collectSupersededIssues({
    repoRoot,
    srcRels: [PYTHON_ROOT],
    forbiddenFiles: FORBIDDEN_FILES,
    contentRules: CONTENT_RULES,
    extensions: ['.py'],
    skipDirNames: ['__pycache__'],
    missingRootRemediation: 'Expected the Python MCP package to exist for the superseded scan.',
  })
}

export function formatMcpPySupersededReport(issues: readonly McpPySupersededIssue[]): string {
  return formatSupersededReport(
    'mcp-superseded-py:check',
    issues,
    'Duplicate Python MCP implementations must be removed.',
  )
}
