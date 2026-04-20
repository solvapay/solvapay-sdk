/**
 * `@solvapay/react/mcp` — MCP App adapter for the SolvaPay React SDK.
 *
 * Import from `@solvapay/react/mcp` instead of `@solvapay/react` so the
 * `@modelcontextprotocol/ext-apps` peer stays optional for non-MCP
 * consumers:
 *
 * ```tsx
 * import { createMcpAppAdapter } from '@solvapay/react/mcp'
 * ```
 */

export { createMcpAppAdapter } from './adapter'
export type { McpAppLike } from './adapter'
export { MCP_TOOL_NAMES } from './tool-names'
export type { McpToolName } from './tool-names'
