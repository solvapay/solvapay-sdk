import { describe, expect, it } from 'vitest'
import { parseArgs, suggestBindingStub } from './gen-bindings.js'
import { deriveNames, type SdkContractManifest } from './lib/manifest-schema.js'

function opsOnly(operations: SdkContractManifest['operations']): SdkContractManifest {
  return { operations, bindings: {} } as SdkContractManifest
}

describe('gen-bindings', () => {
  it('parses --fix / --suggest', () => {
    expect(parseArgs(['--fix']).mode).toBe('fix')
    expect(parseArgs(['--suggest']).mode).toBe('suggest')
    expect(parseArgs([]).mode).toBe('suggest')
  })

  it('suggests clientAwait for body-only ops', () => {
    const stub = suggestBindingStub(
      opsOnly({
        checkLimits: {
          route: { method: 'POST', path: '/v1/sdk/limits' },
          names: deriveNames('checkLimits'),
          optionalOnClient: false,
          request: 'CheckLimitsRequest',
          response: 'LimitResponseWithPlan',
          params: [{ name: 'params', ref: 'CheckLimitsRequest', required: true }],
          overlays: [],
          normalization: [],
          shadow: { volatile: [] },
          idempotency: { kind: 'none' },
          errors: { default: { messageTemplate: 'x' }, cases: [] },
          sync: {
            ts: 'async',
            py: ['async', 'blocking'],
            rb: 'blocking',
            go: 'blocking',
            rust: ['async', 'blocking'],
          },
          docs: { summary: 'Check limits.', params: {} },
        },
      }),
      'checkLimits',
      0,
    )
    expect(stub.call).toEqual({ kind: 'wrap', serialize: 'clientAwait' })
    expect(stub.dtoType).toBe('CheckLimitsRequest')
    expect(stub.splitPathRefs).toEqual([])
  })

  it('suggests clientSplit for path-ref ops', () => {
    const stub = suggestBindingStub(
      opsOnly({
        cloneProduct: {
          route: { method: 'POST', path: '/v1/sdk/products/{productRef}/clone' },
          names: deriveNames('cloneProduct'),
          optionalOnClient: false,
          request: 'CloneProductOverrides',
          response: 'Product',
          params: [
            { name: 'productRef', type: 'string', required: true },
            { name: 'overrides', ref: 'CloneProductOverrides', required: false },
          ],
          overlays: [],
          normalization: [],
          shadow: { volatile: [] },
          idempotency: { kind: 'none' },
          errors: { default: { messageTemplate: 'x' }, cases: [] },
          sync: {
            ts: 'async',
            py: ['async', 'blocking'],
            rb: 'blocking',
            go: 'blocking',
            rust: ['async', 'blocking'],
          },
          docs: { summary: 'Clone a product.', params: {} },
        },
      }),
      'cloneProduct',
      1,
    )
    expect(stub.call).toEqual({ kind: 'wrap', serialize: 'clientSplit' })
    expect(stub.splitPathRefs).toEqual(['productRef'])
    expect(stub.clientCallArgs).toEqual(['&refs[0]', 'Some(overrides)'])
  })
})
