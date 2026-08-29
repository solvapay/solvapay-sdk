import { describe, expect, it } from 'vitest'
import {
  EXPECTED_OPERATION_COUNT,
  EXPECTED_TOP_LEVEL_IDS,
  deriveNames,
  type SdkContractManifest,
} from '../../shared/manifest-schema.js'
import {
  cataloguedHelperEntries,
  checkHelperParity,
  checkMcpParity,
  checkParity,
  formatParityReport,
} from './parity.js'

const PURE_SYNC = {
  ts: 'sync' as const,
  py: 'sync' as const,
  rb: 'sync' as const,
  go: 'sync' as const,
  rust: 'sync' as const,
  c: 'sync' as const,
}

const CLIENT_SYNC = {
  ts: 'async' as const,
  py: ['async', 'blocking'] as ('async' | 'blocking')[],
  rb: 'blocking' as const,
  go: 'blocking' as const,
  rust: ['async', 'blocking'] as ('async' | 'blocking')[],
  c: 'blocking' as const,
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
          c: 'gate',
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
    mcp: {
      mcpNarrate: {
        names: deriveNames('mcpNarrate'),
        sync: PURE_SYNC,
        surface: 'syncOp',
      },
    },
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

  it('detects a missing client method', () => {
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

  it('flags an uncatalogued portable export as extra', () => {
    const manifest = stubManifest()
    const clientMethods = new Set(Object.keys(manifest.operations).map(id => deriveNames(id).ts))
    const issues = checkParity({
      manifest,
      portableExports: completePortableExports(['uncataloguedPortableHelper']),
      clientMethods,
      facadeMethods: completeFacadeMethods(),
    })
    expect(
      issues.some(i => i.kind === 'extra' && /uncataloguedPortableHelper/.test(i.message)),
    ).toBe(true)
  })

  it('recognizes catalog:none derived bindings as catalogued (not extra)', () => {
    const manifest = stubManifest()
    const clientMethods = new Set(Object.keys(manifest.operations).map(id => deriveNames(id).ts))
    expect(
      checkParity({
        manifest,
        portableExports: completePortableExports(['classifyCancelError']),
        clientMethods,
        facadeMethods: completeFacadeMethods(),
        derivedBindings: {
          classifyCancelError: {
            names: deriveNames('classifyCancelError'),
          },
        },
      }),
    ).toEqual([])
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

  it('flags a catalogued mcp sync op missing from a language surface', () => {
    const issues = checkMcpParity(stubManifest(), {
      py: { symbols: new Set(), hasCallEnvelope: false },
    })
    expect(issues.some(i => i.kind === 'missing' && /mcpNarrate/.test(i.message))).toBe(true)
  })

  it('accepts snake_case python and ruby names for a camelCase mcp id', () => {
    const issues = checkMcpParity(stubManifest(), {
      py: { symbols: new Set(['mcp_narrate']), hasCallEnvelope: false },
      rb: { symbols: new Set(['mcp_narrate']), hasCallEnvelope: false },
    })
    expect(issues.filter(i => / py | rb /.test(i.message))).toEqual([])
  })

  it('accepts a declared availability omission with a reason', () => {
    const manifest = stubManifest()
    manifest.mcp.paywallToolResult = {
      names: deriveNames('paywallToolResult'),
      sync: PURE_SYNC,
      surface: 'layer2',
      availability: {
        c: {
          omitted: true,
          reason: 'Layer-2 payload builders are not on the production solvapay_call ABI.',
        },
      },
    }
    const issues = checkMcpParity(manifest, {
      c: { symbols: new Set(), hasCallEnvelope: false },
    })
    expect(issues.some(i => /paywallToolResult/.test(i.message) && /c /.test(i.message))).toBe(
      false,
    )
  })

  it('accepts a declared handWritten availability with a reason', () => {
    const manifest = stubManifest()
    manifest.mcp.paywallToolResult = {
      names: deriveNames('paywallToolResult'),
      sync: PURE_SYNC,
      surface: 'layer2',
      availability: {
        ts: {
          handWritten: true,
          reason: 'Install/dispatch stays in native-mcp.ts',
        },
      },
    }
    const issues = checkMcpParity(manifest, {
      ts: { symbols: new Set(), hasCallEnvelope: false },
    })
    expect(issues.some(i => /paywallToolResult/.test(i.message) && /ts /.test(i.message))).toBe(
      false,
    )
  })

  it('flags an omission declared without a reason', () => {
    const manifest = stubManifest()
    manifest.mcp.paywallToolResult = {
      names: deriveNames('paywallToolResult'),
      sync: PURE_SYNC,
      surface: 'layer2',
      availability: {
        c: { omitted: true, reason: '' },
      },
    }
    const issues = checkMcpParity(manifest, {
      c: { symbols: new Set(), hasCallEnvelope: false },
    })
    expect(issues.some(i => /omitted without a reason/.test(i.message))).toBe(true)
  })

  it('flags a layer-2 symbol present in bindings but absent from the mcp section', () => {
    const issues = checkMcpParity(stubManifest(), {}, {
      paywallToolResult: { section: 'MCP payload / descriptors' },
    })
    expect(issues.some(i => i.kind === 'extra' && /paywallToolResult/.test(i.message))).toBe(true)
  })

  it('cataloguedHelperEntries skips omitted and handWritten languages', () => {
    const manifest = stubManifest()
    manifest.coreHelpers.deriveTaxIdType = {
      names: deriveNames('deriveTaxIdType'),
      sync: PURE_SYNC,
      params: [],
      availability: {
        c: { omitted: true, reason: 'not on the C ABI' },
        rust: { handWritten: true, reason: 'host owned' },
      },
    }
    const rows = cataloguedHelperEntries(manifest).filter(row => row.id === 'deriveTaxIdType')
    expect(rows.some(row => row.lang === 'c')).toBe(false)
    expect(rows.some(row => row.lang === 'rust')).toBe(false)
    expect(rows.some(row => row.lang === 'ts')).toBe(true)
  })

  it('checkHelperParity reports missing helper names', () => {
    const manifest = stubManifest()
    manifest.coreHelpers.deriveTaxIdType = {
      names: deriveNames('deriveTaxIdType'),
      sync: PURE_SYNC,
      params: [],
    }
    const issues = checkHelperParity(manifest, {
      ts: new Set(),
      py: new Set(),
      rb: new Set(),
      go: new Set(),
      rust: new Set(),
    })
    expect(issues.some(i => i.kind === 'missing' && /deriveTaxIdType/.test(i.message))).toBe(true)
  })

  it('formatParityReport is actionable', () => {
    const report = formatParityReport([
      { kind: 'missing', message: 'Missing: operations.checkLimits client method "checkLimits"' },
    ])
    expect(report).toContain('Parity check failed')
    expect(report).toContain('checkLimits')
  })
})
