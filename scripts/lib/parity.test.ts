import { describe, expect, it } from 'vitest'
import {
  EXPECTED_OPERATION_COUNT,
  EXPECTED_TOP_LEVEL_IDS,
  deriveNames,
  type SdkContractManifest,
} from './manifest-schema.js'
import { checkParity, formatParityReport } from './parity.js'

const PURE_SYNC = {
  ts: 'sync' as const,
  py: 'sync' as const,
  rb: 'sync' as const,
  go: 'sync' as const,
  rust: 'sync' as const,
}

const CLIENT_SYNC = {
  ts: 'async' as const,
  py: ['async', 'blocking'] as ('async' | 'blocking')[],
  rb: 'blocking' as const,
  go: 'blocking' as const,
  rust: ['async', 'blocking'] as ('async' | 'blocking')[],
}

function stubManifest(): SdkContractManifest {
  const operations: SdkContractManifest['operations'] = {}
  for (let i = 0; i < EXPECTED_OPERATION_COUNT; i += 1) {
    const id = i === 0 ? 'checkLimits' : `op${String(i).padStart(2, '0')}`
    operations[id] = {
      route: { method: 'GET', path: `/v1/sdk/${id}` },
      names: deriveNames(id),
      optionalOnClient: false,
      response: 'LimitResponse',
      params: [],
      overlays: [],
      normalization: [],
      idempotency: { kind: 'none' },
      errors: { default: { messageTemplate: 'x' }, cases: [] },
      sync: CLIENT_SYNC,
    }
  }

  const topLevel: SdkContractManifest['topLevel'] = {}
  for (const id of EXPECTED_TOP_LEVEL_IDS) {
    topLevel[id] = { names: deriveNames(id), sync: PURE_SYNC, params: [] }
  }

  return {
    operations,
    overlays: {},
    topLevel,
    coreHelpers: {
      validateBusinessDetails: {
        names: deriveNames('validateBusinessDetails'),
        sync: PURE_SYNC,
        params: [],
      },
    },
    facade: {
      createSolvaPay: { names: deriveNames('createSolvaPay'), sync: PURE_SYNC, params: [] },
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
        },
        sync: CLIENT_SYNC,
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
          missing_signature: 'a',
          malformed_signature: 'b',
          timestamp_too_old: 'c',
          invalid_signature: 'd',
          invalid_payload: 'e',
        },
      },
      paywall: {
        messages: { payment_required: 'p', activation_required: 'a' },
      },
      mcp: {
        messages: { rawHandlerReturn: 'raw' },
      },
      transport: { messageTemplate: '{message}' },
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
    bindings: {},
  }
}

function completePortableExports(extra: string[] = []): Set<string> {
  return new Set([
    ...EXPECTED_TOP_LEVEL_IDS,
    'validateBusinessDetails',
    'createSolvaPay',
    'createSolvaPayClient',
    ...extra,
  ])
}

function completeFacadeMethods(): Set<string> {
  return new Set(['payable', 'protect', 'gate'])
}

describe('checkParity', () => {
  it('passes when all catalogued exports and client methods are present', () => {
    const manifest = stubManifest()
    const clientMethods = new Set(Object.keys(manifest.operations).map(id => deriveNames(id).ts))
    expect(
      checkParity({
        manifest,
        portableExports: completePortableExports(),
        clientMethods,
        facadeMethods: completeFacadeMethods(),
      }),
    ).toEqual([])
  })

  it('fails when a client method is missing', () => {
    const manifest = stubManifest()
    const clientMethods = new Set(
      Object.keys(manifest.operations)
        .filter(id => id !== 'checkLimits')
        .map(id => deriveNames(id).ts),
    )
    const issues = checkParity({
      manifest,
      portableExports: completePortableExports(),
      clientMethods,
      facadeMethods: completeFacadeMethods(),
    })
    expect(issues.some(i => i.kind === 'missing' && /checkLimits/.test(i.message))).toBe(true)
  })

  it('fails when an uncatalogued portable export is present', () => {
    const manifest = stubManifest()
    const clientMethods = new Set(Object.keys(manifest.operations).map(id => deriveNames(id).ts))
    const issues = checkParity({
      manifest,
      portableExports: completePortableExports(['sneakyUndocumentedHelper']),
      clientMethods,
      facadeMethods: completeFacadeMethods(),
    })
    expect(issues.some(i => i.kind === 'extra' && /sneakyUndocumentedHelper/.test(i.message))).toBe(
      true,
    )
  })

  it('allows explicit §2.5 allowlist extras', () => {
    const manifest = stubManifest()
    const clientMethods = new Set(Object.keys(manifest.operations).map(id => deriveNames(id).ts))
    expect(
      checkParity({
        manifest,
        portableExports: completePortableExports(['NextAdapter', 'createVirtualTools']),
        clientMethods,
        facadeMethods: completeFacadeMethods(),
      }),
    ).toEqual([])
  })

  it('flags wrong casing', () => {
    const manifest = stubManifest()
    const clientMethods = new Set(
      Object.keys(manifest.operations).map(id =>
        id === 'checkLimits' ? 'CheckLimits' : deriveNames(id).ts,
      ),
    )
    const issues = checkParity({
      manifest,
      portableExports: completePortableExports(),
      clientMethods,
      facadeMethods: completeFacadeMethods(),
    })
    expect(issues.some(i => i.kind === 'casing' && /checkLimits/.test(i.message))).toBe(true)
  })

  it('formatParityReport is actionable', () => {
    const report = formatParityReport([
      { kind: 'missing', message: 'Missing: operations.checkLimits client method "checkLimits"' },
    ])
    expect(report).toContain('Parity check failed')
    expect(report).toContain('checkLimits')
  })
})
