import { describe, expect, it } from 'vitest'
import {
  EXPECTED_MCP_COMPOSITE_OPERATION_COUNT,
  EXPECTED_MCP_LAYER2_COUNT,
  EXPECTED_MCP_SYNC_OP_COUNT,
  EXPECTED_OPERATION_COUNT,
  EXPECTED_ROUTED_OPERATION_COUNT,
  EXPECTED_TOP_LEVEL_IDS,
  SdkContractManifestSchema,
  assertBindingReconciliation,
  assertNameCorrectness,
  assertNameCoverage,
  assertNoNameCollisions,
  assertOperationCount,
  assertParamsCoverage,
  assertTopLevelSet,
  bindingCatalogBoundaryIds,
  crossesBindingBoundary,
  crossCheckOpenApi,
  deriveNames,
  type BindingReconcileEntry,
  type OpenApiSnapshot,
  type SdkContractManifest,
} from '../shared/manifest-schema.js'
import { OPERATION_PARAMS } from './lib/operation-params.js'

const DEFAULT_SYNC = {
  ts: 'async' as const,
  py: ['async', 'blocking'] as ('async' | 'blocking')[],
  rb: 'blocking' as const,
  go: 'blocking' as const,
  rust: ['async', 'blocking'] as ('async' | 'blocking')[],
  c: 'blocking' as const,
}

const PURE_SYNC = {
  ts: 'sync' as const,
  py: 'sync' as const,
  rb: 'sync' as const,
  go: 'sync' as const,
  rust: 'sync' as const,
  c: 'sync' as const,
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
    params: [{ name: 'params', ref: 'CheckLimitRequest', required: true }],
    overlays: [],
    normalization: [],
    shadow: { volatile: [] },
    idempotency: { kind: 'none' },
    errors: {
      default: { messageTemplate: 'Check limits failed ({status}): {body}' },
      cases: [],
    },
    sync: DEFAULT_SYNC,
    ...overrides,
  }
}

