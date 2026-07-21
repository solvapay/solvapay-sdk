/**
 * Sync MCP payload/descriptor delegation layer (Step 37R-d).
 *
 * Install-gated so this module never statically imports `node:module` /
 * `@solvapay/server-native` — Deno/edge/browser stay on TypeScript fallback.
 *
 * Node consumers call `installNativeMcpApi`, or pick up the ambient
 * `Symbol.for('solvapay.nativeSyncApi')` published by `@solvapay/server`.
 * Edge never installs / never publishes.
 */

import {
  buildPromptDescriptorMetadata as buildPromptDescriptorMetadataTs,
  buildPromptUserMessage as buildPromptUserMessageTs,
  buildToolDescriptorMetadata as buildToolDescriptorMetadataTs,
  deriveIcons as deriveIconsTs,
  validatePublicBaseUrl as validatePublicBaseUrlTs,
  type BuildPromptDescriptorMetadataOptions,
  type BuildToolDescriptorMetadataOptions,
  type PromptDescriptorMetadata,
  type ToolDescriptorMetadata,
} from './descriptor-metadata'
import {
  assertResponseResult as assertResponseResultTs,
  makeResponseResult as makeResponseResultTs,
} from './response-envelope'
import { paywallToolResult as paywallToolResultTs } from './paywallToolResult'
import { MCP_TOOL_NAMES, type McpToolName } from './tool-names'
import { TOOL_FOR_VIEW, VIEW_FOR_TOOL } from './types'
import type {
  ContentBlock,
  PaywallToolResult,
  ResponseOptions,
  ResponseResult,
  SolvaPayMerchantBranding,
  SolvaPayPromptResult,
  SolvaPayToolIcon,
} from './types'
import type { PaywallStructuredContent } from '@solvapay/server'
import { PaywallError } from '@solvapay/server'
import type { PaywallToolResultContext } from './paywallToolResult'

export type SolvaPayImpl = 'ts' | 'rust'

export type NativeMcpSyncMethod =
  | 'paywallToolResult'
  | 'makeResponseResult'
  | 'assertResponseResult'
  | 'MCP_TOOL_NAMES'
  | 'mcpViewMaps'
  | 'deriveIcons'
  | 'buildToolDescriptorMetadata'
  | 'buildPromptDescriptorMetadata'
  | 'buildPromptUserMessage'
  | 'validatePublicBaseUrl'

type NativeMcpApi = {
  callNativeSync: (fn: NativeMcpSyncMethod, argsJson: string) => unknown
  resolveImpl: (surface: string) => SolvaPayImpl
}

/** Must match `SOLVAPAY_NATIVE_SYNC_API` in `@solvapay/server` native-registry. */
const AMBIENT_NATIVE_SYNC_API = Symbol.for('solvapay.nativeSyncApi')

let installed: NativeMcpApi | null = null

export function installNativeMcpApi(api: NativeMcpApi): void {
  installed = api
}

/** @internal test helper */
export function resetNativeMcpApiForTests(): void {
  installed = null
  const g = globalThis as typeof globalThis & {
    [AMBIENT_NATIVE_SYNC_API]?: NativeMcpApi
  }
  delete g[AMBIENT_NATIVE_SYNC_API]
}

function readAmbientApi(): NativeMcpApi | null {
  const g = globalThis as typeof globalThis & {
    [AMBIENT_NATIVE_SYNC_API]?: NativeMcpApi
  }
  const api = g[AMBIENT_NATIVE_SYNC_API]
  if (
    api != null &&
    typeof api === 'object' &&
    typeof api.callNativeSync === 'function' &&
    typeof api.resolveImpl === 'function'
  ) {
    return api
  }
  return null
}

function getApi(): NativeMcpApi | null {
  return installed ?? readAmbientApi()
}

function shouldAttemptNative(): boolean {
  try {
    return (
      typeof process !== 'undefined' &&
      typeof process.versions === 'object' &&
      process.versions != null &&
      typeof process.versions.node === 'string' &&
      process.env.SOLVAPAY_IMPL !== 'ts'
    )
  } catch {
    return false
  }
}

