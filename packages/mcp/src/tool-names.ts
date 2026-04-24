/**
 * Canonical MCP tool names for the SolvaPay transport + bootstrap tools.
 *
 * Single source of truth for `@solvapay/mcp`, `@solvapay/mcp-sdk`,
 * `@solvapay/react/mcp/adapter`, and any third-party adapter (mcp-lite,
 * fastmcp, etc.). Adding a new tool means editing exactly one file.
 */
export const MCP_TOOL_NAMES = {
  createPayment: 'create_payment_intent',
  processPayment: 'process_payment',
  createTopupPayment: 'create_topup_payment_intent',
  cancelRenewal: 'cancel_renewal',
  reactivateRenewal: 'reactivate_renewal',
  activatePlan: 'activate_plan',
  createCheckoutSession: 'create_checkout_session',
  createCustomerSession: 'create_customer_session',
  upgrade: 'upgrade',
  manageAccount: 'manage_account',
  topup: 'topup',
} as const

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES]
