/**
 * Tab kinds the shell knows about. Lives in its own tiny file so
 * both the metadata table (`MCP_TAB_HINTS`) and the tour popover
 * can share the discriminated union without a cycle through the
 * shell component.
 */
export type McpTabKind = 'about' | 'usage' | 'checkout' | 'topup' | 'account' | 'activate'

/**
 * Stable ordering used by the tab strip. About leads because it's
 * the product landing page; Account trails so the sidebar treatment
 * aligns with the header's "who you're paying" framing.
 *
 * `usage` and `activate` remain in the ordering constant so
 * consumers that pin them via the `tabs` prop override still work,
 * but the default visibility rules no longer include them — Credits
 * folds into Account, and Activate merges into Plan.
 */
export const MCP_TAB_ORDER: McpTabKind[] = [
  'about',
  'checkout',
  'topup',
  'account',
  'usage',
  'activate',
]
