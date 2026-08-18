/**
 * Vendored subset of `@modelcontextprotocol/ext-apps/server` — the three
 * symbols `@solvapay/mcp` needs until ext-apps ships a v2-compatible build.
 * Logic mirrors upstream `registerAppTool` / `registerAppResource` /
 * `RESOURCE_MIME_TYPE` (ext-apps@1.7.5).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type {
  CacheHint,
  CallToolResult,
  Icon,
  ReadResourceCallback,
  ReadResourceResult,
  RegisteredResource,
  RegisteredTool,
  ResourceMetadata,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
} from '@modelcontextprotocol/server'

/** Legacy flat `_meta` key for UI resource URIs on pre-2026-01-26 hosts. */
export const RESOURCE_URI_META_KEY = 'ui/resourceUri'

/** MIME type every MCP Apps UI resource must advertise. */
export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'

// `registerTool` and `registerResource` are both overloaded, and `Parameters<>`
// resolves to the *last* overload — the deprecated raw-shape `registerTool` and
// the `ResourceTemplate` `registerResource`. Both signatures below therefore
// restate the modern overload: schemas are Standard Schema (`z.object(...)`),
// and MCP Apps UI resources always use a fixed `ui://` string URI.
type RegisterAppToolConfig<
  InputArgs extends StandardSchemaWithJSON | undefined,
  OutputArgs extends StandardSchemaWithJSON,
> = {
  title?: string
  description?: string
  inputSchema?: InputArgs
  outputSchema?: OutputArgs
  annotations?: ToolAnnotations
  icons?: Icon[]
  _meta?: Record<string, unknown>
}

type RegisterAppResourceConfig = ResourceMetadata & { cacheHint?: CacheHint }

/**
 * Register a tool that may open an MCP Apps iframe. Normalises
 * `_meta.ui.resourceUri` ↔ legacy `_meta["ui/resourceUri"]`.
 */
export function registerAppTool<
  OutputArgs extends StandardSchemaWithJSON,
  InputArgs extends StandardSchemaWithJSON | undefined = undefined,
>(
  server: McpServer,
  name: string,
  config: RegisterAppToolConfig<InputArgs, OutputArgs>,
  handler: ToolCallback<InputArgs>,
): RegisteredTool {
  const meta = config._meta as Record<string, unknown> | undefined
  const ui = meta?.ui as Record<string, unknown> | undefined
  const legacyUri = meta?.[RESOURCE_URI_META_KEY]
  let mergedMeta = meta

  if (ui?.resourceUri && !legacyUri) {
    mergedMeta = { ...meta, [RESOURCE_URI_META_KEY]: ui.resourceUri }
  } else if (legacyUri && !ui?.resourceUri) {
    mergedMeta = { ...meta, ui: { ...ui, resourceUri: legacyUri } }
  }

  return server.registerTool(
    name,
    mergedMeta === meta ? config : { ...config, _meta: mergedMeta },
    handler,
  )
}

/** Register an MCP Apps UI resource with the canonical MIME type default. */
export function registerAppResource(
  server: McpServer,
  name: string,
  uri: string,
  config: RegisterAppResourceConfig,
  handler: ReadResourceCallback,
): RegisteredResource {
  return server.registerResource(name, uri, { mimeType: RESOURCE_MIME_TYPE, ...config }, handler)
}

export type { CallToolResult, ReadResourceResult }
