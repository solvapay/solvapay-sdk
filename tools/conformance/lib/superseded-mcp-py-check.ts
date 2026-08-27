/**
 * Negative grep gate: Python MCP must not reimplement Rust MCP semantics.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { joinRel } from '../../shared/paths.js'

export type McpPySupersededIssue = {
  file: string
  token: string
  remediation: string
  line?: number
}

const PYTHON_ROOT = 'sdks/python-mcp/python/solvapay_mcp'

const FORBIDDEN_FILES = [
  'server/narrate_local.py',
  'server/builtin_handlers.py',
  'server/dispatch_builtin.py',
  'server/bootstrap.py',
  'server/descriptors.py',
] as const

type ContentRule = {
  token: string
  pattern: RegExp
  remediation: string
}

const CONTENT_RULES: readonly ContentRule[] = [
  {
    token: '_plans_list_lines',
    pattern: /\b_plans_list_lines\b/,
    remediation: 'Delete host-local plan formatters; call mcpNarrate.',
  },
  {
    token: 'local narrator markdown',
    pattern: /\*\*Welcome to |Opened \{p\} top-up|Plans available:/,
    remediation: 'Do not author narrator markdown in Python; call mcpNarrate.',
  },
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
  {
    token: 'host OAuth error inspect',
    pattern: /touches\(["']grant_type["']\)/,
    remediation: 'Call mcpOauthErrorInspect; do not reimplement OAuth error mapping in Python.',
  },
  {
    token: 'local OAuth route table',
    pattern: /\/v1\/customer\/auth\/token|\/v1\/customer\/auth\/register/,
    remediation: 'Call mcpOauthRequest; do not reimplement the OAuth proxy route table in Python.',
  },
  {
    token: 'overview markdown',
    pattern: /# SolvaPay MCP server — overview/,
    remediation: 'Call mcpOverviewResource; do not vendor overview markdown in Python.',
  },
]

function walkPyFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === '__pycache__') continue
      out.push(...walkPyFiles(full))
      continue
    }
    if (name.endsWith('.py')) out.push(full)
  }
  return out
}

function firstMatchLine(source: string, pattern: RegExp): number | undefined {
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i] ?? '')) return i + 1
  }
  return undefined
}

export function runMcpSupersededPyCheck(repoRoot: string): McpPySupersededIssue[] {
  const srcRoot = joinRel(repoRoot, PYTHON_ROOT)
  const issues: McpPySupersededIssue[] = []

  for (const rel of FORBIDDEN_FILES) {
    const full = path.join(srcRoot, rel)
    if (existsSync(full)) {
      issues.push({
        file: path.relative(repoRoot, full),
        token: path.basename(rel),
        remediation: `Delete ${rel}; MCP semantics live in Rust.`,
      })
    }
  }

  if (!existsSync(srcRoot)) {
    issues.push({
      file: path.relative(repoRoot, srcRoot),
      token: PYTHON_ROOT,
      remediation: 'Expected the Python MCP package to exist for the superseded scan.',
    })
    return issues
  }

  for (const file of walkPyFiles(srcRoot)) {
    const rel = path.relative(repoRoot, file)
    const source = readFileSync(file, 'utf8')
    for (const rule of CONTENT_RULES) {
      if (!rule.pattern.test(source)) continue
      rule.pattern.lastIndex = 0
      issues.push({
        file: rel,
        token: rule.token,
        remediation: rule.remediation,
        line: firstMatchLine(source, rule.pattern),
      })
    }
  }

  return issues
}

export function formatMcpPySupersededReport(issues: readonly McpPySupersededIssue[]): string {
  if (issues.length === 0) {
    return 'mcp-superseded-py:check: OK'
  }
  const lines = [
    `mcp-superseded-py:check: FAILED (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
    '',
    'Duplicate Python MCP implementations must be removed.',
    '',
  ]
  for (const issue of issues) {
    const loc = issue.line !== undefined ? `${issue.file}:${issue.line}` : issue.file
    lines.push(`- ${loc}`)
    lines.push(`  forbidden: ${issue.token}`)
    lines.push(`  fix: ${issue.remediation}`)
  }
  return lines.join('\n')
}
