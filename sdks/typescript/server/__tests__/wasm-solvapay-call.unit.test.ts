import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import {
  callWasmSync,
  publishWasmSyncApi,
  resetWasmCache,
  setWasmBindingForTests,
} from '../src/wasm'

describe('WASM solvapayCall', () => {
  beforeEach(() => {
    resetWasmCache()
  })

  afterEach(() => {
    resetWasmCache()
  })

  it('dispatches mcpMergeCsp through solvapayCall with no TypeScript fallback', () => {
    setWasmBindingForTests({
      ready: async () => undefined,
      verifyWebhook: () => '',
      solvapayCall: argsJson => {
        const parsed: unknown = JSON.parse(argsJson)
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('op' in parsed) ||
          (parsed as { op: unknown }).op !== 'mcpMergeCsp'
        ) {
          throw new Error('ts fallback must not run')
        }
        return JSON.stringify({
          ok: true,
          value: {
            resourceDomains: ['https://js.stripe.com'],
            connectDomains: ['https://api.stripe.com'],
            frameDomains: ['https://js.stripe.com'],
          },
        })
      },
    })
    publishWasmSyncApi()
    const value = callWasmSync('solvapayCall', JSON.stringify({ op: 'mcpMergeCsp', args: {} }))
    expect(value).toEqual({
      resourceDomains: ['https://js.stripe.com'],
      connectDomains: ['https://api.stripe.com'],
      frameDomains: ['https://js.stripe.com'],
    })
  })

  it('throws when solvapayCall is missing from the binding', () => {
    setWasmBindingForTests({
      ready: async () => undefined,
      verifyWebhook: () => '',
    })
    expect(() =>
      callWasmSync('solvapayCall', JSON.stringify({ op: 'mcpMergeCsp', args: {} })),
    ).toThrow(SolvaPayError)
  })
})
