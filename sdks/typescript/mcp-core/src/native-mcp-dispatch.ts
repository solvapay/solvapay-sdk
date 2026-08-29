/**
 * Install-gated native MCP dispatch. Generated wrappers import this module
 * so they never close a cycle with `native-mcp.ts` public adapters.
 */

export type NativeMcpSyncMethod =
  | 'paywallToolResult'
  | 'makeResponseResult'
  | 'assertResponseResult'
  | 'buildPayableToolResult'
  | 'invokePayableNext'
  | 'MCP_TOOL_NAMES'
  | 'mcpViewMaps'
  | 'deriveIcons'
  | 'buildToolDescriptorMetadata'
  | 'buildPromptDescriptorMetadata'
  | 'buildPromptUserMessage'
  | 'validatePublicBaseUrl'

type NativeMcpApi = {
  callNativeSync: (fn: NativeMcpSyncMethod | 'solvapayCall', argsJson: string) => unknown
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

function isNativeMcpApi(value: unknown): value is NativeMcpApi {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as NativeMcpApi).callNativeSync === 'function'
  )
}

function readAmbientApi(): NativeMcpApi | null {
  const g = globalThis as typeof globalThis & {
    [AMBIENT_NATIVE_SYNC_API]?: NativeMcpApi
  }
  const api = g[AMBIENT_NATIVE_SYNC_API]
  return isNativeMcpApi(api) ? api : null
}

export function requireApi(): NativeMcpApi {
  const api = installed ?? readAmbientApi()
  if (api === null) {
    throw new Error('SolvaPay native MCP API is not installed')
  }
  return api
}

export function dispatchSync<T>(fn: NativeMcpSyncMethod, args: unknown): T {
  return requireApi().callNativeSync(fn, JSON.stringify(args)) as T
}

/**
 * Client-less MCP op via `solvapayCall`. Throws when no native/WASM API
 * is installed — there is no TypeScript fallback.
 */
export function callMcpSyncOp<T>(op: string, args: unknown): T {
  return requireApi().callNativeSync('solvapayCall', JSON.stringify({ op, args })) as T
}