function dispatchSync<T>(fn: NativeMcpSyncMethod, args: unknown, tsFallback: () => T): T {
  const api = getApi()
  if (!shouldAttemptNative() || api === null) return tsFallback()
  if (api.resolveImpl('mcp') !== 'rust') return tsFallback()
  return api.callNativeSync(fn, JSON.stringify(args)) as T
}

/**
 * Text-only paywall tool result. Public API stays `async` for call-site
 * compatibility; the delegated core is sync.
 */
export async function paywallToolResult(
  errOrGate: PaywallError | PaywallStructuredContent,
  ctx: PaywallToolResultContext = {},
): Promise<PaywallToolResult> {
  const api = getApi()
  if (!shouldAttemptNative() || api === null || api.resolveImpl('mcp') !== 'rust') {
    return paywallToolResultTs(errOrGate, ctx)
  }

  const paywallContent: PaywallStructuredContent =
    errOrGate instanceof PaywallError ? errOrGate.structuredContent : errOrGate
  const narrationText =
    errOrGate instanceof PaywallError ? errOrGate.message : paywallContent.message

  return api.callNativeSync(
    'paywallToolResult',
    JSON.stringify({ message: narrationText, structuredContent: paywallContent }),
  ) as PaywallToolResult
}

export function makeResponseResult<TData>(
  data: TData,
  options: ResponseOptions | undefined,
  emittedBlocks: ContentBlock[],
): ResponseResult<TData> {
  return dispatchSync(
    'makeResponseResult',
    {
      data,
      ...(options !== undefined ? { options } : {}),
      ...(emittedBlocks.length > 0 ? { emittedBlocks } : {}),
    },
    () => makeResponseResultTs(data, options, emittedBlocks),
  )
}

export function assertResponseResult(value: unknown): ResponseResult<unknown> {
  const api = getApi()
  if (!shouldAttemptNative() || api === null || api.resolveImpl('mcp') !== 'rust') {
    return assertResponseResultTs(value)
  }
  try {
    return api.callNativeSync(
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
  return dispatchSync('MCP_TOOL_NAMES', {}, () => ({ ...MCP_TOOL_NAMES }))
}

/** Fixture-visible combined view maps. */
export function mcpViewMaps(): {
  TOOL_FOR_VIEW: typeof TOOL_FOR_VIEW
  VIEW_FOR_TOOL: typeof VIEW_FOR_TOOL
} {
  return dispatchSync('mcpViewMaps', {}, () => ({
    TOOL_FOR_VIEW: { ...TOOL_FOR_VIEW },
    VIEW_FOR_TOOL: { ...VIEW_FOR_TOOL },
  }))
}

export function deriveIcons(
  branding: SolvaPayMerchantBranding | undefined,
): SolvaPayToolIcon[] | undefined {
  const result = dispatchSync(
    'deriveIcons',
    { branding: branding ?? null },
    () => deriveIconsTs(branding) ?? null,
  )
  return result === null ? undefined : result
}

export function buildToolDescriptorMetadata(
  options: BuildToolDescriptorMetadataOptions,
): ToolDescriptorMetadata[] {
  return dispatchSync('buildToolDescriptorMetadata', options, () =>
    buildToolDescriptorMetadataTs(options),
  )
}

export function buildPromptDescriptorMetadata(
  options: BuildPromptDescriptorMetadataOptions = {},
): PromptDescriptorMetadata[] {
  return dispatchSync('buildPromptDescriptorMetadata', options, () =>
    buildPromptDescriptorMetadataTs(options),
  )
}

export function buildPromptUserMessage(
  promptName: McpToolName,
  args: Record<string, unknown>,
): SolvaPayPromptResult {
  return dispatchSync(
    'buildPromptUserMessage',
    { promptName, args },
    () => buildPromptUserMessageTs(promptName, args),
  )
}

export function validatePublicBaseUrl(publicBaseUrl: string): string | null {
  return dispatchSync(
    'validatePublicBaseUrl',
    { publicBaseUrl },
    () => validatePublicBaseUrlTs(publicBaseUrl),
  )
}
