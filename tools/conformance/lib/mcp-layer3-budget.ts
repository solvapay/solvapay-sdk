/**
 * Layer-3 MCP adapter line budget. Reference HTTP engines (Rust/Go/Ruby/C)
 * must stay thin; new glue belongs in Rust, not in the host loop.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type Layer3BudgetIssue = {
  adapter: string
  file: string
  codeLines: number
  maxCodeLines: number
}

export const LAYER3_ADAPTERS = [
  { id: 'rust', rel: 'sdks/rust-mcp/src/server.rs', maxCodeLines: 280 },
  { id: 'go', rel: 'sdks/go/mcp/engine.go', maxCodeLines: 280 },
  { id: 'ruby', rel: 'sdks/ruby-mcp/lib/solvapay/mcp/engine.rb', maxCodeLines: 280 },
  { id: 'c', rel: 'sdks/capi/ctest/mcp_engine.c', maxCodeLines: 280 },
  {
    id: 'ts',
    rel: 'sdks/typescript/mcp-core/src/engine-dispatch.ts',
    maxCodeLines: 280,
  },
  {
    id: 'py',
    rel: 'sdks/python-mcp/python/solvapay_mcp/server/engine.py',
    maxCodeLines: 280,
  },
  {
    id: 'py-asgi',
    rel: 'sdks/python-mcp/python/solvapay_mcp/asgi/mcp_engine.py',
    maxCodeLines: 280,
  },
] as const

export function countCodeLines(source: string): number {
  let count = 0
  let inBlock = false
  for (const raw of source.split(/\r?\n/)) {
    let line = raw.trim()
    if (inBlock) {
      if (line.includes('*/')) {
        inBlock = false
        line = line.slice(line.indexOf('*/') + 2).trim()
      } else {
        continue
      }
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) {
        inBlock = true
        continue
      }
      line = line.slice(line.indexOf('*/') + 2).trim()
    }
    if (line.length === 0) continue
    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('*')) continue
    count += 1
  }
  return count
}

export function runLayer3BudgetCheck(repoRoot: string): Layer3BudgetIssue[] {
  const issues: Layer3BudgetIssue[] = []
  for (const adapter of LAYER3_ADAPTERS) {
    const file = path.join(repoRoot, adapter.rel)
    if (!existsSync(file)) {
      issues.push({
        adapter: adapter.id,
        file: adapter.rel,
        codeLines: 0,
        maxCodeLines: adapter.maxCodeLines,
      })
      continue
    }
    const codeLines = countCodeLines(readFileSync(file, 'utf8'))
    if (codeLines > adapter.maxCodeLines) {
      issues.push({
        adapter: adapter.id,
        file: adapter.rel,
        codeLines,
        maxCodeLines: adapter.maxCodeLines,
      })
    }
  }
  return issues
}

export function formatLayer3BudgetReport(issues: readonly Layer3BudgetIssue[]): string {
  if (issues.length === 0) {
    return 'mcp-layer3-budget:check: OK'
  }
  const lines = [
    `mcp-layer3-budget:check: FAILED (${issues.length} adapter${issues.length === 1 ? '' : 's'})`,
    '',
    'Layer-3 MCP glue must stay inside the ~150–280 code-line budget.',
    'Move extra logic into mcpDispatch / mcpOauthRequest / mcpResume.',
    '',
  ]
  for (const issue of issues) {
    lines.push(
      `- ${issue.adapter} ${issue.file}: ${issue.codeLines} code lines (max ${issue.maxCodeLines})`,
    )
  }
  return lines.join('\n')
}
