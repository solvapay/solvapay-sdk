/**
 * Install native decision / core / MCP dispatch for unit tests
 * (helpers/paywall/adapters import without going through `index.ts`).
 */
import { installNativeCoreApi } from '@solvapay/core'
import { installNativeMcpApi } from '@solvapay/mcp-core'
import { installMcpAdapterNative } from './src/adapters/mcp'
import { callNativeSync } from './src/native'
import { installNativeDecisionApi } from './src/native-decisions'
import { publishNativeSyncApi } from './src/native-registry'
import type { PaywallStructuredContent, PaywallToolResult } from './src/types'

installNativeDecisionApi({ callNativeSync })
publishNativeSyncApi()
installNativeCoreApi({ callNativeSync })
installNativeMcpApi({ callNativeSync })
installMcpAdapterNative({
  formatGate: (gate: PaywallStructuredContent): PaywallToolResult =>
    callNativeSync(
      'paywallToolResult',
      JSON.stringify({ message: gate.message, structuredContent: gate }),
    ) as PaywallToolResult,
})
