/**
 * Install native core dispatch for standalone `@solvapay/core` unit tests.
 * Uses a relative import into server's native loader (dev-only; not a runtime dep).
 */
import { callNativeSync } from '../server/src/native'
import { installNativeCoreApi } from './src/native-core'

installNativeCoreApi({ callNativeSync })
