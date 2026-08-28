import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetNativeCoreApiForTests } from '@solvapay/core'

beforeEach(() => {
  resetNativeCoreApiForTests()
})

afterEach(() => {
  cleanup()
})
