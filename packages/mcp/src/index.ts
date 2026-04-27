/**
 * `@solvapay/mcp` — official `@modelcontextprotocol/sdk` +
 * `@modelcontextprotocol/ext-apps` adapter for the SolvaPay MCP
 * toolbox.
 *
 * This is the only SolvaPay package that imports
 * `@modelcontextprotocol/*`. Everything else (tool names, descriptors,
 * paywall meta, OAuth discovery JSON, JWT helpers) lives in
 * `@solvapay/mcp-core` and can be reused by alternative adapters
 * (`fastmcp`, raw JSON-RPC, …). Runtime-specific OAuth middleware
 * lives on two subpath exports of this package:
 *
 * - `@solvapay/mcp/express` — Node `(req, res, next)` middleware
 *   (`createMcpOAuthBridge`).
 * - `@solvapay/mcp/fetch` — Web-standards `(Request) => Response`
 *   turnkey handler (`createSolvaPayMcpFetch`,
 *   `createSolvaPayMcpFetchHandler`, `createOAuthFetchRouter`) for
 *   Deno / Supabase Edge / Cloudflare Workers / Bun / Next edge /
 *   Vercel Functions.
 *
 * @example
 * ```ts
 * import { createSolvaPayMcpServer } from '@solvapay/mcp'
 * import { z } from 'zod'
 *
 * const server = createSolvaPayMcpServer({
 *   solvaPay,
 *   productRef: 'prd_video',
 *   resourceUri: 'ui://my-app/mcp-app.html',
 *   htmlPath: '/dist/mcp-app.html',
 *   publicBaseUrl: 'https://my-app.example.com',
 *   additionalTools: ({ registerPayable }) => {
 *     registerPayable('create_video', {
 *       schema: { prompt: z.string() },
 *       handler: async ({ prompt }, ctx) =>
 *         ctx.respond({ videoUrl: await generateVideo(prompt) }),
 *     })
 *   },
 * })
 * ```
 */

export { createSolvaPayMcpServer } from './server'
export type {
  AdditionalToolsContext,
  CreateSolvaPayMcpServerOptions,
} from './server'

export { registerPayableTool } from './registerPayableTool'
export type { RegisterPayableToolOptions } from './registerPayableTool'

// ---- Merchant-facing types re-exported from @solvapay/mcp-core ----
// Everything a merchant needs to type a `registerPayable` handler for the
// 90% path. Avoids forcing a second install of `@solvapay/mcp-core` just
// to annotate `ctx` or hand-author a `NudgeSpec` / `ContentBlock`.
export type {
  ContentBlock,
  CustomerSnapshot,
  NudgeSpec,
  PayableHandler,
  ResponseContext,
  ResponseOptions,
  ResponseResult,
} from '@solvapay/mcp-core'
