import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import { formatMcpRsSupersededReport, runMcpSupersededRsCheck } from './superseded-mcp-rs-check.js'

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superseded-mcp-rs-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const PKG = 'sdks/rust-mcp/src'

describe('mcp-superseded-rs-check fixtures', () => {
  it('fails when a host-local narrator is planted', () => {
    const root = makeRepo({
      [`${PKG}/narrate.rs`]: 'fn narrate() -> &\'static str { "**Welcome to X**" }\n',
    })
    const issues = runMcpSupersededRsCheck(root)
    expect(issues.some(i => i.token === 'local narrator markdown')).toBe(true)
  })

  it('passes the live Rust MCP tree', () => {
    expect(runMcpSupersededRsCheck(REPO_ROOT)).toEqual([])
    expect(formatMcpRsSupersededReport([])).toBe('mcp-superseded-rs:check: OK')
  })
})
