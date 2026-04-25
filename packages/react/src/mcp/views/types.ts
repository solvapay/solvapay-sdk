/**
 * Per-element className overrides for `<Mcp*View>` primitives.
 *
 * Mirrors the `CurrentPlanCardClassNames` pattern — every key is optional,
 * and any empty string falls through to the default `solvapay-mcp-*` class
 * defined in `@solvapay/react/mcp/styles.css`. Integrators who ship their
 * own CSS can disable defaults per-slot by assigning `''`.
 */
export interface McpViewClassNames {
  card?: string
  stack?: string
  heading?: string
  muted?: string
  button?: string
  linkButton?: string
  notice?: string
  error?: string
  awaitingHeader?: string
  balanceRow?: string
  amountPicker?: string
  amountOptions?: string
  amountOption?: string
  amountCustom?: string
  topupForm?: string
  activationFlow?: string
  /** Root wrapper of `<AppHeader>` (icon + merchant name row). */
  appHeader?: string
  /** `<img>` element showing the merchant's icon/logo. */
  appHeaderIcon?: string
  /** Initials fallback bubble when no icon / logo URL resolves. */
  appHeaderInitials?: string
  /** `<span>` wrapping the merchant's display name. */
  appHeaderName?: string
}

export const DEFAULT_MCP_CLASS_NAMES: Required<McpViewClassNames> = {
  card: 'solvapay-mcp-card',
  stack: 'solvapay-mcp-stack',
  heading: 'solvapay-mcp-heading',
  muted: 'solvapay-mcp-muted',
  button: 'solvapay-mcp-button',
  linkButton: 'solvapay-mcp-link-button',
  notice: 'solvapay-mcp-notice',
  error: 'solvapay-mcp-error',
  awaitingHeader: 'solvapay-mcp-awaiting-header',
  balanceRow: 'solvapay-mcp-balance-row',
  amountPicker: 'solvapay-mcp-amount-picker',
  amountOptions: 'solvapay-mcp-amount-options',
  amountOption: 'solvapay-mcp-amount-option',
  amountCustom: 'solvapay-mcp-amount-custom',
  topupForm: 'solvapay-mcp-topup-form',
  activationFlow: 'solvapay-mcp-activation-flow',
  appHeader: 'solvapay-mcp-app-header',
  appHeaderIcon: 'solvapay-mcp-app-header-icon',
  appHeaderInitials: 'solvapay-mcp-app-header-initials',
  appHeaderName: 'solvapay-mcp-app-header-name',
}

/**
 * Resolve a `McpViewClassNames` partial against the defaults — consumer
 * overrides win when defined, empty strings disable a slot's class entirely,
 * unset keys fall through to the default.
 */
export function resolveMcpClassNames(
  overrides: McpViewClassNames | undefined,
): Required<McpViewClassNames> {
  if (!overrides) return DEFAULT_MCP_CLASS_NAMES
  const out = { ...DEFAULT_MCP_CLASS_NAMES }
  for (const key of Object.keys(overrides) as Array<keyof McpViewClassNames>) {
    const value = overrides[key]
    if (value !== undefined) out[key] = value
  }
  return out
}
