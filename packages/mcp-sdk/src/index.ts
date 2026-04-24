/**
 * `@solvapay/mcp-sdk` — official `@modelcontextprotocol/sdk` +
 * `@modelcontextprotocol/ext-apps` adapter for the SolvaPay MCP
 * toolbox.
 *
 * This is the only SolvaPay package that imports
 * `@modelcontextprotocol/*`. Everything else (tool names, descriptors,
 * paywall meta, OAuth bridge, JWT helpers) lives in `@solvapay/mcp`
 * and can be reused by alternative adapters (`mcp-lite`, `fastmcp`,
 * raw JSON-RPC).
 *
 * @example
 * ```ts
 * import { createSolvaPayMcpServer } from '@solvapay/mcp-sdk'
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

// ---- Merchant-facing types re-exported from @solvapay/mcp ----
// Everything a merchant needs to type a `registerPayable` handler for the
// 90% path. Avoids forcing a second install of `@solvapay/mcp` just to
// annotate `ctx` or hand-author a `NudgeSpec` / `ContentBlock`.
export type {
  ContentBlock,
  CustomerSnapshot,
  NudgeSpec,
  PayableHandler,
  ResponseContext,
  ResponseOptions,
  ResponseResult,
} from '@solvapay/mcp'
