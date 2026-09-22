import { describe, expect, it } from 'vitest'
import { buildCensus, classifyFn, DELEGATED_FNS, isCensusFile } from './census.js'

const snapshot = {
  bindings: {
    formatPrice: { artifact: 'payloadBuilders' },
    getMerchant: { artifact: 'client' },
    driveGate: { artifact: 'payloadBuilders' },
  },
}

describe('fixture census', () => {
  it('classifies delegated driver loops, client unbound, and core executed', () => {
    expect(classifyFn('driveGate', snapshot)).toBe('delegated')
    expect(classifyFn('drivePayable', snapshot)).toBe('delegated')
    expect(classifyFn('getMerchant', snapshot)).toBe('executed')
    expect(classifyFn('formatPrice', snapshot)).toBe('executed')
    expect(classifyFn('typoFn', snapshot)).toBe('executed')
  })

  it('counts client fixtures as unbound when replay is disabled', () => {
    expect(classifyFn('getMerchant', snapshot, true)).toBe('unbound')
  })

  it('keeps executed + delegated + unbound disjoint and complete', () => {
    const census = buildCensus(
      [
        { suite: 'client', fn: 'getMerchant' },
        { suite: 'client', fn: 'getMerchant' },
        { suite: 'helpers', fn: 'formatPrice' },
        { suite: 'driver-loop', fn: 'driveGate' },
        { suite: 'driver-loop', fn: 'drivePayable' },
      ],
      snapshot,
    )
    expect(census.parsed).toBe(5)
    expect(census.executed).toBe(3)
    expect(census.delegated).toBe(2)
    expect(census.unbound).toBe(0)
    expect(census.suites).toEqual({ client: 2, 'driver-loop': 2, helpers: 1 })
    expect(DELEGATED_FNS.has('driveGate')).toBe(true)
  })

  it('ignores the census file itself when walking', () => {
    expect(isCensusFile('contract/fixtures/census.generated.json')).toBe(true)
    expect(isCensusFile('contract/fixtures/client/get-merchant/success.json')).toBe(false)
  })
})
