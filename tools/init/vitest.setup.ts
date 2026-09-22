/**
 * Install native core dispatch for `@solvapay/init` unit tests that hit
 * `evaluateProductReadiness`.
 */
import { installNativeCoreApi } from '@solvapay/core'
import { callNativeSync } from '@solvapay/server'

installNativeCoreApi({ callNativeSync })
