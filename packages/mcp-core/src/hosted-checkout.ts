import { createCheckoutSessionCore, type SolvaPay } from '@solvapay/server'

type McpCheckoutBody = {
  productRef: string
  planRef?: string
  purpose?: 'credit_topup'
}

type McpCheckoutOptions = {
  solvaPay?: SolvaPay
  includeEmail?: boolean
  includeName?: boolean
  returnUrl?: string
}

/**
 * Mint a hosted checkout session from an MCP tool. MCP has no browsable
 * page to return to, so `returnUrl` is always omitted. Callers that pass
 * a URL here would otherwise fall back to the synthetic request origin
 * (`http://solvapay-mcp-server.local/`).
 */
export function createMcpCheckoutSession(
  request: Request,
  body: McpCheckoutBody,
  options: McpCheckoutOptions = {},
) {
  return createCheckoutSessionCore(request, { ...body, returnUrl: null }, options)
}
