/**
 * Methods that must not require bearer auth (or payment gating).
 *
 * Only `tools/call` executes merchant tools and must be authenticated.
 * Handshake + listing (`initialize`, `tools/list`, …) stay open so
 * clients and no-code discovery can connect without a customer JWT.
 */
export function isFreeMcpMethod(mcpMethod?: string): boolean {
  const method = (mcpMethod || '').trim().toLowerCase()
  return method !== 'tools/call'
}
