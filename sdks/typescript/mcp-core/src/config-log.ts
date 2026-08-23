/**
 * One-line MCP config summary to stderr, once per process.
 *
 * Stderr keeps MCP stdio transports' stdout clean. The module-scope guard
 * matters for fetch/edge handlers that reconstruct the bridge per request
 * without memoization.
 */

let logged = false

export type McpConfigLogInput = {
  apiBaseUrl: string
  productRef: string
  publicBaseUrl: string
}

/**
 * Emit `[solvapay] mcp config …` once. Safe to call from every construction
 * path; subsequent calls are no-ops.
 */
export function logMcpConfigOnce(config: McpConfigLogInput): void {
  if (logged) return
  logged = true
  console.warn(
    `[solvapay] mcp config apiBaseUrl=${config.apiBaseUrl} productRef=${config.productRef} publicBaseUrl=${config.publicBaseUrl}`,
  )
}

/** Test-only: reset the once-per-process guard. */
export function resetMcpConfigLogForTests(): void {
  logged = false
}
