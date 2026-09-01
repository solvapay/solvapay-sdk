/**
 * Public descriptor-metadata types and small exported constants.
 *
 * Runtime builders live in Rust (`mcpDescriptors` / `native-mcp`). This
 * file keeps the live TypeScript types plus barrel-exported data that
 * removing would be a breaking change.
 */

import { TOOL_FOR_VIEW } from './types'
import type {
  SolvaPayMcpViewKind,
  SolvaPayMerchantBranding,
  SolvaPayToolAnnotations,
  SolvaPayToolIcon,
} from './types'

/** Frozen validation message for non-http(s) `publicBaseUrl`. */
export const PUBLIC_BASE_URL_ERROR =
  'buildSolvaPayDescriptors: publicBaseUrl must be an http(s) URL (Stripe confirmPayment rejects `ui://`).'

/** Stamp universal `openWorldHint: true` onto per-tool hint flags. */
export function solvapayTool(
  hints: Omit<SolvaPayToolAnnotations, 'openWorldHint'>,
): SolvaPayToolAnnotations {
  return { openWorldHint: true, ...hints }
}

/** Per-view annotation map for intent tools — keep aligned with `TOOL_FOR_VIEW`. */
export const INTENT_TOOL_ANNOTATIONS: Record<keyof typeof TOOL_FOR_VIEW, SolvaPayToolAnnotations> =
  {
    account: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
    topup: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
    checkout: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
  }

/** Tool metadata without `inputSchema` / `handler` (pure registration surface). */
export type ToolDescriptorMetadata = {
  name: string
  title?: string
  description: string
  annotations: SolvaPayToolAnnotations
  meta: Record<string, unknown>
  icons?: SolvaPayToolIcon[]
}

/** Prompt metadata without `argsSchema` / `handler`. */
export type PromptDescriptorMetadata = {
  name: string
  title: string
  description: string
}

export type BuildToolDescriptorMetadataOptions = {
  resourceUri: string
  views?: SolvaPayMcpViewKind[]
  branding?: SolvaPayMerchantBranding
}

export type BuildPromptDescriptorMetadataOptions = {
  views?: SolvaPayMcpViewKind[]
}
