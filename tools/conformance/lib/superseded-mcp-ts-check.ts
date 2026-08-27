/**
 * Negative grep gate: `@solvapay/mcp-core` and `@solvapay/mcp` must not
 * reimplement Rust MCP semantics (narrators, builtin handlers, tsFallback).
 *
 * Delegation proves routing; this gate proves duplicate implementations
 * are absent. Modeled on `superseded-server-ts-check.ts`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { joinRel, tsPackageRel } from '../../shared/paths.js'

export type McpSupersededIssue = {
  file: string
  token: string
  remediation: string
  line?: number
}

const PACKAGES = ['mcp-core', 'mcp'] as const

/** Filenames that used to hold host-local MCP semantics. */
const FORBIDDEN_FILES = [
  'narrate-local.ts',
  'builtin-handlers.ts',
  'dispatch-builtin.ts',
  'bootstrap-payload.ts',
] as const

type ContentRule = {
  token: string
  pattern: RegExp
  remediation: string
}

const CONTENT_RULES: readonly ContentRule[] = [
  {
    token: 'tsFallback',
    pattern: /\btsFallback\b/,
    remediation:
      'Remove tsFallback from MCP dispatch; fail fast when the Rust/WASM API is unavailable.',
  },
  {
    token: 'local narrator markdown',
    pattern: /\*\*Welcome to |Opened \{p\} top-up|Plans available:/,
    remediation: 'Do not author narrator markdown in TypeScript; call mcpNarrate.',
  },
  {
    token: 'host OAuth path helper',
    pattern: /value\.replace\(\/\\\/\$\//,
    remediation: 'Call mcpOauthPath; do not reimplement slash helpers in TypeScript.',
  },
  {
    token: 'host OAuth error inspect',
    pattern: /touches\(['"]grant_type['"]\)/,
    remediation: 'Call mcpOauthErrorInspect; do not reimplement OAuth error mapping in TypeScript.',
  },
  {
    token: 'local OAuth route table',
    pattern: /\/v1\/customer\/auth\/token|\/v1\/customer\/auth\/register/,
    remediation:
      'Call mcpOauthRequest; do not reimplement the OAuth proxy route table in TypeScript.',
  },
  {
    token: 'overview markdown',
    pattern: /# SolvaPay MCP server — overview/,
    remediation: 'Call mcpOverviewResource; do not vendor overview markdown in TypeScript.',
  },
]

function walkTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === '__generated__') continue
      out.push(...walkTsFiles(full))
      continue
    }
    if (
      name.endsWith('.ts') &&
      !name.endsWith('.d.ts') &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.spec.ts')
    ) {
      out.push(full)
    }
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

export function runMcpSupersededTsCheck(repoRoot: string): McpSupersededIssue[] {
  const issues: McpSupersededIssue[] = []

  for (const pkg of PACKAGES) {
    const srcRoot = joinRel(repoRoot, tsPackageRel(pkg), 'src')
    for (const basename of FORBIDDEN_FILES) {
      const full = path.join(srcRoot, basename)
      if (existsSync(full)) {
        issues.push({
          file: path.relative(repoRoot, full),
          token: basename,
          remediation: `Delete ${basename}; MCP semantics live in Rust.`,
        })
      }
    }

    if (!existsSync(srcRoot)) {
      issues.push({
        file: path.relative(repoRoot, srcRoot),
        token: `${pkg}/src`,
        remediation: `Expected ${pkg} src directory to exist for the superseded-MCP scan.`,
      })
      continue
    }

    for (const file of walkTsFiles(srcRoot)) {
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
  }

  return issues
}

export function formatMcpSupersededReport(issues: readonly McpSupersededIssue[]): string {
  if (issues.length === 0) {
    return 'mcp-superseded-ts:check: OK'
  }
  const lines = [
    `mcp-superseded-ts:check: FAILED (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
    '',
    'Duplicate MCP TypeScript implementations must be removed.',
    'Delegation proves routing; this gate proves host copies are absent.',
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
