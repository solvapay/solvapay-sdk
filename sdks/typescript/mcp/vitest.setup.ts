/**
 * Install native MCP dispatch for `@solvapay/mcp` unit tests.
 */
import { callNativeSync } from '@solvapay/server'
import { installNativeMcpApi } from '@solvapay/mcp-core'

installNativeMcpApi({ callNativeSync })
