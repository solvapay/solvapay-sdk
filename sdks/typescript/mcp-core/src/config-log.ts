/**
 * One-line MCP config summary to stderr, once per process.
 *
 * The message body comes from the Rust `mcpConfigLog` op. The
 * once-per-process guard stays host-side.
 */

import { callMcpSyncOp } from './native-mcp'

let logged = false

export type McpConfigLogInput = {
  apiBaseUrl: string
  productRef: string
  publicBaseUrl: string
}

export function mcpConfigLogMessage(config: McpConfigLogInput): string {
  return callMcpSyncOp<{ message: string }>('mcpConfigLog', {
    apiBaseUrl: config.apiBaseUrl,
    productRef: config.productRef,
    publicBaseUrl: config.publicBaseUrl,
  }).message
}

/**
 * Emit `[solvapay] mcp config …` once. Safe to call from every construction
 * path; subsequent calls are no-ops.
 */
export function logMcpConfigOnce(config: McpConfigLogInput): void {
  if (logged) return
  logged = true
  console.warn(mcpConfigLogMessage(config))
}

/** Test-only: reset the once-per-process guard. */
export function resetMcpConfigLogForTests(): void {
  logged = false
}
