import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import { readRbMcpSymbols, readRustMcpSymbols } from './generated-client-surfaces.js'

describe('MCP surface readers', () => {
  it('reads multiline Ruby define_singleton_method names including paywall_tool_result', () => {
    const { symbols } = readRbMcpSymbols(REPO_ROOT)
    expect(symbols.has('paywall_tool_result')).toBe(true)
    expect(symbols.has('invoke_payable_next')).toBe(true)
    expect(symbols.has('MCP_TOOL_NAMES')).toBe(true)
  })

  it('accepts snake_case catalog names for camelCase wasm js_name exports', () => {
    const { symbols } = readRustMcpSymbols(REPO_ROOT)
    expect(symbols.has('paywall_tool_result')).toBe(true)
    expect(symbols.has('mcp_view_maps')).toBe(true)
    expect(symbols.has('paywallToolResult')).toBe(true)
  })
})
