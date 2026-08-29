/**
 * Cross-cutting retired-symbol gate: docs prose plus already-deleted
 * Python/Ruby facade helpers that the server-src superseded-TS check cannot
 * see.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export type RetiredSymbolsIssue = {
  file: string
  token: string
  remediation: string
  line?: number
}

type AllowlistEntry = {
  file: string
  reason: string
  maxMentions: number
  requireRemovalContext: boolean
}

export type RetiredSymbol = {
  token: string
  pattern: RegExp
  scopes: readonly string[]
  extensions: readonly string[]
  allowlist?: readonly AllowlistEntry[]
  remediation: string
}

const REMOVAL_CONTEXT = /\b(no longer|removed|deleted|there is no|forbid|gone|retired)\b/i

const SKIP_DIRS = new Set([
  '.git',
  '.venv',
  '__pycache__',
  'dist',
  'node_modules',
  'target',
  'tmp',
  'vendor',
])

const DOCS_FLAG_ALLOWLIST = [
  {
    file: 'docs/contributing/architecture.md',
    reason: 'Records that the rollback flag is gone.',
    maxMentions: 1,
    requireRemovalContext: true,
  },
  {
    file: 'docs/contributing/testing.md',
    reason: 'Records that the rollback flag is gone.',
    maxMentions: 1,
    requireRemovalContext: true,
  },
  {
    file: 'docs/contributing/codegen-ast-derivation.md',
    reason: 'Records that Steps 52/53 deleted the flag.',
    maxMentions: 1,
    requireRemovalContext: true,
  },
  {
    file: 'docs/contributing/rust-core-sdk-redesign-v2.md',
    reason: 'Post-Step-54 note that the flag was deleted.',
    maxMentions: 1,
    requireRemovalContext: true,
  },
] as const satisfies readonly AllowlistEntry[]

export const RETIRED_SYMBOLS: readonly RetiredSymbol[] = [
  {
    token: '_resolved_meter_name',
    pattern: /\b_resolved_meter_name\b/,
    scopes: ['sdks/python'],
    extensions: ['.py', '.pyi'],
    remediation:
      'Delete _resolved_meter_name; meter names are resolved in Rust after Phase 4.',
  },
  {
    token: 'resolved_meter_name',
    pattern: /\bresolved_meter_name\b/,
    scopes: ['sdks/ruby'],
    extensions: ['.rb', '.rbs'],
    remediation:
      'Delete resolved_meter_name; meter names are resolved in Rust after Phase 4.',
  },
  {
    token: 'SOLVAPAY_IMPL',
    pattern: /\bSOLVAPAY_IMPL\b/,
    scopes: ['docs'],
    extensions: ['.md', '.mdx'],
    allowlist: DOCS_FLAG_ALLOWLIST,
    remediation:
      'Remove SOLVAPAY_IMPL from docs — rollback is republishing the prior package, not a flag.',
  },
  {
    token: 'resolveImpl',
    pattern: /\bresolveImpl\b/,
    scopes: ['docs'],
    extensions: ['.md', '.mdx'],
    allowlist: DOCS_FLAG_ALLOWLIST,
    remediation:
      'Remove resolveImpl from docs — implementation selection was deleted with the rollback flag.',
  },
  {
    token: 'SolvaPayImpl',
    pattern: /\bSolvaPayImpl\b/,
    scopes: ['docs'],
    extensions: ['.md', '.mdx'],
    allowlist: DOCS_FLAG_ALLOWLIST,
    remediation:
      'Remove SolvaPayImpl from docs — the ts/rust union type was deleted with the rollback flag.',
  },
]

function walkFiles(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      out.push(...walkFiles(full, extensions))
      continue
    }
    if (extensions.some(ext => name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

function posixRel(repoRoot: string, file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/')
}

function matchingLines(source: string, pattern: RegExp): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? ''
    pattern.lastIndex = 0
    if (pattern.test(text)) {
      hits.push({ line: i + 1, text })
    }
  }
  return hits
}

function mentionCount(source: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const global = new RegExp(pattern.source, flags)
  return [...source.matchAll(global)].length
}

/**
 * Run the retired-symbols gate against `repoRoot`.
 */
export function runRetiredSymbolsCheck(repoRoot: string): RetiredSymbolsIssue[] {
  const issues: RetiredSymbolsIssue[] = []

  for (const symbol of RETIRED_SYMBOLS) {
    const files = symbol.scopes.flatMap(scope =>
      walkFiles(path.join(repoRoot, scope), symbol.extensions),
    )
    for (const file of files) {
      const rel = posixRel(repoRoot, file)
      const source = readFileSync(file, 'utf8')
      const hits = matchingLines(source, symbol.pattern)
      if (hits.length === 0) continue

      const allow = symbol.allowlist?.find(entry => entry.file === rel)
      const count = mentionCount(source, symbol.pattern)
      const first = hits[0]
      if (first === undefined) continue

      if (allow === undefined) {
        issues.push({
          file: rel,
          token: symbol.token,
          remediation: symbol.remediation,
          line: first.line,
        })
        continue
      }

      if (count > allow.maxMentions) {
        issues.push({
          file: rel,
          token: symbol.token,
          remediation: `${symbol.remediation} Allowlisted ${rel} exceeds maxMentions=${allow.maxMentions} (found ${count}).`,
          line: first.line,
        })
        continue
      }

      if (allow.requireRemovalContext) {
        const missing = hits.filter(hit => !REMOVAL_CONTEXT.test(hit.text))
        if (missing.length > 0) {
          issues.push({
            file: rel,
            token: symbol.token,
            remediation: `${symbol.remediation} Allowlisted mention lacks removal context (no longer|removed|deleted|there is no|forbid|gone|retired).`,
            line: missing[0]?.line ?? first.line,
          })
        }
      }
    }
  }

  return issues
}

export function formatRetiredSymbolsReport(issues: readonly RetiredSymbolsIssue[]): string {
  if (issues.length === 0) {
    return 'retired-symbols:check: OK'
  }
  const lines = [
    `retired-symbols:check: FAILED (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
    '',
    'Retired symbols must not reappear. Docs may mention a token only with removal context.',
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
