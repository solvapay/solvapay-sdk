import { z } from 'zod'
import type { AdditionalToolsContext } from '@solvapay/mcp'

/**
 * `__TOOL_NAME__` — placeholder paid MCP tool.
 *
 * Replace the body with your real upstream call. The `ctx.respond(...)`
 * helper handles paywall enforcement (per-call charge against the
 * `SOLVAPAY_PRODUCT_REF` you configured), narration, and the MCP
 * response envelope — your handler only owns the business logic.
 *
 * If you need to call an external HTTP API, import the shipped helper:
 *
 *   import { upstreamFetchJson } from '../lib/upstreamFetch'
 *
 * It sends `Accept: application/json`, throws `UpstreamError` on non-2xx
 * or non-JSON responses, and carries `{ status, contentType, bodySnippet }`
 * on the thrown error so the MCP `isError` envelope tells the LLM (and
 * the human) exactly why upstream rejected the call.
 */
export function register__TOOL_NAME_PASCAL__(ctx: AdditionalToolsContext): void {
  ctx.registerPayable('__TOOL_NAME__', {
    title: '__TOOL_NAME__',
    description: 'TODO: describe what this tool does for the LLM.',
    schema: {
      // Sample input; replace with whatever your tool needs.
      message: z.string().describe('What the caller wants').optional(),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
    handler: async (input, c) => {
      // TODO: replace this stub with your real business logic.
      const data = { ok: true, echoed: input.message ?? 'hello' }
      return c.respond(data, { text: '__TOOL_NAME__ ran (placeholder).' })
    },
  })
}
