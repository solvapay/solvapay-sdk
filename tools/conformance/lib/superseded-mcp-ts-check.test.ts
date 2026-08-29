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
import { joinRel, tsPackageRel, REPO_ROOT } from '../../shared/paths.js'
import { formatMcpSupersededReport, runMcpSupersededTsCheck } from './superseded-mcp-ts-check.js'

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

  it('fails when dispatch-builtin.ts or bootstrap-payload.ts still exist', () => {
    const coreSrc = joinRel('', tsPackageRel('mcp-core'), 'src')
    const mcpSrc = joinRel('', tsPackageRel('mcp'), 'src')
    const root = makeRepo({
      [`${coreSrc}/dispatch-builtin.ts`]: 'export async function dispatchSolvaPayBuiltin() {}\n',
      [`${coreSrc}/bootstrap-payload.ts`]: 'export function createBuildBootstrapPayload() {}\n',
      [`${mcpSrc}/index.ts`]: 'export const ok = true\n',
    })
    const issues = runMcpSupersededTsCheck(root)
    expect(issues.some(i => i.token === 'dispatch-builtin.ts')).toBe(true)
    expect(issues.some(i => i.token === 'bootstrap-payload.ts')).toBe(true)
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

  it('fails on a local OAuth route table', () => {
    const coreSrc = joinRel('', tsPackageRel('mcp-core'), 'src')
    const mcpSrc = joinRel('', tsPackageRel('mcp'), 'src')
    const root = makeRepo({
      [`${coreSrc}/ok.ts`]: 'export const ok = true\n',
      [`${mcpSrc}/internal/mcp-oauth-request.ts`]:
        "return proxyCustomerAuth(params, '/v1/customer/auth/token', true)\n",
    })
    const issues = runMcpSupersededTsCheck(root)
    expect(issues.some(i => i.token === 'local OAuth route table')).toBe(true)
  })

  it('fails on reimplemented OAuth path helpers', () => {
    const coreSrc = joinRel('', tsPackageRel('mcp-core'), 'src')
    const mcpSrc = joinRel('', tsPackageRel('mcp'), 'src')
    const root = makeRepo({
      [`${coreSrc}/oauth-discovery.ts`]:
        "export function withoutTrailingSlash(value: string): string { return value.replace(/\\/$/, '') }\n",
      [`${mcpSrc}/index.ts`]: 'export const ok = true\n',
    })
    const issues = runMcpSupersededTsCheck(root)
    expect(issues.some(i => i.token === 'host OAuth path helper')).toBe(true)
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

  it('passes the live MCP TypeScript tree', () => {
    expect(runMcpSupersededTsCheck(REPO_ROOT)).toEqual([])
  })
})
