import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import { formatMcpGoSupersededReport, runMcpSupersededGoCheck } from './superseded-mcp-go-check.js'

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superseded-mcp-go-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const PKG = 'sdks/go/mcp'

describe('mcp-superseded-go-check fixtures', () => {
  it('fails when a host-local narrator is planted', () => {
    const root = makeRepo({
      [`${PKG}/narrate.go`]: 'func narrate() string { return "**Welcome to X**" }\n',
    })
    const issues = runMcpSupersededGoCheck(root)
    expect(issues.some(i => i.token === 'local narrator markdown')).toBe(true)
  })

  it('passes the live Go MCP tree', () => {
    expect(runMcpSupersededGoCheck(REPO_ROOT)).toEqual([])
    expect(formatMcpGoSupersededReport([])).toBe('mcp-superseded-go:check: OK')
  })
})
