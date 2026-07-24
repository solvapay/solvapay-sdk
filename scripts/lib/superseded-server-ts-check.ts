/**
 * Step 53 — grep gate proving `@solvapay/server` no longer carries
 * superseded TypeScript semantic implementations (webhook crypto, client
 * fetch bodies, paywall/retry TS modules, tsFallback dispatch).
 *
 * Scans only `packages/server/src`. §8 host/orchestration TypeScript is
 * retained by path/symbol scope, not by a broad "allow TypeScript" exemption.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export type SupersededIssue = {
  file: string
  token: string
  remediation: string
  line?: number
}

const FORBIDDEN_FILES = [
  'paywall-state-ts.ts',
  'paywall-gate-ts.ts',
  'paywall-payload-ts.ts',
] as const

type ContentRule = {
  token: string
  pattern: RegExp
  /** Restrict to a basename when set (e.g. only client.ts). */
  fileBasename?: string
  remediation: string
}

const CONTENT_RULES: readonly ContentRule[] = [
  {
    token: 'verifyWebhookTs',
    pattern: /\bverifyWebhookTs\b/,
    remediation: 'Delete the TS webhook body; route only through verifyWebhookNative / verifyWebhookWasm.',
  },
  {
    token: 'timingSafeEqual',
    pattern: /\btimingSafeEqual\b/,
    fileBasename: 'edge.ts',
    remediation: 'Remove the edge Web Crypto rollback helper; WASM owns webhook verification.',
  },
  {
    token: 'calculateDelayTs',
    pattern: /\bcalculateDelayTs\b/,
    remediation: 'Delete TS retry delay math; dispatch retryNextDelayMs to Rust only.',
  },
  {
    token: 'tsFallback',
    pattern: /\btsFallback\b/,
    fileBasename: 'client.ts',
    remediation: 'Remove tsFallback from dispatchClient; fail fast when Rust is unavailable or forced off.',
  },
  {
    token: 'tsFallback',
    pattern: /\btsFallback\b/,
    fileBasename: 'native-decisions.ts',
    remediation: 'Remove tsFallback from dispatchSync; fail fast when uninstalled or SOLVAPAY_IMPL=ts.',
  },
  {
    token: 'fetch(',
    pattern: /\bfetch\s*\(/,
    fileBasename: 'client.ts',
    remediation: 'Delete client fetch bodies; every method must only assemble args + dispatchClient.',
  },
  {
    token: 'paywall-*-ts import',
    pattern: /from ['"]\.\/paywall-(?:state|gate|payload)-ts['"]/,
    remediation: 'Stop importing paywall-*-ts modules; delete those files and dispatch via Rust.',
  },
  {
    token: 'Step 53 TS fallback comment',
    pattern: /until Step 53|TS bodies remain|TypeScript fallback|retained TypeScript/i,
    remediation: 'Remove stale comments that claim a TS semantic fallback remains until Step 53.',
  },
]

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      // Skip generated output folders that are not hand-authored semantics.
      if (name === '__tests__' || name === '__generated__') continue
      out.push(...walkTsFiles(full))
      continue
    }
    if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
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

/**
 * Run the superseded-TS gate against `packages/server/src` under `repoRoot`.
 */
export function runSupersededServerTsCheck(repoRoot: string): SupersededIssue[] {
  const srcRoot = path.join(repoRoot, 'packages/server/src')
  const issues: SupersededIssue[] = []

  for (const basename of FORBIDDEN_FILES) {
    const full = path.join(srcRoot, basename)
    if (existsSync(full)) {
      issues.push({
        file: path.relative(repoRoot, full),
        token: basename,
        remediation: `Delete ${basename}; paywall semantics live in Rust after Step 53.`,
      })
    }
  }

  if (!existsSync(srcRoot)) {
    issues.push({
      file: path.relative(repoRoot, srcRoot),
      token: 'packages/server/src',
      remediation: 'Expected packages/server/src to exist for the superseded-TS scan.',
    })
    return issues
  }

  for (const file of walkTsFiles(srcRoot)) {
    const rel = path.relative(repoRoot, file)
    const basename = path.basename(file)
    const source = readFileSync(file, 'utf8')

    for (const rule of CONTENT_RULES) {
      if (rule.fileBasename !== undefined && rule.fileBasename !== basename) continue
      if (!rule.pattern.test(source)) continue
      // Reset lastIndex for global-less patterns reused across files.
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

export function formatSupersededReport(issues: readonly SupersededIssue[]): string {
  if (issues.length === 0) {
    return 'server-superseded-ts:check: OK'
  }
  const lines = [
    `server-superseded-ts:check: FAILED (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
    '',
    'Superseded TypeScript semantic implementations must be removed (Step 53).',
    'Delegation proves routing; this gate proves duplicate implementations are absent.',
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
