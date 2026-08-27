/**
 * Hand-written facade line budgets. Generated files are excluded by path.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { countCodeLines, type Layer3BudgetIssue } from './mcp-layer3-budget.js'

export const SURFACE_LOC_BUDGETS = [
  { id: 'ts-client', rel: 'sdks/typescript/server/src/client.ts', maxCodeLines: 320 },
  { id: 'py-facade', rel: 'sdks/python/python/solvapay/facade.py', maxCodeLines: 560 },
  { id: 'rb-facade', rel: 'sdks/ruby/lib/solvapay/facade.rb', maxCodeLines: 360 },
  { id: 'go-gate', rel: 'sdks/go/gate.go', maxCodeLines: 450 },
  { id: 'rust-client', rel: 'sdks/rust/src/client.rs', maxCodeLines: 720 },
] as const

export function runSurfaceLocBudgetCheck(repoRoot: string): Layer3BudgetIssue[] {
  const issues: Layer3BudgetIssue[] = []
  for (const adapter of SURFACE_LOC_BUDGETS) {
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
