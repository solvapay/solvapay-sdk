/**
 * Data-plane audience filter (`mcpHideToolsByAudience`).
 */

import { callMcpSyncOp } from './native-mcp'

interface ToolDescriptorLike {
  _meta?: { audience?: unknown } | undefined
  [key: string]: unknown
}

export type HideToolsByAudienceResult = {
  tools: ToolDescriptorLike[]
}

export function hideToolsByAudience(
  tools: ToolDescriptorLike[],
  audiences: readonly string[],
  userAgent?: string,
): HideToolsByAudienceResult {
  if (audiences.length === 0) return { tools }
  return callMcpSyncOp('mcpHideToolsByAudience', {
    tools,
    audiences: [...audiences],
    ...(userAgent !== undefined ? { userAgent } : {}),
  })
}
