/**
 * Descriptor metadata + JSON Schema from the Rust `mcpDescriptors` op.
 * Handler closures and Zod shapes stay in `descriptors.ts`.
 */

import { callMcpSyncOp } from './native-mcp'
import type { SolvaPayMcpCsp, SolvaPayMerchantBranding, SolvaPayMcpViewKind } from './types'

export type McpDescriptorsInput = {
  resourceUri: string
  publicBaseUrl: string
  productRef: string
  views?: SolvaPayMcpViewKind[]
  csp?: SolvaPayMcpCsp
  apiBaseUrl?: string
  branding?: SolvaPayMerchantBranding
}

export type McpDescriptorTool = {
  name: string
  title?: string
  description: string
  annotations: Record<string, unknown>
  meta: Record<string, unknown>
  icons?: unknown
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export type McpDescriptorsBundle = {
  tools: McpDescriptorTool[]
  prompts: Array<{ name: string; title: string; description: string }>
  csp: Required<SolvaPayMcpCsp>
  docs: Record<string, unknown>
  bootstrap: Record<string, unknown>
  resource: Record<string, unknown>
}

export function mcpDescriptors(input: McpDescriptorsInput): McpDescriptorsBundle {
  return callMcpSyncOp('mcpDescriptors', input)
}
