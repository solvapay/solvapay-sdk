/**
 * Canonical MCP tool names for the SolvaPay transport + bootstrap tools.
 *
 * Single source of truth for `@solvapay/mcp-core`, `@solvapay/mcp`,
 * `@solvapay/react/mcp/adapter`, and any third-party adapter (fastmcp,
 * raw JSON-RPC, etc.). Adding a new tool means editing exactly one file.
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
  attachBusinessDetails: 'attach_business_details',
  upgrade: 'upgrade',
  manageAccount: 'manage_account',
  topup: 'topup',
} as const

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES]

/**
 * LLM-facing intent tools, derived from `MCP_TOOL_NAMES` so a rename
 * edits exactly one object. Narrators, `TOOL_FOR_VIEW`, and the
 * scaffolder's `INTENT_TOOLS` arrays must stay aligned with this list.
 */
export const INTENT_TOOL_NAMES = [
  MCP_TOOL_NAMES.upgrade,
  MCP_TOOL_NAMES.manageAccount,
  MCP_TOOL_NAMES.topup,
  MCP_TOOL_NAMES.activatePlan,
] as const

export type IntentToolName = (typeof INTENT_TOOL_NAMES)[number]
