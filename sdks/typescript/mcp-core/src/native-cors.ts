/**
 * Native-scheme CORS allowlist. Headers come from the Rust `mcpNativeCors` op.
 */

import { callMcpSyncOp } from './native-mcp'

export type McpNativeCorsInput = {
  origin?: string | null
  requestedMethod?: string | null
  requestedHeaders?: string | null
  preflight?: boolean
}

export type McpNativeCorsResult = {
  allowed: boolean
  headers: Record<string, string>
}

export function mcpNativeCors(input: McpNativeCorsInput = {}): McpNativeCorsResult {
  return callMcpSyncOp('mcpNativeCors', {
    ...(input.origin !== undefined && input.origin !== null ? { origin: input.origin } : {}),
    ...(input.requestedMethod !== undefined && input.requestedMethod !== null
      ? { requestedMethod: input.requestedMethod }
      : {}),
    ...(input.requestedHeaders !== undefined && input.requestedHeaders !== null
      ? { requestedHeaders: input.requestedHeaders }
      : {}),
    ...(input.preflight !== undefined ? { preflight: input.preflight } : {}),
  })
}

export function isNativeClientOrigin(origin: string | null | undefined): boolean {
  return mcpNativeCors({ origin }).allowed
}
