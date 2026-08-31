/**
 * Retired-symbols gate unit tests (RED→GREEN).
 *
 * Fixture cases prove each registry entry. The live tree is checked separately
 * via `pnpm retired-symbols:check`.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatRetiredSymbolsReport, runRetiredSymbolsCheck } from './retired-symbols.js'

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
}

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'retired-symbols-'))
  writeTree(root, files)
  return root
}

describe('retired-symbols-check fixtures', () => {
  it('reports _resolved_meter_name under sdks/python', () => {
    const root = makeRepo({
      'sdks/python/python/solvapay/facade.py': 'def _resolved_meter_name():\n    return None\n',
    })
    const issues = runRetiredSymbolsCheck(root)
    expect(issues.some(i => i.token === '_resolved_meter_name')).toBe(true)
    expect(formatRetiredSymbolsReport(issues)).toMatch(/_resolved_meter_name/)
  })

  it('reports resolved_meter_name under sdks/ruby', () => {
    const root = makeRepo({
      'sdks/ruby/lib/solvapay/facade.rb': 'def resolved_meter_name\n  nil\nend\n',
    })
    const issues = runRetiredSymbolsCheck(root)
    expect(issues.some(i => i.token === 'resolved_meter_name')).toBe(true)
  })

  it('reports SOLVAPAY_IMPL / resolveImpl / SolvaPayImpl in docs', () => {
    const root = makeRepo({
      'docs/contributing/history.md':
        'Force SOLVAPAY_IMPL=rust via resolveImpl; SolvaPayImpl is ts | rust.\n',
    })
    const issues = runRetiredSymbolsCheck(root)
    expect(issues.some(i => i.token === 'SOLVAPAY_IMPL')).toBe(true)
    expect(issues.some(i => i.token === 'resolveImpl')).toBe(true)
    expect(issues.some(i => i.token === 'SolvaPayImpl')).toBe(true)
  })

  it('passes a tree with no retired tokens', () => {
    const root = makeRepo({
      'sdks/python/python/solvapay/facade.py': 'def meter_name():\n    return "calls"\n',
      'sdks/ruby/lib/solvapay/facade.rb': "def meter_name\n  'calls'\nend\n",
      'docs/contributing/testing.md': 'Bindings always dispatch to Rust.\n',
    })
    expect(runRetiredSymbolsCheck(root)).toEqual([])
    expect(formatRetiredSymbolsReport([])).toBe('retired-symbols:check: OK')
  })

  it('allows an allowlisted mention that includes removal context', () => {
    const root = makeRepo({
      'docs/contributing/architecture.md':
        'Missing bindings throw; there is no `SOLVAPAY_IMPL` rollback flag.\n',
    })
    expect(runRetiredSymbolsCheck(root)).toEqual([])
  })

  it('reports an allowlisted file when the mention lacks removal context', () => {
    const root = makeRepo({
      'docs/contributing/architecture.md': 'Set SOLVAPAY_IMPL=rust to force the binding.\n',
    })
    const issues = runRetiredSymbolsCheck(root)
    expect(issues.some(i => i.token === 'SOLVAPAY_IMPL')).toBe(true)
    expect(formatRetiredSymbolsReport(issues)).toMatch(/removal context/)
  })

  it('reports an allowlisted file that exceeds maxMentions', () => {
    const root = makeRepo({
      'docs/contributing/testing.md':
        'there is no SOLVAPAY_IMPL selection flag.\nthere is no SOLVAPAY_IMPL leftover either.\n',
    })
    const issues = runRetiredSymbolsCheck(root)
    expect(issues.some(i => i.token === 'SOLVAPAY_IMPL' && /maxMentions/.test(i.remediation))).toBe(
      true,
    )
  })
})
