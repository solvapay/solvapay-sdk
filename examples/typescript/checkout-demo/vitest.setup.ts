import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { callNativeSync } from '../../../packages/server/src/native'
import { installNativeCoreApi } from '@solvapay/core'

expect.extend(matchers)

// Core sync helpers are Rust-only — install napi (browser WASM is stubbed).
installNativeCoreApi({ callNativeSync })

afterEach(() => {
  cleanup()
})
