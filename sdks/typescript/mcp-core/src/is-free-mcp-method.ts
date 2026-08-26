/**
 * Methods that must not require bearer auth (or payment gating).
 *
 * Only `tools/call` executes merchant tools and must be authenticated.
 * Handshake + listing (`initialize`, `tools/list`, …) stay open so
 * clients and no-code discovery can connect without a customer JWT.
 */
export type McpAuthMode = 'tools-call' | 'all'

export function isFreeMcpMethod(mcpMethod?: string): boolean {
  const method = (mcpMethod || '').trim().toLowerCase()
  return method !== 'tools/call'
}

export function requiresBearerAuth(
  mcpMethod: string | undefined,
  authMode: McpAuthMode,
): boolean {
  if (authMode === 'all') {
    return true
  }
  return !isFreeMcpMethod(mcpMethod)
}
