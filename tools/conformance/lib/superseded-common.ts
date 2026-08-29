/**
 * Shared walk / rule-application / report machinery for MCP superseded gates.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { joinRel } from '../../shared/paths.js'

export type SupersededIssue = {
  file: string
  token: string
  remediation: string
  line?: number
}

export type ContentRule = {
  token: string
  pattern: RegExp
  remediation: string
}

export const SHARED_MCP_CONTENT_RULES: readonly ContentRule[] = [
  {
    token: 'local narrator markdown',
    pattern: /\*\*Welcome to |Opened \{p\} top-up|Plans available:/,
    remediation: 'Do not author narrator markdown in the host; call mcpNarrate.',
  },
  {
    token: 'host OAuth error inspect',
    pattern: /touches\(["']grant_type["']\)/,
    remediation: 'Call mcpOauthErrorInspect; do not reimplement OAuth error mapping.',
  },
  {
    token: 'local OAuth route table',
    pattern: /\/v1\/customer\/auth\/token|\/v1\/customer\/auth\/register/,
    remediation: 'Call mcpOauthRequest; do not reimplement the OAuth proxy route table.',
  },
  {
    token: 'overview markdown',
    pattern: /# SolvaPay MCP server — overview/,
    remediation: 'Call mcpOverviewResource; do not vendor overview markdown.',
  },
]

export function walkFiles(
  dir: string,
  options: {
    extensions: readonly string[]
    skipDirNames?: readonly string[]
    skipFile?: (name: string) => boolean
  },
): string[] {
  if (!existsSync(dir)) return []
  const skip = new Set(options.skipDirNames ?? [])
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (skip.has(name)) continue
      out.push(...walkFiles(full, options))
      continue
    }
    if (options.skipFile?.(name) === true) continue
    if (options.extensions.some(ext => name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

export function firstMatchLine(source: string, pattern: RegExp): number | undefined {
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i] ?? '')) return i + 1
  }
  return undefined
}

export function collectSupersededIssues(options: {
  repoRoot: string
  srcRels: readonly string[]
  forbiddenFiles: readonly string[]
  contentRules: readonly ContentRule[]
  extensions: readonly string[]
  skipDirNames?: readonly string[]
  skipFile?: (name: string) => boolean
  missingRootRemediation: string
}): SupersededIssue[] {
  const issues: SupersededIssue[] = []
  for (const srcRel of options.srcRels) {
    const srcRoot = joinRel(options.repoRoot, srcRel)
    for (const rel of options.forbiddenFiles) {
      const full = path.join(srcRoot, rel)
      if (existsSync(full)) {
        issues.push({
          file: path.relative(options.repoRoot, full),
          token: path.basename(rel),
          remediation: `Delete ${rel}; MCP semantics live in Rust.`,
        })
      }
    }
    if (!existsSync(srcRoot)) {
      issues.push({
        file: path.relative(options.repoRoot, srcRoot),
        token: srcRel,
        remediation: options.missingRootRemediation,
      })
      continue
    }
    for (const file of walkFiles(srcRoot, {
      extensions: options.extensions,
      skipDirNames: options.skipDirNames,
      skipFile: options.skipFile,
    })) {
      const rel = path.relative(options.repoRoot, file)
      const source = readFileSync(file, 'utf8')
      for (const rule of options.contentRules) {
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

export function formatSupersededReport(
  checkName: string,
  issues: readonly SupersededIssue[],
  intro: string,
): string {
  if (issues.length === 0) {
    return `${checkName}: OK`
  }
  const lines = [
    `${checkName}: FAILED (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
    '',
    intro,
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
