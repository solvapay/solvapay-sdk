import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callNativeSync } from '@solvapay/server'
import { callMcpSyncOp, installNativeMcpApi, resetNativeMcpApiForTests } from '../src/native-mcp'

describe('callMcpSyncOp without native API', () => {
  beforeEach(() => {
    resetNativeMcpApiForTests()
  })

  afterEach(() => {
    installNativeMcpApi({ callNativeSync })
  })

  it('throws when no native API is installed', () => {
    expect(() => callMcpSyncOp('mcpMergeCsp', {})).toThrow(/native MCP API is not installed/)
  })
})
