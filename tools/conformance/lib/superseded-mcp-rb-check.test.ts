import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import { formatMcpRbSupersededReport, runMcpSupersededRbCheck } from './superseded-mcp-rb-check.js'

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superseded-mcp-rb-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const PKG = 'sdks/ruby-mcp/lib/solvapay/mcp'

describe('mcp-superseded-rb-check fixtures', () => {
  it('fails when a host-local narrator is planted', () => {
    const root = makeRepo({
      [`${PKG}/narrate.rb`]: 'def narrate\n  "**Welcome to X**"\nend\n',
    })
    const issues = runMcpSupersededRbCheck(root)
    expect(issues.some(i => i.token === 'local narrator markdown')).toBe(true)
  })

  it('passes the live Ruby MCP tree', () => {
    expect(runMcpSupersededRbCheck(REPO_ROOT)).toEqual([])
    expect(formatMcpRbSupersededReport([])).toBe('mcp-superseded-rb:check: OK')
  })
})
