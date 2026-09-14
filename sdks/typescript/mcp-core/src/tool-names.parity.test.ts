import { describe, expect, it } from 'vitest'
import { getMcpToolNamesTable, mcpViewMaps } from './native-mcp'
import { MCP_TOOL_NAMES } from './tool-names'
import { TOOL_FOR_VIEW, VIEW_FOR_TOOL } from './types'

describe('MCP table parity with Rust', () => {
  it('MCP_TOOL_NAMES matches getMcpToolNamesTable', () => {
    const table = getMcpToolNamesTable() as Record<string, string>
    for (const [key, value] of Object.entries(MCP_TOOL_NAMES)) {
      expect(table[key] ?? table[value]).toBeDefined()
      expect(Object.values(table)).toContain(value)
    }
  })

  it('TOOL_FOR_VIEW / VIEW_FOR_TOOL match mcpViewMaps', () => {
    const maps = mcpViewMaps() as {
      TOOL_FOR_VIEW?: Record<string, string>
      VIEW_FOR_TOOL?: Record<string, string>
    }
    expect(maps.TOOL_FOR_VIEW).toMatchObject(TOOL_FOR_VIEW)
    expect(maps.VIEW_FOR_TOOL).toMatchObject(VIEW_FOR_TOOL)
  })
})
