import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import {
  LAYER3_ADAPTERS,
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
    writeFileSync(path.join(root, 'sdks/go/mcp/handler.go'), 'package mcp\n')
    mkdirSync(path.join(root, 'sdks/ruby-mcp/lib/solvapay/mcp'), { recursive: true })
    writeFileSync(path.join(root, 'sdks/ruby-mcp/lib/solvapay/mcp/engine.rb'), "class Engine\nend\n")
    mkdirSync(path.join(root, 'sdks/capi/ctest'), { recursive: true })
    writeFileSync(path.join(root, 'sdks/capi/ctest/mcp_engine.c'), 'int main() { return 0; }\n')
    mkdirSync(path.join(root, 'sdks/typescript/mcp-core/src'), { recursive: true })
    writeFileSync(path.join(root, 'sdks/typescript/mcp-core/src/engine-dispatch.ts'), 'export {}\n')
    mkdirSync(path.join(root, 'sdks/python-mcp/python/solvapay_mcp/server'), {
      recursive: true,
    })
    writeFileSync(
      path.join(root, 'sdks/python-mcp/python/solvapay_mcp/server/engine.py'),
      'def dispatch():\n  return None\n',
    )
    mkdirSync(path.join(root, 'sdks/python-mcp/python/solvapay_mcp/asgi'), {
      recursive: true,
    })
    writeFileSync(
      path.join(root, 'sdks/python-mcp/python/solvapay_mcp/asgi/mcp_engine.py'),
      'def create_app():\n  return None\n',
    )
    const issues = runLayer3BudgetCheck(root)
    expect(issues.some(i => i.adapter === 'rust' && i.codeLines > 280)).toBe(true)
    expect(formatLayer3BudgetReport(issues)).toMatch(/rust/)
  })

  it('counts only code lines', () => {
    expect(
      countCodeLines('// comment\n\nfn handle() {\n  dispatch();\n}\n'),
    ).toBe(3)
  })

  it('covers the Python ASGI engine adapter', () => {
    expect(LAYER3_ADAPTERS.some(adapter => adapter.id === 'py-asgi')).toBe(true)
    expect(
      LAYER3_ADAPTERS.some(
        adapter => adapter.rel === 'sdks/python-mcp/python/solvapay_mcp/asgi/mcp_engine.py',
      ),
    ).toBe(true)
  })

  it('passes the live reference adapters', () => {
    expect(runLayer3BudgetCheck(REPO_ROOT)).toEqual([])
    expect(formatLayer3BudgetReport([])).toBe('mcp-layer3-budget:check: OK')
  })
})
