import { z } from 'zod'
import type { AdditionalToolsContext } from '@solvapay/mcp'

/**
 * `__TOOL_NAME__` — placeholder paid MCP tool.
 *
 * Replace the description, schema, and handler with your real business
 * logic. `c.respond(...)` handles paywall enforcement (per-call charge
 * against the `SOLVAPAY_PRODUCT_REF` you configured), narration, and the
 * MCP response envelope — your handler only owns the business logic.
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
    description:
      'Placeholder paid tool — echoes the input message so you can verify the paywall is wired before writing real logic. 1 credit per call; when gated, text-only narration names `account` (or `activate_plan` when a planRef is known).',
    schema: {
      message: z.string().describe('What the caller wants').optional(),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
    handler: async (input, c) => {
      const data = { ok: true, echoed: input.message ?? 'hello' }
      return c.respond(data, {
        text: '__TOOL_NAME__ ran (placeholder). Replace this tool with your business logic.',
      })
    },
  })
}
