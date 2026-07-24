import { expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { callNativeSync } from '../server/src/native'
import { installNativeCoreApi } from '@solvapay/core'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Step 52: React tests install napi — core is Rust-only (no TS fallback).
installNativeCoreApi({ callNativeSync, resolveImpl: () => 'rust' })

const createLocalStorageMock = () => {
  let store: Record<string, string> = {}

  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value)
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: createLocalStorageMock(),
    configurable: true,
  })
})

// Cleanup after each test
afterEach(() => {
  cleanup()
})
