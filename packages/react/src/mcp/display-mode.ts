/**
 * MCP Apps display-mode types and host-context readers.
 *
 * Display mode is host state, not routing: the host publishes
 * `displayMode` / `availableDisplayModes` on `McpUiHostContext` and
 * the view requests a switch via `app.requestDisplayMode({ mode })`
 * from a user action. `@solvapay/react/mcp` does not import
 * `@modelcontextprotocol/ext-apps` — these types are structural
 * aliases of that package's `McpUiDisplayMode` /
 * `McpUiAppCapabilities.availableDisplayModes`.
 */

export const MCP_DISPLAY_MODES = ['inline', 'fullscreen', 'pip'] as const

export type McpDisplayMode = (typeof MCP_DISPLAY_MODES)[number]

export interface McpSafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface McpContainerDimensions {
  width?: number
  height?: number
  maxWidth?: number
  maxHeight?: number
}

export interface McpDisplayModeState {
  displayMode: McpDisplayMode
  availableDisplayModes: readonly McpDisplayMode[]
  containerDimensions?: McpContainerDimensions
  safeAreaInsets?: McpSafeAreaInsets
}

/**
 * Capabilities the view advertises on `ui/initialize`. Pass as the
 * second argument to `new App(info, capabilities)` so the host only
 * offers modes this surface can handle. `pip` is excluded — account
 * and checkout are not live sessions.
 */
export const SOLVAPAY_MCP_APP_CAPABILITIES = {
  availableDisplayModes: ['inline', 'fullscreen'] as const satisfies readonly McpDisplayMode[],
}

export const DEFAULT_DISPLAY_MODE_STATE: McpDisplayModeState = {
  displayMode: 'inline',
  availableDisplayModes: [],
}

export function isMcpDisplayMode(value: unknown): value is McpDisplayMode {
  return value === 'inline' || value === 'fullscreen' || value === 'pip'
}

function readInset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Pull display-mode fields out of a host-context object. Unknown or
 * missing values fall back to {@link DEFAULT_DISPLAY_MODE_STATE} —
 * never invent a mode the host did not advertise.
 */
export function readDisplayModeState(ctx: unknown): McpDisplayModeState {
  if (!ctx || typeof ctx !== 'object') {
    return DEFAULT_DISPLAY_MODE_STATE
  }

  const record = ctx as Record<string, unknown>
  const displayMode = isMcpDisplayMode(record.displayMode) ? record.displayMode : 'inline'

  const rawModes = record.availableDisplayModes
  const availableDisplayModes = Array.isArray(rawModes) ? rawModes.filter(isMcpDisplayMode) : []

  const rawDimensions = record.containerDimensions
  let containerDimensions: McpContainerDimensions | undefined
  if (rawDimensions && typeof rawDimensions === 'object') {
    const dims = rawDimensions as Record<string, unknown>
    const next: McpContainerDimensions = {
      width: readDimension(dims.width),
      height: readDimension(dims.height),
      maxWidth: readDimension(dims.maxWidth),
      maxHeight: readDimension(dims.maxHeight),
    }
    if (
      next.width !== undefined ||
      next.height !== undefined ||
      next.maxWidth !== undefined ||
      next.maxHeight !== undefined
    ) {
      containerDimensions = next
    }
  }

  const rawInsets = record.safeAreaInsets
  let safeAreaInsets: McpSafeAreaInsets | undefined
  if (rawInsets && typeof rawInsets === 'object') {
    const insets = rawInsets as Record<string, unknown>
    safeAreaInsets = {
      top: readInset(insets.top),
      right: readInset(insets.right),
      bottom: readInset(insets.bottom),
      left: readInset(insets.left),
    }
  }

  return {
    displayMode,
    availableDisplayModes,
    ...(containerDimensions ? { containerDimensions } : {}),
    ...(safeAreaInsets ? { safeAreaInsets } : {}),
  }
}

/**
 * Host composer / device insets as root-container padding.
 *
 * Read `hostContext.safeAreaInsets`, not `env(safe-area-inset-*)` —
 * inside a sandboxed iframe the env() values are the device's, and
 * the host composer is what actually overlaps us. Zero when the host
 * reports nothing; adding zero is harmless.
 */
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
