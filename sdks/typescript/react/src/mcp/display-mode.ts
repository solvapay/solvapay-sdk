/**
 * MCP Apps display-mode types. Decision logic lives in Rust
 * (`resolveDisplayMode`); this module re-exports the host snapshot shape.
 */

import { resolveDisplayMode } from '@solvapay/core'

export const MCP_DISPLAY_MODES = ['inline', 'fullscreen', 'pip'] as const

export type McpDisplayMode = (typeof MCP_DISPLAY_MODES)[number]

export type McpDisplayModeState = ReturnType<typeof resolveDisplayMode>

export type McpSafeAreaInsets = NonNullable<McpDisplayModeState['safeAreaInsets']>

export type McpContainerDimensions = NonNullable<McpDisplayModeState['containerDimensions']>

export const DEFAULT_DISPLAY_MODE_STATE: McpDisplayModeState = {
  displayMode: 'inline',
  availableDisplayModes: [],
  hostedRail: 'inline',
}

export const SOLVAPAY_MCP_APP_CAPABILITIES = {
  availableDisplayModes: ['inline', 'fullscreen'] as const satisfies readonly McpDisplayMode[],
}

export const MCP_HOSTED_MIN_WIDTH = 1000

export type McpHostedRail = 'hosted' | 'inline' | 'widget'

export function isMcpDisplayMode(value: unknown): value is McpDisplayMode {
  return MCP_DISPLAY_MODES.some(mode => mode === value)
}

export function readDisplayModeState(ctx: unknown): McpDisplayModeState {
  return resolveDisplayMode(ctx)
}

export function resolveHostedRail(state: Pick<McpDisplayModeState, 'displayMode'>): McpHostedRail {
  return state.displayMode === 'fullscreen' ? 'hosted' : 'inline'
}

export function hostWidthPx(dimensions: McpContainerDimensions | undefined): number | undefined {
  const candidates = [dimensions?.width, dimensions?.maxWidth].filter(
    (value): value is number => value !== undefined,
  )
  if (candidates.length === 0) return undefined
  return Math.min(...candidates)
}

export function hostSafeAreaPadding(insets: McpSafeAreaInsets | undefined): {
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
} {
  return {
    paddingTop: insets?.top ?? 0,
    paddingRight: insets?.right ?? 0,
    paddingBottom: insets?.bottom ?? 0,
    paddingLeft: insets?.left ?? 0,
  }
}
