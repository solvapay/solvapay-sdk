/**
 * The set of surfaces the MCP shell can route to. Lives in its own tiny
 * file so any module that needs the discriminated union can import it
 * without cycling through `McpAppShell`.
 *
 * `bootstrap.view` (from the server's `open_*` tool response) is the
 * load-bearing dispatch signal — the shell locks the rendered surface
 * to whatever the bootstrap named for the invocation's lifetime. The
 * only in-session surface mutation is the paywall/nudge CTA → checkout
 * flip, modelled explicitly by the shell's `overrideView` state.
 */
export type McpViewKind = 'checkout' | 'account' | 'topup' | 'paywall' | 'nudge'

/**
 * @deprecated Use `McpViewKind`. This alias exists for one minor
 * version to give internal callers a grace window on the rename; the
 * tab metaphor is gone — the shell is surface-routed now.
 */
export type McpTabKind = McpViewKind
