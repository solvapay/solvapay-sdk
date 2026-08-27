/**
 * Allow-or-challenge decision for MCP HTTP auth. Body/headers come from
 * the Rust `mcpAuthGate` op. JWT parsing stays in the adapter.
 */

import { callMcpSyncOp } from './native-mcp'
import type { McpAuthMode } from './is-free-mcp-method'

export type McpAuthGateInput = {
  rpcMethod?: string
  authHeader?: string | null
  authMode?: McpAuthMode
  publicBaseUrl: string
  mcpPath?: string
  jsonRpcId?: string | number | null
}

export type McpAuthGateAllow = { kind: 'allow' }

export type McpAuthGateChallenge = {
  kind: 'challenge'
  status: number
  headers: Record<string, string>
  body: unknown
}

export type McpAuthGateResult = McpAuthGateAllow | McpAuthGateChallenge

export function mcpAuthGate(input: McpAuthGateInput): McpAuthGateResult {
  return callMcpSyncOp('mcpAuthGate', {
    publicBaseUrl: input.publicBaseUrl,
    ...(input.rpcMethod !== undefined ? { rpcMethod: input.rpcMethod } : {}),
    ...(input.authHeader !== undefined ? { authHeader: input.authHeader } : {}),
    ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
    ...(input.mcpPath !== undefined ? { mcpPath: input.mcpPath } : {}),
    ...(input.jsonRpcId !== undefined ? { jsonRpcId: input.jsonRpcId } : {}),
  })
}
