/**
 * The set of surfaces the MCP shell can route to. Lives in its own tiny
 * file so any module that needs the discriminated union can import it
 * without cycling through `McpAppShell`.
 *
 * `bootstrap.view` (from the server's `open_*` tool response) is the
 * load-bearing dispatch signal — the shell locks the rendered surface
 * to whatever the bootstrap named for the invocation's lifetime.
 *
 * The `paywall` / `nudge` kinds were removed as part of the text-only
 * paywall refactor: merchant paywall / nudge responses are plain text
 * narrations now, not widget surfaces. The iframe is only mounted for
 * the three deliberate intent tools.
 */
export type McpViewKind = 'checkout' | 'account' | 'topup'

/**
 * @deprecated Use `McpViewKind`. This alias exists for one minor
 * version to give internal callers a grace window on the rename; the
 * tab metaphor is gone — the shell is surface-routed now.
 */
export type McpTabKind = McpViewKind
