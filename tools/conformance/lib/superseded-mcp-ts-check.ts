/**
 * Negative grep gate: `@solvapay/mcp-core` and `@solvapay/mcp` must not
 * reimplement Rust MCP semantics (narrators, builtin handlers, tsFallback).
 */

import { tsPackageRel } from '../../shared/paths.js'
import {
  SHARED_MCP_CONTENT_RULES,
  collectSupersededIssues,
  formatSupersededReport,
  type ContentRule,
  type SupersededIssue,
} from './superseded-common.js'

export type McpSupersededIssue = SupersededIssue

const PACKAGES = ['mcp-core', 'mcp'] as const

const FORBIDDEN_FILES = [
  'narrate-local.ts',
  'builtin-handlers.ts',
  'dispatch-builtin.ts',
  'bootstrap-payload.ts',
] as const

const CONTENT_RULES: readonly ContentRule[] = [
  {
    token: 'tsFallback',
    pattern: /\btsFallback\b/,
    remediation:
      'Remove tsFallback from MCP dispatch; fail fast when the Rust/WASM API is unavailable.',
  },
  ...SHARED_MCP_CONTENT_RULES,
  {
    token: 'host OAuth path helper',
    pattern: /value\.replace\(\/\\\/\$\//,
    remediation: 'Call mcpOauthPath; do not reimplement slash helpers in TypeScript.',
  },
]

export function runMcpSupersededTsCheck(repoRoot: string): McpSupersededIssue[] {
  return collectSupersededIssues({
    repoRoot,
    srcRels: PACKAGES.map(pkg => `${tsPackageRel(pkg)}/src`),
    forbiddenFiles: FORBIDDEN_FILES,
    contentRules: CONTENT_RULES,
    extensions: ['.ts'],
    skipDirNames: ['__tests__', '__generated__'],
    skipFile: name =>
      name.endsWith('.d.ts') || name.endsWith('.test.ts') || name.endsWith('.spec.ts'),
    missingRootRemediation: 'Expected MCP src directory to exist for the superseded-MCP scan.',
  })
}

export function formatMcpSupersededReport(issues: readonly McpSupersededIssue[]): string {
  return formatSupersededReport(
    'mcp-superseded-ts:check',
    issues,
    'Duplicate MCP TypeScript implementations must be removed.\nDelegation proves routing; this gate proves host copies are absent.',
  )
}