function minimalManifest(overrides: Partial<SdkContractManifest> = {}): SdkContractManifest {
  const operations: SdkContractManifest['operations'] = {}
  for (let i = 0; i < EXPECTED_ROUTED_OPERATION_COUNT; i += 1) {
    const id = i === 0 ? 'checkLimits' : `op${String(i).padStart(2, '0')}`
    operations[id] = op(id, {
      route: { method: 'GET', path: `/v1/sdk/paths/${id}` },
      request: undefined,
      response: 'LimitResponse',
    })
  }
  for (let i = 0; i < EXPECTED_MCP_COMPOSITE_OPERATION_COUNT; i += 1) {
    const id = `mcpOp${String(i).padStart(2, '0')}`
    operations[id] = op(id, {
      route: undefined,
      request: undefined,
      response: 'LimitResponse',
    })
  }

  const topLevel: SdkContractManifest['topLevel'] = {}
  for (const id of EXPECTED_TOP_LEVEL_IDS) {
    topLevel[id] = { names: deriveNames(id), sync: PURE_SYNC, params: [] }
  }

  const base: SdkContractManifest = {
    operations,
    overlays: {},
    shadow: {
      globalVolatileKeys: ['createdAt', 'updatedAt', 'id', 'reference'],
      volatileKeySuffixes: ['Ref'],
      refPrefixes: ['prd_', 'cus_'],
    },
    topLevel,
    coreHelpers: {
      validateBusinessDetails: { names: deriveNames('validateBusinessDetails'), sync: PURE_SYNC },
    },
    mcp: Object.fromEntries([
      ...Array.from({ length: EXPECTED_MCP_SYNC_OP_COUNT }, (_, i) => {
        const id = i === 0 ? 'mcpNarrate' : `mcpSync${String(i).padStart(2, '0')}`
        return [id, { names: deriveNames(id), sync: PURE_SYNC, surface: 'syncOp' as const }]
      }),
      ...Array.from({ length: EXPECTED_MCP_LAYER2_COUNT }, (_, i) => {
        const id = i === 0 ? 'paywallToolResult' : `mcpLayer${String(i).padStart(2, '0')}`
        return [id, { names: deriveNames(id), sync: PURE_SYNC, surface: 'layer2' as const }]
      }),
    ]),
    facade: {
      createSolvaPay: {
        names: deriveNames('createSolvaPay'),
        sync: PURE_SYNC,
        params: [],
      },
      createSolvaPayClient: {
        names: deriveNames('createSolvaPayClient'),
        sync: PURE_SYNC,
        params: [],
      },
      payable: { names: deriveNames('payable'), sync: PURE_SYNC, params: [] },
      protect: { names: deriveNames('protect'), sync: PURE_SYNC, params: [] },
      gate: {
        names: {
          ts: 'payable.gate',
          py: 'sp.gate',
          rb: 'sp.gate',
          go: 'sp.Gate',
          rust: 'sp.gate',
          c: 'gate',
        },
        sync: DEFAULT_SYNC,
        params: [],
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
        messages: {
          missing_signature: 'Missing webhook signature',
          malformed_signature: 'Malformed webhook signature',
          timestamp_too_old: 'Webhook signature timestamp too old',
          invalid_signature: 'Invalid webhook signature',
          invalid_payload: 'Invalid webhook payload: body is not valid JSON',
        },
      },
      paywall: {
        messages: {
          payment_required: 'Payment required',
          activation_required: 'Activation required',
        },
      },
      mcp: {
        messages: {
          rawHandlerReturn:
            'SolvaPay: registerPayable handler returned a raw value. Handlers must return ctx.respond(data, options?). If you believe you did, this is an internal bug — please file an issue at https://github.com/solvapay/solvapay-sdk/issues.',
        },
      },
      transport: {
        messageTemplate: '{message}',
      },
    },
    defaults: {
      retry: { maxRetries: 2, initialDelayMs: 500, backoff: 'fixed' },
      webhookToleranceSec: 300,
      limitsCacheTTLMs: 10000,
      customerDedupTTLMs: 60000,
      customerDedupMaxCacheSize: 1000,
      anonymousCustomerRef: 'anonymous',
      requestIdFormat: 'solvapay_{epochMs}_{random9}',
      usageActionType: 'api_call',
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
        c: 'gate',
      },
    },
    reservedWords: { go: [], py: [], rb: [], rust: [], ts: [], c: [] },
    bindings: {},
  }

  return {
    ...base,
    ...overrides,
    operations: overrides.operations ?? base.operations,
    overlays: overrides.overlays ?? base.overlays,
    topLevel: overrides.topLevel ?? base.topLevel,
    coreHelpers: overrides.coreHelpers ?? base.coreHelpers,
    facade: overrides.facade ?? base.facade,
    mcp: overrides.mcp ?? base.mcp,
    nameOverrides: overrides.nameOverrides ?? base.nameOverrides,
    bindings: overrides.bindings ?? base.bindings,
  }
}

function derivedBinding(
  id: string,
  catalog: BindingReconcileEntry['catalog'] = { kind: 'none' },
  core = `solvapay_core::example::${id}`,
): BindingReconcileEntry {
  return { core, catalog, names: { ts: id } }
}

describe('deriveNames', () => {
  it('maps camelCase operation ids to per-language idioms', () => {
    expect(deriveNames('checkLimits')).toEqual({
      ts: 'checkLimits',
      py: 'check_limits',
      rb: 'check_limits',
      go: 'CheckLimits',
      rust: 'check_limits',
      c: 'checkLimits',
    })
  })

  it('handles multi-segment ids and acronyms as plain camelCase splits', () => {
    expect(deriveNames('createSolvaPayClient')).toEqual({
      ts: 'createSolvaPayClient',
      py: 'create_solva_pay_client',
      rb: 'create_solva_pay_client',
      go: 'CreateSolvaPayClient',
      rust: 'create_solva_pay_client',
      c: 'createSolvaPayClient',
    })
  })
})

