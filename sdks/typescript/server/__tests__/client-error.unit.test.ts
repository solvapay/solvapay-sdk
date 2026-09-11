import { describe, it, expect } from 'vitest'
import { createSolvaPayClient } from '../src/client'
import { SolvaPayError } from '@solvapay/core'

/**
 * Client construction guard. Upstream HTTP status mapping (`SolvaPayError.status`)
 * is reconstructed from the Rust envelope and covered by
 * `client-native-dispatch.unit.test.ts` / `client-wasm-dispatch.unit.test.ts`
 * plus the `error-model` contract fixtures.
 */
describe('createSolvaPayClient — construction guard', () => {
  it('throws a SolvaPayError (without HTTP status) when apiKey is missing', () => {
    expect(() => createSolvaPayClient({ apiKey: '' })).toThrow(SolvaPayError)
    try {
      createSolvaPayClient({ apiKey: '' })
    } catch (e) {
      expect(e).toBeInstanceOf(SolvaPayError)
      expect((e as SolvaPayError).status).toBeUndefined()
    }
  })
})
