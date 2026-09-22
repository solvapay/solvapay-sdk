/**
 * Install native core dispatch for standalone `@solvapay/core` unit tests.
 * Uses `@solvapay/server` so the native loader stays a package specifier.
 */
import { callNativeSync } from '@solvapay/server'
import { installNativeCoreApi } from './src/native-core'

installNativeCoreApi({ callNativeSync })
