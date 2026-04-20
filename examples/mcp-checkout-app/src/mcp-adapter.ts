/**
 * Thin wrapper around `@solvapay/react/mcp` that adds the example-specific
 * `open_checkout` bootstrap call.
 *
 * Before the React SDK shipped a first-class `createMcpAppAdapter`, this
 * file owned the full transport surface — checking purchases, minting
 * hosted checkout/customer URLs, the `unwrap` helper, tool-name constants.
 * All of that is now re-exported from the SDK; this file only carries the
 * MCP-App-specific pieces (fetching the product ref on boot).
 */

import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createMcpAppAdapter } from '@solvapay/react/mcp'

export { createMcpAppAdapter }

/**
 * Kick off the MCP session and return the product the host opened us for.
 * The SolvaPay backend knows this from the tool registration; the UI just
 * reads it so the correct plan is displayed.
 */
export async function fetchOpenCheckoutProductRef(app: App): Promise<string> {
  const result = await app.callServerTool({ name: 'open_checkout', arguments: {} })
  if ((result as CallToolResult).isError) {
    const first = (result as CallToolResult).content?.[0]
    const message =
      first && 'text' in first && typeof first.text === 'string'
        ? first.text
        : 'open_checkout failed'
    throw new Error(message)
  }
  const structured = (result as CallToolResult).structuredContent as
    | { productRef?: string }
    | undefined
  const ref = structured?.productRef
  if (!ref) throw new Error('Server did not return a productRef')
  return ref
}
