/**
 * Narrated overview for the SolvaPay MCP server — served at
 * `docs://solvapay/overview.md` from the Rust `mcpOverviewResource` op.
 */

import { callMcpSyncOp } from '../native-mcp'

export const SOLVAPAY_OVERVIEW_URI = 'docs://solvapay/overview.md'
export const SOLVAPAY_OVERVIEW_MIME_TYPE = 'text/markdown'

/** Overview markdown from the Rust `mcpOverviewResource` op. */
export function solvapayOverviewBody(): string {
  return callMcpSyncOp<{ body: string }>('mcpOverviewResource', {}).body
}
