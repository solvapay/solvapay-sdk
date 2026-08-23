/**
 * Install native MCP dispatch for standalone `@solvapay/mcp-core` unit tests.
 */
import { callNativeSync } from '@solvapay/server'
import { installNativeMcpApi } from './src/native-mcp'

installNativeMcpApi({ callNativeSync })
