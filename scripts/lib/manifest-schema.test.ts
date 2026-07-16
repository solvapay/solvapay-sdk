import { describe, expect, it } from 'vitest'
import {
  EXPECTED_OPERATION_COUNT,
  EXPECTED_TOP_LEVEL_IDS,
  SdkContractManifestSchema,
  assertNameCorrectness,
  assertNameCoverage,
  assertNoNameCollisions,
  assertOperationCount,
  assertTopLevelSet,
  crossCheckOpenApi,
  deriveNames,
  type OpenApiSnapshot,
  type SdkContractManifest,
} from './manifest-schema.js'

const DEFAULT_SYNC = {
  ts: 'async' as const,
  py: ['async', 'blocking'] as ('async' | 'blocking')[],
  rb: 'blocking' as const,
  go: 'blocking' as const,
  rust: ['async', 'blocking'] as ('async' | 'blocking')[],
}

const PURE_SYNC = {
  ts: 'sync' as const,
  py: 'sync' as const,
  rb: 'sync' as const,
  go: 'sync' as const,
  rust: 'sync' as const,
}

function op(
  id: string,
  overrides: Partial<SdkContractManifest['operations'][string]> = {},
): SdkContractManifest['operations'][string] {
  const names = deriveNames(id)
  return {
    route: { method: 'POST', path: '/v1/sdk/limits' },
    names,
    optionalOnClient: false,
    request: 'CheckLimitRequest',
    response: 'LimitResponse',
    overlays: [],
    normalization: [],
    idempotency: { kind: 'none' },
    errors: {
      default: { messageTemplate: 'Check limits failed ({status}): {body}' },
      cases: [],
    },
    sync: DEFAULT_SYNC,
    ...overrides,
  }
}

function minimalManifest(
  overrides: Partial<SdkContractManifest> = {},
): SdkContractManifest {
  const operations: SdkContractManifest['operations'] = {}
  for (let i = 0; i < EXPECTED_OPERATION_COUNT; i += 1) {
    const id = i === 0 ? 'checkLimits' : `op${String(i).padStart(2, '0')}`
    operations[id] = op(id, {
      route: { method: 'GET', path: `/v1/sdk/paths/${id}` },
      request: undefined,
      response: 'LimitResponse',
    })
  }

  const topLevel: SdkContractManifest['topLevel'] = {}
  for (const id of EXPECTED_TOP_LEVEL_IDS) {
    topLevel[id] = { names: deriveNames(id), sync: PURE_SYNC }
  }

  const base: SdkContractManifest = {
    operations,
    topLevel,
    coreHelpers: {
      validateBusinessDetails: { names: deriveNames('validateBusinessDetails'), sync: PURE_SYNC },
    },
    facade: {
      createSolvaPay: { names: deriveNames('createSolvaPay'), sync: PURE_SYNC },
      createSolvaPayClient: { names: deriveNames('createSolvaPayClient'), sync: PURE_SYNC },
      payable: { names: deriveNames('payable'), sync: PURE_SYNC },
      protect: { names: deriveNames('protect'), sync: PURE_SYNC },
      gate: {
        names: {
          ts: 'payable.gate',
          py: 'sp.gate',
          rb: 'sp.gate',
          go: 'sp.Gate',
          rust: 'sp.gate',
        },
        sync: DEFAULT_SYNC,
      },
    },
    errors: {
      webhook: {
        codes: [
          'missing_signature',
          'malformed_signature',
          'timestamp_too_old',
          'invalid_signature',
          'invalid_payload',
        ],
      },
    },
    defaults: {
      retry: { maxRetries: 2, initialDelayMs: 500, backoff: 'fixed' },
      webhookToleranceSec: 300,
      limitsCacheTTLMs: 10000,
      idempotencyKeyFormats: {
        payment: 'payment-{planRef}-{epochMs}-{random9}',
        topup: 'topup-{epochMs}-{random9}',
      },
      goContextFirstParam: true,
    },
    nameOverrides: {
      gate: {
        ts: 'payable.gate',
        py: 'sp.gate',
        rb: 'sp.gate',
        go: 'sp.Gate',
        rust: 'sp.gate',
      },
    },
    reservedWords: { go: [], py: [], rb: [], rust: [], ts: [] },
  }

  return {
    ...base,
    ...overrides,
    operations: overrides.operations ?? base.operations,
    topLevel: overrides.topLevel ?? base.topLevel,
    coreHelpers: overrides.coreHelpers ?? base.coreHelpers,
    facade: overrides.facade ?? base.facade,
    nameOverrides: overrides.nameOverrides ?? base.nameOverrides,
  }
}

describe('deriveNames', () => {
  it('maps camelCase operation ids to per-language idioms', () => {
    expect(deriveNames('checkLimits')).toEqual({
      ts: 'checkLimits',
      py: 'check_limits',
      rb: 'check_limits',
      go: 'CheckLimits',
      rust: 'check_limits',
    })
  })

  it('handles multi-segment ids and acronyms as plain camelCase splits', () => {
    expect(deriveNames('createSolvaPayClient')).toEqual({
      ts: 'createSolvaPayClient',
      py: 'create_solva_pay_client',
      rb: 'create_solva_pay_client',
      go: 'CreateSolvaPayClient',
      rust: 'create_solva_pay_client',
    })
  })
})

