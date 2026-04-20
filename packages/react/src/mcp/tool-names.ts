/**
 * Canonical MCP tool names used by `createMcpAppAdapter` and any SolvaPay
 * MCP server that wants to expose the standard React-SDK transport surface.
 *
 * Re-exported from `@solvapay/react/mcp` so client and server share a single
 * source of truth and adding a method never requires editing two files.
 */

export const MCP_TOOL_NAMES = {
  checkPurchase: 'check_purchase',
  createPayment: 'create_payment_intent',
  processPayment: 'process_payment',
  createTopupPayment: 'create_topup_payment_intent',
  getBalance: 'get_customer_balance',
  cancelRenewal: 'cancel_renewal',
  reactivateRenewal: 'reactivate_renewal',
  activatePlan: 'activate_plan',
  createCheckoutSession: 'create_checkout_session',
  createCustomerSession: 'create_customer_session',
  getMerchant: 'get_merchant',
  getProduct: 'get_product',
  listPlans: 'list_plans',
  getPaymentMethod: 'get_payment_method',
} as const

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES]
