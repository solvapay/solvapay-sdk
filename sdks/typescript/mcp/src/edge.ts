/**
 * Edge entry for `@solvapay/mcp` — same public API as `index.ts` without
 * Node `native-install` or filesystem HTML loading. Consumers must pass
 * `readHtml` or `htmlPath` when constructing a server.
 */

export { createSolvaPayMcpServer } from './server'
export { defaultMcpAppHtml } from './defaultMcpAppHtml.edge'
export type {
  AdditionalToolsContext,
  CreateSolvaPayMcpServerOptions,
  HideToolsByAudienceConfig,
} from './server'

export { registerPayableTool } from './registerPayableTool'
export type { RegisterPayableToolOptions } from './registerPayableTool'

export {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from './internal/extAppsServer'

export type {
  ContentBlock,
  CustomerSnapshot,
  NudgeSpec,
  PayableHandler,
  ResponseContext,
  ResponseOptions,
  ResponseResult,
} from '@solvapay/mcp-core'
