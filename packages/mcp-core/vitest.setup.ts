/**
 * Install native MCP dispatch for standalone `@solvapay/mcp-core` unit tests.
 */
import { callNativeSync, resolveImpl } from '../server/src/native'
import { installNativeMcpApi } from './src/native-mcp'

installNativeMcpApi({ callNativeSync, resolveImpl })
