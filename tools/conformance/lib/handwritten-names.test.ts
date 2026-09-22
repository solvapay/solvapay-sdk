import { describe, expect, it } from 'vitest'
import type { SdkContractManifest } from '../../shared/manifest-schema.js'
import { checkHandwrittenFacadeNames } from './handwritten-names.js'

function facadeEntry(
  names: SdkContractManifest['facade'][string]['names'],
  omittedC = false,
): SdkContractManifest['facade'][string] {
  return {
    names,
    params: [],
    sync: {
      ts: 'sync',
      py: 'sync',
      rb: 'sync',
      go: 'sync',
      rust: 'sync',
      c: 'sync',
    },
    ...(omittedC
      ? {
          availability: {
            c: {
              omitted: true,
              reason: 'C ABI exposes HTTP operations only; there is no gate facade.',
            },
          },
        }
      : {}),
  }
}

function stub(goCreate: string): SdkContractManifest {
  return {
    facade: {
      createSolvaPay: facadeEntry({
        ts: 'createSolvaPay',
        py: 'create_solvapay',
        rb: 'SolvaPay.create',
        go: goCreate,
        rust: 'Client::new',
        c: 'solvapay_client_new',
      }),
      gate: facadeEntry(
        {
          ts: 'payable.gate',
          py: 'sp.gate',
          rb: 'sp.gate',
          go: 'sp.Gate',
          rust: 'sp.gate',
          c: 'gate',
        },
        true,
      ),
    },
    nameOverrides: {},
  } as unknown as SdkContractManifest
}

describe('checkHandwrittenFacadeNames', () => {
  it('accepts the real Go constructor leaf', () => {
    expect(checkHandwrittenFacadeNames(stub('solvapay.NewClient'))).toEqual([])
  })

  it('skips C when availability omits the symbol', () => {
    const issues = checkHandwrittenFacadeNames(stub('solvapay.NewClient'))
    expect(issues.some(issue => issue.message.includes('.c '))).toBe(false)
  })

  it('flags a stale Go constructor that is not in the hand-written surface', () => {
    const issues = checkHandwrittenFacadeNames(stub('solvapay.ThisSymbolDoesNotExist'))
    expect(issues.some(issue => issue.message.includes('ThisSymbolDoesNotExist'))).toBe(true)
  })
})
