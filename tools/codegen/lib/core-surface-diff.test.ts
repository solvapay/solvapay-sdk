import { describe, expect, it } from 'vitest'
import { classifyCoreSurface, maxBump } from './core-surface-diff.js'

const emptyArtifacts = {
  bindingSymbols: { bindings: {} },
  boundaryTypes: { types: {} },
  sdkContract: { operations: {}, errors: {}, defaults: {} },
  facadeCoverage: { ops: {} },
}

describe('classifyCoreSurface', () => {
  it('classifies an empty diff as no findings', () => {
    expect(classifyCoreSurface(emptyArtifacts, emptyArtifacts)).toEqual([])
    expect(maxBump([])).toBeNull()
  })

  it('treats a removed symbol, required arg, and withdrawn facade as major', () => {
    const findings = classifyCoreSurface(
      {
        bindingSymbols: {
          bindings: {
            listPurchases: {
              names: { ts: 'listPurchases' },
              return: 'value',
              args: [{ name: 'cursor', type: 'string', required: false }],
            },
          },
        },
        boundaryTypes: { types: {} },
        sdkContract: {
          operations: {
            listPurchases: {
              route: { method: 'GET', path: '/v1/sdk/purchases' },
              names: { ts: 'listPurchases' },
              params: [],
              sync: { ts: 'async' },
            },
          },
          errors: { webhook: { codes: ['invalid_signature'] } },
          defaults: {},
        },
        facadeCoverage: { ops: { listPurchases: { typescript: { exposed: true } } } },
      },
      {
        bindingSymbols: { bindings: {} },
        boundaryTypes: { types: {} },
        sdkContract: { operations: {}, errors: { webhook: { codes: [] } }, defaults: {} },
        facadeCoverage: { ops: { listPurchases: { typescript: { exposed: false } } } },
      },
    )
    expect(maxBump(findings)).toBe('major')
    expect(findings.map(item => item.summary)).toEqual(
      expect.arrayContaining([
        'removed symbol `listPurchases`',
        'removed catalog op `listPurchases`',
        'removed error code `webhook.invalid_signature`',
        'withdrew `listPurchases` from facade `typescript`',
      ]),
    )
  })

  it('treats added ops, optional args, defaults, and exposures as minor', () => {
    const findings = classifyCoreSurface(emptyArtifacts, {
      bindingSymbols: {
        bindings: {
          listRefunds: {
            names: { ts: 'listRefunds' },
            return: 'value',
            args: [{ name: 'cursor', type: 'string', required: false }],
          },
        },
      },
      boundaryTypes: { types: {} },
      sdkContract: {
        operations: {
          listRefunds: {
            route: { method: 'POST', path: '/v1/sdk/refunds' },
            names: { ts: 'listRefunds' },
            params: [{ name: 'cursor', required: false }],
            sync: { ts: 'async' },
          },
        },
        errors: { webhook: { codes: ['new_code'] } },
        defaults: { retry: { maxRetries: 3 } },
      },
      facadeCoverage: { ops: { listRefunds: { typescript: { exposed: true } } } },
    })
    expect(maxBump(findings)).toBe('minor')
    expect(findings.map(item => item.summary)).toEqual(
      expect.arrayContaining([
        'added symbol `listRefunds`',
        'added `listRefunds` (POST /v1/sdk/refunds)',
        'added error code `webhook.new_code`',
        'changed frozen `defaults` block',
        'exposed `listRefunds` on facade `typescript`',
      ]),
    )
  })

  it('treats docs-only catalog changes as patch', () => {
    const baseline = {
      ...emptyArtifacts,
      sdkContract: {
        operations: {
          listPurchases: {
            route: { method: 'GET', path: '/v1/sdk/purchases' },
            names: { ts: 'listPurchases' },
            params: [],
            sync: { ts: 'async' },
            docs: { summary: 'old' },
          },
        },
        errors: {},
        defaults: {},
      },
    }
    const current = {
      ...baseline,
      sdkContract: {
        ...baseline.sdkContract,
        operations: {
          listPurchases: {
            route: { method: 'GET', path: '/v1/sdk/purchases' },
            names: { ts: 'listPurchases' },
            params: [],
            sync: { ts: 'async' },
            docs: { summary: 'new' },
          },
        },
      },
    }
    const findings = classifyCoreSurface(baseline, current)
    expect(maxBump(findings)).toBe('patch')
    expect(findings).toEqual([{ bump: 'patch', summary: 'updated docs for `listPurchases`' }])
  })

  it('treats a required input field and removed output field as major', () => {
    const findings = classifyCoreSurface(
      {
        ...emptyArtifacts,
        boundaryTypes: {
          types: {
            CreateReq: {
              serde: 'deserialize',
              shape: { kind: 'struct', fields: [] },
            },
            CreateRes: {
              serde: 'serialize',
              shape: {
                kind: 'struct',
                fields: [{ wireName: 'id', optional: false, ty: { kind: 'string' } }],
              },
            },
          },
        },
      },
      {
        ...emptyArtifacts,
        boundaryTypes: {
          types: {
            CreateReq: {
              serde: 'deserialize',
              shape: {
                kind: 'struct',
                fields: [{ wireName: 'email', optional: false, ty: { kind: 'string' } }],
              },
            },
            CreateRes: {
              serde: 'serialize',
              shape: { kind: 'struct', fields: [] },
            },
          },
        },
      },
    )
    expect(maxBump(findings)).toBe('major')
    expect(findings.map(item => item.summary)).toEqual(
      expect.arrayContaining([
        'added required field `email` to boundary input type `CreateReq`',
        'removed field `id` from boundary output type `CreateRes`',
      ]),
    )
  })
})
