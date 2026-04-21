/**
 * `@solvapay/server/mcp` — opinionated helpers for wiring a SolvaPay MCP
 * server in one call instead of hand-rolling ~700 lines of
 * `registerAppTool` boilerplate.
 *
 * @example
 * ```ts
 * import { createSolvaPayMcpServer } from '@solvapay/server/mcp'
 *
 * const server = createSolvaPayMcpServer({
 *   solvaPay,
 *   productRef: 'prd_video',
 *   resourceUri: 'ui://my-app/mcp-app.html',
 *   htmlPath: '/dist/mcp-app.html',
 *   publicBaseUrl: 'https://my-app.example.com',
 *   additionalTools: ({ registerPayable }) => {
 *     registerPayable('create_video', {
 *       schema: z.object({ prompt: z.string() }),
 *       handler: async ({ prompt }) => ({ videoUrl: await generateVideo(prompt) }),
 *     })
 *   },
 * })
 * ```
 */

export { createSolvaPayMcpServer } from './server'
export type {
  CreateSolvaPayMcpServerOptions,
  SolvaPayMcpViewKind,
  SolvaPayMcpCsp,
  AdditionalToolsContext,
} from './server'

export {
  buildSolvaPayRequest,
  defaultGetCustomerRef,
  enrichPurchase,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
export type { BuildSolvaPayRequestOptions } from './helpers'

export { paywallToolResult } from './paywallToolResult'
export type { PaywallToolResultContext } from './paywallToolResult'

export { registerPayableTool } from './registerPayableTool'
export type { RegisterPayableToolOptions } from './registerPayableTool'

export { MCP_TOOL_NAMES } from './tool-names'
export type { McpToolName } from './tool-names'
