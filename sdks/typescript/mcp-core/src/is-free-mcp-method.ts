/**
 * Methods that must not require bearer auth (or payment gating).
 *
 * Only `tools/call` executes merchant tools and must be authenticated.
 * Handshake + listing (`initialize`, `tools/list`, …) stay open so
 * clients and no-code discovery can connect without a customer JWT.
 */

import { callMcpSyncOp } from './native-mcp'

export type McpAuthMode = 'tools-call' | 'all'

export function isFreeMcpMethod(mcpMethod?: string): boolean {
  return callMcpSyncOp('mcpIsFreeMethod', { mcpMethod: mcpMethod ?? null })
}

export function requiresBearerAuth(
  mcpMethod: string | undefined,
  authMode: McpAuthMode,
): boolean {
  return callMcpSyncOp('mcpRequiresBearerAuth', {
    mcpMethod: mcpMethod ?? null,
    authMode,
  })
}
