/**
 * Sync MCP payload/descriptor delegation layer.
 *
 * Install-gated so this module never statically imports `node:module` /
 * `@solvapay/server-native`. Node publishes napi dispatch; edge publishes
 * WASM (`solvapayCall`). Uninstalled dispatch throws — no TypeScript fallback.
 *
 * Node consumers call `installNativeMcpApi`, or pick up the ambient
 * `Symbol.for('solvapay.nativeSyncApi')` published by `@solvapay/server`.
 */

import type {
  BuildPromptDescriptorMetadataOptions,
  BuildToolDescriptorMetadataOptions,
  PromptDescriptorMetadata,
  ToolDescriptorMetadata,
} from './descriptor-metadata'
import type { McpToolName } from './tool-names'
import type { PaywallStructuredContent } from '@solvapay/server'
import { PaywallError } from '@solvapay/server'
import type { PaywallToolResultContext } from './paywallToolResult'
import type {
  ContentBlock,
  PaywallToolResult,
  ResponseOptions,
  ResponseResult,
  SolvaPayCallToolResult,
  SolvaPayMerchantBranding,
  SolvaPayPromptResult,
  SolvaPayToolIcon,
} from './types'
import { TOOL_FOR_VIEW, VIEW_FOR_TOOL } from './types'
import {
  callMcpSyncOp,
  dispatchSync,
  installNativeMcpApi,
  requireApi,
  resetNativeMcpApiForTests,
} from './native-mcp-dispatch'

export { callMcpSyncOp, installNativeMcpApi, resetNativeMcpApiForTests }
export type { NativeMcpSyncMethod } from './native-mcp-dispatch'

/**
 * Text-only paywall tool result. Public API stays `async` for call-site
 * compatibility; the delegated core is sync.
 */
export async function paywallToolResult(
  errOrGate: PaywallError | PaywallStructuredContent,
  _ctx: PaywallToolResultContext = {},
): Promise<PaywallToolResult> {
  const paywallContent: PaywallStructuredContent =
    errOrGate instanceof PaywallError ? errOrGate.structuredContent : errOrGate
  const narrationText =
    errOrGate instanceof PaywallError ? errOrGate.message : paywallContent.message

  return requireApi().callNativeSync(
    'paywallToolResult',
    JSON.stringify({ message: narrationText, structuredContent: paywallContent }),
  ) as PaywallToolResult
}

export function makeResponseResult<TData>(
  data: TData,
  options: ResponseOptions | undefined,
  emittedBlocks: ContentBlock[],
): ResponseResult<TData> {
  return dispatchSync('makeResponseResult', {
    data,
    ...(options !== undefined ? { options } : {}),
    ...(emittedBlocks.length > 0 ? { emittedBlocks } : {}),
  })
}

export function assertResponseResult(value: unknown): ResponseResult<unknown> {
  try {
    return requireApi().callNativeSync(
      'assertResponseResult',
      JSON.stringify({ value }),
    ) as ResponseResult<unknown>
  } catch (err) {
    // Fixtures expect plain `Error` name (not SolvaPayError).
    throw new Error(err instanceof Error ? err.message : String(err))
  }
}

/** Fixture-visible accessor; `MCP_TOOL_NAMES` const keeps `as const` identity. */
export function getMcpToolNamesTable(): Record<string, string> {
  return dispatchSync('MCP_TOOL_NAMES', {})
}

/** Fixture-visible combined view maps. */
export function mcpViewMaps(): {
  TOOL_FOR_VIEW: typeof TOOL_FOR_VIEW
  VIEW_FOR_TOOL: typeof VIEW_FOR_TOOL
} {
  return dispatchSync('mcpViewMaps', {})
}

export function deriveIcons(
  branding: SolvaPayMerchantBranding | undefined,
): SolvaPayToolIcon[] | undefined {
  const result = dispatchSync<SolvaPayToolIcon[] | null>('deriveIcons', {
    branding: branding ?? null,
  })
  return result === null ? undefined : result
}

export function buildToolDescriptorMetadata(
  options: BuildToolDescriptorMetadataOptions,
): ToolDescriptorMetadata[] {
  return dispatchSync('buildToolDescriptorMetadata', options)
}

export function buildPromptDescriptorMetadata(
  options: BuildPromptDescriptorMetadataOptions = {},
): PromptDescriptorMetadata[] {
  return dispatchSync('buildPromptDescriptorMetadata', options)
}

export function buildPromptUserMessage(
  promptName: McpToolName,
  args: Record<string, unknown>,
): SolvaPayPromptResult {
  return dispatchSync('buildPromptUserMessage', { promptName, args })
}

export function validatePublicBaseUrl(publicBaseUrl: string): string | null {
  return dispatchSync('validatePublicBaseUrl', { publicBaseUrl })
}

export function invokePayableNext(
  state: unknown | null | undefined,
  event: unknown,
): { state: unknown; action: Record<string, unknown> } {
  return dispatchSync('invokePayableNext', { state: state ?? null, event })
}

/**
 * Allow-path unwrap. Native-only — an uninstalled binding throws (no TS rollback).
 */
export function buildPayableToolResult(envelope: ResponseResult<unknown>): SolvaPayCallToolResult {
  return requireApi().callNativeSync(
    'buildPayableToolResult',
    JSON.stringify({ envelope }),
  ) as SolvaPayCallToolResult
}
