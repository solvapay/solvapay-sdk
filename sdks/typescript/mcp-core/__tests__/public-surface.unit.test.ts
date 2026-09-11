import { describe, expect, it } from 'vitest'
import * as mcpCore from '../src'

describe('@solvapay/mcp-core public surface', () => {
  it('does not export the dead tools/list reach-in wrappers', () => {
    expect('applyHideToolsByAudience' in mcpCore).toBe(false)
    expect('defaultIsChatGptRequest' in mcpCore).toBe(false)
  })
})
