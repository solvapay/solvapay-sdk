import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import {
  countCodeLines,
  formatLayer3BudgetReport,
  runLayer3BudgetCheck,
} from './mcp-layer3-budget.js'

describe('mcp-layer3-budget', () => {
  it('fails a deliberately oversized adapter file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layer3-budget-'))
    const body = Array.from({ length: 300 }, (_, i) => `fn step_${i}() {}`).join('\n')
    const rel = 'sdks/rust-mcp/src/server.rs'
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
    writeFileSync(path.join(root, rel), body)
    mkdirSync(path.join(root, 'sdks/go/mcp'), { recursive: true })
    writeFileSync(path.join(root, 'sdks/go/mcp/engine.go'), 'package mcp\n')
    mkdirSync(path.join(root, 'sdks/ruby-mcp/lib/solvapay/mcp'), { recursive: true })
    writeFileSync(path.join(root, 'sdks/ruby-mcp/lib/solvapay/mcp/engine.rb'), "class Engine\nend\n")
    mkdirSync(path.join(root, 'sdks/capi/ctest'), { recursive: true })
    writeFileSync(path.join(root, 'sdks/capi/ctest/mcp_engine.c'), 'int main() { return 0; }\n')
    const issues = runLayer3BudgetCheck(root)
    expect(issues.some(i => i.adapter === 'rust' && i.codeLines > 280)).toBe(true)
    expect(formatLayer3BudgetReport(issues)).toMatch(/rust/)
  })

  it('counts only code lines', () => {
    expect(
      countCodeLines('// comment\n\nfn handle() {\n  dispatch();\n}\n'),
    ).toBe(3)
  })

  it('passes the live reference adapters', () => {
    expect(runLayer3BudgetCheck(REPO_ROOT)).toEqual([])
    expect(formatLayer3BudgetReport([])).toBe('mcp-layer3-budget:check: OK')
  })
})
