/**
 * Canonical MCP tool names for the SolvaPay transport + bootstrap tools.
 *
 * Single source of truth for `@solvapay/mcp`, `@solvapay/mcp-sdk`,
 * `@solvapay/react/mcp/adapter`, and any third-party adapter (mcp-lite,
 * fastmcp, etc.). Adding a new tool means editing exactly one file.
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
  getUsage: 'get_usage',
  syncCustomer: 'sync_customer',
  openCheckout: 'open_checkout',
  openAccount: 'open_account',
  openTopup: 'open_topup',
  openPlanActivation: 'open_plan_activation',
  openPaywall: 'open_paywall',
  openUsage: 'open_usage',
} as const

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES]
