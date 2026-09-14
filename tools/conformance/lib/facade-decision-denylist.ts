/**
 * Cross-surface denylist: facades must not re-implement these core decisions.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../../shared/paths.js'

const FORBIDDEN = [
  {
    id: 'overlay_claimed_limits',
    re: /remaining === -1[\s\S]{0,200}evaluation\.remaining \+ 1/,
  },
  {
    id: 'extract_bearer_token',
    re: /startsWith\(\s*['"]Bearer ['"]\s*\)/,
    roots: ['sdks/typescript/mcp-core/src', 'sdks/python-mcp/python/solvapay_mcp'],
  },
  {
    id: 'decode_jwt_payload',
    re: /split\(['"]\.['"]\)[\s\S]{0,80}atob\(/,
    roots: ['sdks/typescript/mcp-core/src', 'sdks/python-mcp/python/solvapay_mcp'],
  },
  {
    id: 'gate_kind_message_map',
    re: /Activation required['"][\s\S]{0,80}Payment required/,
    roots: ['sdks/typescript/mcp-core/src', 'sdks/typescript/server/src'],
  },
  {
    id: 'anonymous_customer_ref_fallback',
    re: /return ["']anonymous["']/,
    roots: [
      'sdks/ruby-mcp/lib',
      'sdks/python-mcp/python/solvapay_mcp',
      'sdks/go/mcp',
      'sdks/rust-mcp/src',
    ],
  },
] as const

function walk(dir: string, acc: string[]): void {
  if (!statSync(dir).isDirectory()) {
    acc.push(dir)
    return
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'target' || entry === 'dist') continue
    walk(path.join(dir, entry), acc)
  }
}

export function checkFacadeDecisionDenylist(): string[] {
  const issues: string[] = []
  for (const rule of FORBIDDEN) {
    const roots =
      'roots' in rule && rule.roots
        ? rule.roots.map(rel => path.join(REPO_ROOT, rel))
        : [
            path.join(REPO_ROOT, 'sdks/typescript'),
            path.join(REPO_ROOT, 'sdks/python'),
            path.join(REPO_ROOT, 'sdks/python-mcp'),
            path.join(REPO_ROOT, 'sdks/go'),
            path.join(REPO_ROOT, 'sdks/ruby'),
            path.join(REPO_ROOT, 'sdks/ruby-mcp'),
            path.join(REPO_ROOT, 'sdks/rust'),
            path.join(REPO_ROOT, 'sdks/rust-mcp'),
          ]
    for (const root of roots) {
      const files: string[] = []
      try {
        walk(root, files)
      } catch {
        continue
      }
      for (const file of files) {
        if (!/\.(ts|tsx|js|py|go|rb|rs)$/.test(file)) continue
        if (file.includes('.generated.') || file.includes('_generated')) continue
        if (/\.(test|spec)\./.test(file) || file.includes('__tests__')) continue
        const text = readFileSync(file, 'utf8')
        if (rule.re.test(text)) {
          issues.push(`${rule.id}: ${path.relative(REPO_ROOT, file)}`)
        }
      }
    }
  }
  return issues
}
