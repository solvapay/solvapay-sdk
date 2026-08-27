/**
 * MCP superseded-TS gate unit tests (RED→GREEN).
 *
 * Fixture trees prove the checker fails on forbidden files/tokens. The live
 * tree is checked separately via `pnpm mcp-superseded-ts:check`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { joinRel, tsPackageRel } from '../../shared/paths.js'
import {
  formatMcpSupersededReport,
  runMcpSupersededTsCheck,
} from './superseded-mcp-ts-check.js'

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superseded-mcp-ts-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

describe('mcp-superseded-ts-check fixtures', () => {
  it('fails when forbidden host-local files still exist', () => {
    const coreSrc = joinRel('', tsPackageRel('mcp-core'), 'src')
    const mcpSrc = joinRel('', tsPackageRel('mcp'), 'src')
    const root = makeRepo({
      [`${coreSrc}/narrate-local.ts`]: 'export function narrateManageAccount() {}\n',
      [`${coreSrc}/ok.ts`]: 'export const ok = true\n',
      [`${mcpSrc}/index.ts`]: 'export const ok = true\n',
    })
    const issues = runMcpSupersededTsCheck(root)
    expect(issues.some(i => i.token === 'narrate-local.ts')).toBe(true)
    expect(formatMcpSupersededReport(issues)).toMatch(/narrate-local/)
  })

  it('fails on tsFallback', () => {
    const coreSrc = joinRel('', tsPackageRel('mcp-core'), 'src')
    const mcpSrc = joinRel('', tsPackageRel('mcp'), 'src')
    const root = makeRepo({
      [`${coreSrc}/native-mcp.ts`]:
        'export function callMcpSyncOp(tsFallback) { return tsFallback() }\n',
      [`${mcpSrc}/index.ts`]: 'export const ok = true\n',
    })
    const issues = runMcpSupersededTsCheck(root)
    expect(issues.some(i => i.token === 'tsFallback')).toBe(true)
  })

  it('fails on reimplemented narrator markdown', () => {
    const coreSrc = joinRel('', tsPackageRel('mcp-core'), 'src')
    const mcpSrc = joinRel('', tsPackageRel('mcp'), 'src')
    const root = makeRepo({
      [`${coreSrc}/narrate.ts`]: 'return `**Welcome to ${name}**`\n',
      [`${mcpSrc}/index.ts`]: 'export const ok = true\n',
    })
    const issues = runMcpSupersededTsCheck(root)
    expect(issues.some(i => i.token === 'local narrator markdown')).toBe(true)
  })

  it('passes a clean Rust-delegating MCP tree', () => {
    const coreSrc = joinRel('', tsPackageRel('mcp-core'), 'src')
    const mcpSrc = joinRel('', tsPackageRel('mcp'), 'src')
    const root = makeRepo({
      [`${coreSrc}/native-mcp.ts`]:
        "export function callMcpSyncOp(op, args) { return callNativeSync('solvapayCall', JSON.stringify({ op, args })) }\n",
      [`${coreSrc}/narrate.ts`]:
        "export function narrateUpgrade(data) { return callMcpSyncOp('mcpNarrate', { tool: 'upgrade', payload: data }) }\n",
      [`${mcpSrc}/fetch/handler.ts`]:
        'export async function handle(req) { return client.mcpDispatch(req) }\n',
    })
    expect(runMcpSupersededTsCheck(root)).toEqual([])
    expect(formatMcpSupersededReport([])).toBe('mcp-superseded-ts:check: OK')
  })
})
