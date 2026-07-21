/**
 * Install native decision / core / MCP dispatch for unit tests
 * (helpers/paywall/adapters import without going through `index.ts`).
 */
import { installNativeCoreApi } from '@solvapay/core'
import { installNativeMcpApi } from '@solvapay/mcp-core'
import { installMcpAdapterNative } from './src/adapters/mcp'
import { callNativeSync, resolveImpl } from './src/native'
import { installNativeDecisionApi } from './src/native-decisions'
import type { PaywallStructuredContent, PaywallToolResult } from './src/types'

installNativeDecisionApi({ callNativeSync, resolveImpl })
installNativeCoreApi({ callNativeSync, resolveImpl })
installNativeMcpApi({ callNativeSync, resolveImpl })
installMcpAdapterNative({
  formatGate: (gate: PaywallStructuredContent): PaywallToolResult | null => {
    if (resolveImpl('mcp') !== 'rust') return null
    return callNativeSync(
      'paywallToolResult',
      JSON.stringify({ message: gate.message, structuredContent: gate }),
    ) as PaywallToolResult
  },
})