describe('SdkContractManifestSchema', () => {
  it('accepts a valid minimal manifest', () => {
    const result = SdkContractManifestSchema.safeParse(minimalManifest())
    expect(result.success).toBe(true)
  })

  it('rejects an operation missing a language name', () => {
    const manifest = minimalManifest()
    manifest.operations.checkLimits = op('checkLimits', {
      names: {
        ts: 'checkLimits',
        py: 'check_limits',
        rb: 'check_limits',
        go: '',
        rust: 'check_limits',
      },
    })
    const result = SdkContractManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
  })
})

describe('coverage and collisions', () => {
  it('passes coverage when every entry has five non-empty names', () => {
    const issues = assertNameCoverage(minimalManifest())
    expect(issues).toEqual([])
  })

  it('fails coverage when a go name is missing', () => {
    const manifest = minimalManifest()
    manifest.operations.checkLimits.names.go = ''
    const issues = assertNameCoverage(manifest)
    expect(issues.some(i => /checkLimits/.test(i) && /go/.test(i))).toBe(true)
  })

  it('fails name correctness when a derived name is wrong without override', () => {
    const manifest = minimalManifest()
    manifest.operations.checkLimits.names.py = 'checkLimitsWrong'
    const issues = assertNameCorrectness(manifest)
    expect(issues.some(i => /checkLimits/.test(i) && /py/.test(i))).toBe(true)
  })

  it('allows declared nameOverrides', () => {
    const manifest = minimalManifest()
    const issues = assertNameCorrectness(manifest)
    expect(issues.filter(i => i.includes('gate'))).toEqual([])
  })

  it('fails on duplicate derived names within a language', () => {
    const manifest = minimalManifest()
    manifest.operations.op01.names.ts = 'checkLimits'
    const issues = assertNoNameCollisions(manifest)
    expect(issues.some(i => /collision/i.test(i) && /ts/.test(i))).toBe(true)
  })

  it('requires exactly 36 operations', () => {
    const manifest = minimalManifest()
    delete manifest.operations.op35
    expect(assertOperationCount(manifest).some(i => /36/.test(i))).toBe(true)
  })

  it('requires the expected topLevel id set', () => {
    const manifest = minimalManifest()
    delete manifest.topLevel.verifyWebhook
    const issues = assertTopLevelSet(manifest)
    expect(issues.some(i => /verifyWebhook/.test(i))).toBe(true)
  })
})

describe('crossCheckOpenApi', () => {
  it('passes when routes and non-overlay DTOs exist', () => {
    const manifest = minimalManifest({
      operations: {
        checkLimits: op('checkLimits', {
          route: { method: 'POST', path: '/v1/sdk/limits' },
          request: 'CheckLimitRequest',
          response: 'LimitResponse',
        }),
        ...Object.fromEntries(
          Array.from({ length: EXPECTED_OPERATION_COUNT - 1 }, (_, i) => {
            const id = `op${String(i + 1).padStart(2, '0')}`
            return [
              id,
              op(id, {
                route: { method: 'GET', path: '/v1/sdk/merchant' },
                request: undefined,
                response: 'LimitResponse',
              }),
            ]
          }),
        ),
      },
    })

    const snapshot: OpenApiSnapshot = {
      paths: {
        '/v1/sdk/limits': { post: {} },
        '/v1/sdk/merchant': { get: {} },
      },
      components: {
        schemas: {
          CheckLimitRequest: {},
          LimitResponse: {},
        },
      },
    }

    expect(crossCheckOpenApi(manifest, snapshot)).toEqual([])
  })

  it('fails on unknown routes', () => {
    const manifest = minimalManifest()
    const snapshot: OpenApiSnapshot = {
      paths: {},
      components: { schemas: { LimitResponse: {} } },
    }
    const issues = crossCheckOpenApi(manifest, snapshot)
    expect(issues.some(i => /route/i.test(i))).toBe(true)
  })

  it('skips overlay DTO refs listed in overlays', () => {
    const manifest = minimalManifest({
      operations: {
        checkLimits: op('checkLimits', {
          route: { method: 'POST', path: '/v1/sdk/limits' },
          request: 'CheckLimitsRequest',
          response: 'LimitResponseWithPlan',
          overlays: ['includeCheckoutSession', 'CheckLimitsRequest', 'LimitResponseWithPlan'],
        }),
        ...Object.fromEntries(
          Array.from({ length: EXPECTED_OPERATION_COUNT - 1 }, (_, i) => {
            const id = `op${String(i + 1).padStart(2, '0')}`
            return [
              id,
              op(id, {
                route: { method: 'GET', path: '/v1/sdk/merchant' },
                request: undefined,
                response: 'void',
                overlays: ['void'],
              }),
            ]
          }),
        ),
      },
    })

    const snapshot: OpenApiSnapshot = {
      paths: {
        '/v1/sdk/limits': { post: {} },
        '/v1/sdk/merchant': { get: {} },
      },
      components: { schemas: {} },
    }

    expect(crossCheckOpenApi(manifest, snapshot)).toEqual([])
  })
})