describe('SdkContractManifestSchema', () => {
  it('accepts a valid minimal manifest', () => {
    const result = SdkContractManifestSchema.safeParse(minimalManifest())
    expect(result.success).toBe(true)
  })

  it('freezes customer-dedup and usage defaults', () => {
    const parsed = SdkContractManifestSchema.parse(minimalManifest())
    expect(parsed.defaults.customerDedupTTLMs).toBe(60000)
    expect(parsed.defaults.customerDedupMaxCacheSize).toBe(1000)
    expect(parsed.defaults.anonymousCustomerRef).toBe('anonymous')
    expect(parsed.defaults.requestIdFormat).toBe('solvapay_{epochMs}_{random9}')
    expect(parsed.defaults.usageActionType).toBe('api_call')
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
        c: 'checkLimits',
      },
    })
    const result = SdkContractManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
  })

  it('rejects errors.webhook missing a frozen message for a code', () => {
    const manifest = minimalManifest()
    const { missing_signature: _removed, ...rest } = manifest.errors.webhook.messages
    manifest.errors.webhook.messages = rest as typeof manifest.errors.webhook.messages
    const result = SdkContractManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
  })

  it('rejects errors.paywall / transport when message templates are empty', () => {
    const manifest = minimalManifest()
    manifest.errors.paywall.messages.payment_required = ''
    expect(SdkContractManifestSchema.safeParse(manifest).success).toBe(false)
    const transport = minimalManifest()
    transport.errors.transport.messageTemplate = ''
    expect(SdkContractManifestSchema.safeParse(transport).success).toBe(false)
  })

  it('rejects leftover bindings: and boundaryTypes: entries', () => {
    expect(
      SdkContractManifestSchema.safeParse(
        minimalManifest({
          bindings: { updateCustomer: { core: 'x' } },
        }),
      ).success,
    ).toBe(false)
    expect(
      SdkContractManifestSchema.safeParse(
        minimalManifest({
          boundaryTypes: ['CustomerRefKind'],
        }),
      ).success,
    ).toBe(false)
  })

  it('rejects a manifest with no mcp section', () => {
    const { mcp: _removed, ...rest } = minimalManifest()
    const result = SdkContractManifestSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects an mcp entry missing a language name', () => {
    const manifest = minimalManifest()
    manifest.mcp.mcpNarrate = {
      ...manifest.mcp.mcpNarrate,
      names: {
        ts: 'mcpNarrate',
        py: 'mcp_narrate',
        rb: 'mcp_narrate',
        go: '',
        rust: 'mcp_narrate',
        c: 'mcpNarrate',
      },
    }
    const result = SdkContractManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
  })

  it('rejects an mcp entry with an unknown surface', () => {
    const manifest = minimalManifest()
    const result = SdkContractManifestSchema.safeParse({
      ...manifest,
      mcp: {
        ...manifest.mcp,
        mcpNarrate: { ...manifest.mcp.mcpNarrate, surface: 'nonsense' },
      },
    })
    expect(result.success).toBe(false)
  })

  it('accepts an mcp entry gated on the engine feature', () => {
    const manifest = minimalManifest()
    manifest.mcp.mcpHandleRequest = {
      names: deriveNames('mcpHandleRequest'),
      sync: PURE_SYNC,
      surface: 'syncOp',
      feature: 'engine',
    }
    const result = SdkContractManifestSchema.safeParse(manifest)
    expect(result.success).toBe(true)
  })

  it('accepts a topLevel handWritten availability with a reason', () => {
    const manifest = minimalManifest()
    manifest.topLevel.withRetry = {
      ...manifest.topLevel.withRetry,
      availability: { rust: { handWritten: true, reason: 'x' } },
    }
    const result = SdkContractManifestSchema.safeParse(manifest)
    expect(result.success).toBe(true)
  })

  it('rejects a handWritten availability without a reason', () => {
    const manifest = minimalManifest()
    const result = SdkContractManifestSchema.safeParse({
      ...manifest,
      topLevel: {
        ...manifest.topLevel,
        withRetry: {
          ...manifest.topLevel.withRetry,
          availability: { rust: { handWritten: true } },
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an availability omission without a reason', () => {
    const manifest = minimalManifest()
    const result = SdkContractManifestSchema.safeParse({
      ...manifest,
      mcp: {
        ...manifest.mcp,
        paywallToolResult: {
          names: deriveNames('paywallToolResult'),
          sync: PURE_SYNC,
          surface: 'layer2',
          availability: { c: { omitted: true, reason: '' } },
        },
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('bindingCatalogBoundaryIds', () => {
  const names = deriveNames('example')

  it('includes rust-generated catalog ids and nativeExport hand-written rust', () => {
    const ids = bindingCatalogBoundaryIds({
      generatedHelper: { names, sync: PURE_SYNC },
      omittedConst: {
        names,
        sync: PURE_SYNC,
        availability: {
          rust: { omitted: true, reason: 'not exported' },
        },
      },
      hostRetry: {
        names,
        sync: PURE_SYNC,
        availability: {
          rust: { handWritten: true, reason: 'host retry' },
        },
      },
      verifyWebhook: {
        names,
        sync: PURE_SYNC,
        availability: {
          rust: { handWritten: true, reason: 'host wrap', nativeExport: true },
        },
      },
    })
    expect(ids).toEqual(['generatedHelper', 'verifyWebhook'])
  })

  it('treats missing rust availability as generated (crosses the boundary)', () => {
    expect(crossesBindingBoundary({ names, sync: PURE_SYNC })).toBe(true)
  })
})

describe('assertBindingReconciliation', () => {
  it('flags an orphan catalog entry that crosses the boundary without a linker', () => {
    const issues = assertBindingReconciliation(minimalManifest(), {
      checkLimits: derivedBinding('checkLimits', { kind: 'operation', id: 'checkLimits' }),
    })
    expect(issues.some(i => /orphan catalog|missing binder|no binding/i.test(i))).toBe(true)
  })

  it('flags an orphan shim js_name missing from bindings', () => {
    const issues = assertBindingReconciliation(minimalManifest(), {
      classifyCustomerRef: derivedBinding('classifyCustomerRef'),
    })
    expect(issues.some(i => /decidePaywallOutcome/.test(i) && /shim|js_name|orphan/i.test(i))).toBe(
      true,
    )
  })

  it('flags duplicate core fn paths across bindings', () => {
    const issues = assertBindingReconciliation(minimalManifest(), {
      classifyCustomerRef: derivedBinding(
        'classifyCustomerRef',
        { kind: 'none' },
        'solvapay_core::shared::dup',
      ),
      coerceCustomerOptions: derivedBinding(
        'coerceCustomerOptions',
        { kind: 'none' },
        'solvapay_core::shared::dup',
      ),
    })
    expect(issues.some(i => /duplicate core/i.test(i))).toBe(true)
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

  it('requires exactly 36 routed operations', () => {
    const manifest = minimalManifest()
    delete manifest.operations.op35
    expect(assertOperationCount(manifest).some(i => /36/.test(i))).toBe(true)
  })

  it('requires exactly 5 routeless MCP composite operations', () => {
    const manifest = minimalManifest()
    delete manifest.operations.mcpOp04
    const issues = assertOperationCount(manifest)
    expect(
      issues.some(
        i => /composite/i.test(i) && i.includes(String(EXPECTED_MCP_COMPOSITE_OPERATION_COUNT)),
      ),
    ).toBe(true)
  })

  it('passes when routed and composite counts match', () => {
    expect(assertOperationCount(minimalManifest())).toEqual([])
  })

  it('requires the expected topLevel id set', () => {
    const manifest = minimalManifest()
    delete manifest.topLevel.verifyWebhook
    const issues = assertTopLevelSet(manifest)
    expect(issues.some(i => /verifyWebhook/.test(i))).toBe(true)
  })
})

describe('params catalog', () => {
  it('rejects an operation missing params', () => {
    const manifest = minimalManifest()
    const { params: _removed, ...rest } = manifest.operations.checkLimits
    manifest.operations.checkLimits = rest as typeof manifest.operations.checkLimits
    const result = SdkContractManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
  })

  it('accepts empty params for nullary methods', () => {
    const manifest = minimalManifest()
    manifest.operations.checkLimits = op('checkLimits', { params: [] })
    expect(SdkContractManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('requires params coverage on all operations and callables', () => {
    const manifest = minimalManifest()
    expect(assertParamsCoverage(manifest)).toEqual([])
  })

  it('fails params coverage when an operation omits params at runtime', () => {
    const manifest = minimalManifest()
    delete (manifest.operations.checkLimits as { params?: unknown }).params
    const issues = assertParamsCoverage(manifest)
    expect(issues.some(i => /operations\.checkLimits missing params/.test(i))).toBe(true)
  })

  it('updateCustomer has two positional params named customerRef and params', () => {
    const params = OPERATION_PARAMS.updateCustomer
    expect(params).toHaveLength(2)
    expect(params[0]?.name).toBe('customerRef')
    expect(params[1]?.name).toBe('params')
  })

  it('checkLimits has a single required params bag', () => {
    const params = OPERATION_PARAMS.checkLimits
    expect(params).toHaveLength(1)
    expect(params[0]).toMatchObject({ name: 'params', required: true })
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

  it('resolves request/response DTO refs via defined overlays', () => {
    const manifest = minimalManifest({
      overlays: {
        includeCheckoutSession: { kind: 'synthetic', marker: true },
        CheckLimitsRequest: {
          kind: 'extendDto',
          base: 'CheckLimitRequest',
          fields: {
            includeCheckoutSession: { type: 'boolean', required: false },
          },
        },
        LimitResponseWithPlan: {
          kind: 'extendDto',
          base: 'LimitResponse',
          fields: {
            plan: { type: 'string', required: true },
          },
        },
        void: { kind: 'synthetic', unit: true },
      },
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
      components: {
        schemas: {
          CheckLimitRequest: {},
          LimitResponse: {},
        },
      },
    }

    expect(crossCheckOpenApi(manifest, snapshot)).toEqual([])
  })

  it('fails when an operation overlays entry is undefined', () => {
    const manifest = minimalManifest({
      operations: {
        checkLimits: op('checkLimits', {
          route: { method: 'POST', path: '/v1/sdk/limits' },
          request: 'CheckLimitRequest',
          response: 'LimitResponse',
          overlays: ['MissingOverlay'],
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
        schemas: { CheckLimitRequest: {}, LimitResponse: {} },
      },
    }
    const issues = crossCheckOpenApi(manifest, snapshot)
    expect(issues.some(i => /MissingOverlay/.test(i))).toBe(true)
  })

  it('fails when an overlay base is missing from schemas and overlays', () => {
    const manifest = minimalManifest({
      overlays: {
        LimitResponseWithPlan: {
          kind: 'extendDto',
          base: 'MissingBase',
          fields: { plan: { type: 'string', required: true } },
        },
      },
      operations: {
        checkLimits: op('checkLimits', {
          route: { method: 'POST', path: '/v1/sdk/limits' },
          request: 'CheckLimitRequest',
          response: 'LimitResponseWithPlan',
          overlays: ['LimitResponseWithPlan'],
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
        schemas: { CheckLimitRequest: {}, LimitResponse: {} },
      },
    }
    const issues = crossCheckOpenApi(manifest, snapshot)
    expect(issues.some(i => /MissingBase/.test(i))).toBe(true)
  })

  it('fails when a defined overlay is never referenced', () => {
    const manifest = minimalManifest({
      overlays: {
        OrphanOverlay: {
          kind: 'synthetic',
          fields: { x: { type: 'string', required: true } },
        },
      },
    })
    const snapshot: OpenApiSnapshot = {
      paths: Object.fromEntries(
        Object.values(manifest.operations).flatMap(operation =>
          operation.route == null
            ? []
            : [[operation.route.path, { [operation.route.method.toLowerCase()]: {} }]],
        ),
      ),
      components: { schemas: { LimitResponse: {} } },
    }
    const issues = crossCheckOpenApi(manifest, snapshot)
    expect(issues.some(i => /OrphanOverlay/.test(i) && /unused/i.test(i))).toBe(true)
  })

  it('accepts OverlaySchema variants', () => {
    const parsed = SdkContractManifestSchema.safeParse(
      minimalManifest({
        overlays: {
          LimitResponseWithPlan: {
            kind: 'extendDto',
            base: 'LimitResponse',
            fields: { plan: { type: 'string', required: true } },
          },
          CustomerResponseMapped: {
            kind: 'mapDto',
            renames: { reference: 'customerRef' },
            fields: { customerRef: { type: 'string', required: true } },
          },
          TopupProcessResult: {
            kind: 'projectUnion',
            base: 'ProcessPaymentResult',
            dropVariants: ['SucceededRecurring', 'SucceededOneTime'],
            succeededFields: { creditsAdded: { type: 'number', required: false } },
          },
          void: { kind: 'synthetic', unit: true },
        },
      }),
    )
    expect(parsed.success).toBe(true)
  })
})
