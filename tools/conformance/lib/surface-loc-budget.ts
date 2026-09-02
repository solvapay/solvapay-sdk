/**
 * Hand-written facade line budgets. Generated files are excluded by path.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { countCodeLines, type Layer3BudgetIssue } from './mcp-layer3-budget.js'

export const SURFACE_LOC_BUDGETS = [
  { id: 'ts-client', rel: 'sdks/typescript/server/src/client.ts', maxCodeLines: 97 },
  { id: 'py-facade', rel: 'sdks/python/python/solvapay/facade.py', maxCodeLines: 634 },
  { id: 'rb-facade', rel: 'sdks/ruby/lib/solvapay/facade.rb', maxCodeLines: 434 },
  { id: 'go-gate', rel: 'sdks/go/gate.go', maxCodeLines: 374 },
  { id: 'rust-client', rel: 'sdks/rust/src/client.rs', maxCodeLines: 812 },
  { id: 'ts-paywall', rel: 'sdks/typescript/server/src/paywall.ts', maxCodeLines: 755 },
  { id: 'ts-factory', rel: 'sdks/typescript/server/src/factory.ts', maxCodeLines: 499 },
  { id: 'go-mcp-server', rel: 'sdks/go/mcp/server.go', maxCodeLines: 484 },
  {
    id: 'py-mcp-register',
    rel: 'sdks/python-mcp/python/solvapay_mcp/register.py',
    maxCodeLines: 683,
  },
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
