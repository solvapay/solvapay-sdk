import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import { readRbMcpSymbols, readRustMcpSymbols } from './generated-client-surfaces.js'

describe('MCP surface readers', () => {
  it('reads public Ruby MCP methods, including generated layer-2 names', () => {
    const { symbols } = readRbMcpSymbols(REPO_ROOT)
    expect(symbols.has('paywall_tool_result')).toBe(true)
    expect(symbols.has('invoke_payable_next')).toBe(true)
    expect(symbols.has('MCP_TOOL_NAMES')).toBe(true)
  })

  it('reads rust-mcp public fns, not wasm js_name exports', () => {
    const { symbols } = readRustMcpSymbols(REPO_ROOT)
    expect(symbols.has('paywall_tool_result')).toBe(true)
    expect(symbols.has('mcp_view_maps')).toBe(true)
    expect(symbols.has('paywallToolResult')).toBe(false)
  })
})
