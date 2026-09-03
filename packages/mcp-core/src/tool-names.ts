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
  createHostedSession: 'create_hosted_session',
  setRenewal: 'set_renewal',
  activatePlan: 'activate_plan',
  attachBusinessDetails: 'attach_business_details',
  account: 'account',
} as const

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES]

/**
 * The single read-only viewer that opens checkout / account / topup.
 * All three surfaces share one payload; `view` picks the landing screen.
 */
export const VIEWER_TOOL_NAME = MCP_TOOL_NAMES.account

/**
 * LLM-facing intent tools, derived from `MCP_TOOL_NAMES` so a rename
 * edits exactly one object. Narrators, `TOOL_FOR_VIEW`, and the
 * scaffolder's `INTENT_TOOLS` arrays must stay aligned with this list.
 */
export const INTENT_TOOL_NAMES = [VIEWER_TOOL_NAME, MCP_TOOL_NAMES.activatePlan] as const

export type IntentToolName = (typeof INTENT_TOOL_NAMES)[number]

/**
 * Slash-command prompt names. Independent of the tool catalogue —
 * `/upgrade`, `/manage_account`, and `/topup` remap onto the viewer
 * with the matching `view`. Prompts cost zero tool budget.
 */
export const MCP_PROMPT_NAMES = {
  upgrade: 'upgrade',
  manageAccount: 'manage_account',
  topup: 'topup',
  activatePlan: 'activate_plan',
} as const

export type McpPromptName = (typeof MCP_PROMPT_NAMES)[keyof typeof MCP_PROMPT_NAMES]
