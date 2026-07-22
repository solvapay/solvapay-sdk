import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  BINDING_CATALOG_BOUNDARY_CORE_HELPERS,
  BINDING_CATALOG_BOUNDARY_TOP_LEVEL,
  EXPECTED_OPERATION_COUNT,
  EXPECTED_TOP_LEVEL_IDS,
  SHIM_JS_NAMES,
  deriveNames,
  type BindingSymbol,
  type SdkContractManifest,
} from './lib/manifest-schema.js'
import { runCli } from './manifest.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMP_ROOT = path.join(REPO_ROOT, 'scripts/.tmp')
const REAL_MANIFEST = path.join(REPO_ROOT, 'contract/manifest/sdk-contract.yaml')
const REAL_SNAPSHOT = path.join(REPO_ROOT, 'contract/openapi/sdk-v1.snapshot.json')

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  mkdirSync(TEMP_ROOT, { recursive: true })
  const dir = mkdtempSync(path.join(TEMP_ROOT, 'manifest-'))
  tempDirs.push(dir)
  return dir
}

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

/** Real client op ids so fixture bindings reconcile against SHIM_JS_NAMES. */
const FIXTURE_OPERATION_IDS = SHIM_JS_NAMES.filter(id =>
  [
    'activatePlan',
    'assignCredits',
    'attachBusinessDetails',
    'bootstrapMcpProduct',
    'cancelPurchase',
    'checkLimits',
    'cloneProduct',
    'configureMcpPlans',
    'createCheckoutSession',
    'createCustomer',
    'createCustomerSession',
    'createPaymentIntent',
    'createPlan',
    'createProduct',
    'createTopupPaymentIntent',
    'deletePlan',
    'deleteProduct',
    'disableAutoRecharge',
    'getAutoRecharge',
    'getCustomer',
    'getCustomerBalance',
    'getMerchant',
    'getPaymentMethod',
    'getPlatformConfig',
    'getProduct',
    'getUserInfo',
    'listPlans',
    'listProducts',
    'processPaymentIntent',
    'reactivatePurchase',
    'saveAutoRecharge',
    'trackUsage',
    'trackUsageBulk',
    'updateCustomer',
    'updatePlan',
    'updateProduct',
  ].includes(id),
)

function buildFixtureManifest(): SdkContractManifest {
  const operations: SdkContractManifest['operations'] = {}
  for (const id of FIXTURE_OPERATION_IDS) {
    const isCheckLimits = id === 'checkLimits'
    operations[id] = {
      route: {
        method: isCheckLimits ? 'POST' : 'GET',
        path: isCheckLimits ? '/v1/sdk/limits' : '/v1/sdk/merchant',
      },
      names: deriveNames(id),
      optionalOnClient: false,
      request: isCheckLimits ? 'CheckLimitRequest' : undefined,
      response: isCheckLimits ? 'LimitResponse' : 'SdkMerchantResponseDto',
      params: [],
      overlays: [],
      normalization: [],
      shadow: { volatile: [] },
      idempotency: { kind: 'none' },
      errors: {
        default: { messageTemplate: `${id} failed ({status}): {body}` },
        cases: [],
      },
      sync: DEFAULT_SYNC,
    }
  }

  const topLevel: SdkContractManifest['topLevel'] = {}
  for (const id of EXPECTED_TOP_LEVEL_IDS) {
    topLevel[id] = { names: deriveNames(id), sync: PURE_SYNC }
  }

  return {
    operations,
    overlays: {},
    shadow: {
      globalVolatileKeys: ['createdAt', 'updatedAt', 'id', 'reference'],
      volatileKeySuffixes: ['Ref'],
      refPrefixes: ['prd_', 'cus_'],
    },
    topLevel,
    coreHelpers: {
      validateBusinessDetails: {
        names: deriveNames('validateBusinessDetails'),
        sync: PURE_SYNC,
      },
    },
    facade: {
      createSolvaPay: { names: deriveNames('createSolvaPay'), sync: PURE_SYNC },
      createSolvaPayClient: {
        names: deriveNames('createSolvaPayClient'),
        sync: PURE_SYNC,
      },
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
    reservedWords: { ts: [], py: [], rb: [], go: [], rust: [] },
    bindings: stubBindings(operations, {
      validateBusinessDetails: {
        names: deriveNames('validateBusinessDetails'),
        sync: PURE_SYNC,
      },
    }),
  }
}

/** Minimal bindings covering the shim inventory + catalog linkers for fixtures. */
function stubBindings(
  operations: SdkContractManifest['operations'],
  coreHelpers: SdkContractManifest['coreHelpers'],
): Record<string, BindingSymbol> {
  const topLevelBoundary = new Set<string>(BINDING_CATALOG_BOUNDARY_TOP_LEVEL)
  const coreHelperBoundary = new Set<string>(BINDING_CATALOG_BOUNDARY_CORE_HELPERS)
  const bindings: Record<string, BindingSymbol> = {}
  for (const js of SHIM_JS_NAMES) {
    let catalog: BindingSymbol['catalog'] = { kind: 'none' }
    if (js in operations) {
      catalog = { kind: 'operation', id: js }
    } else if (topLevelBoundary.has(js)) {
      catalog = { kind: 'topLevel', id: js }
    } else if (coreHelperBoundary.has(js) && js in coreHelpers) {
      catalog = { kind: 'coreHelper', id: js }
    }
    bindings[js] = {
      core: `test::stub::${js}`,
      names: deriveNames(js),
      catalog,
      args: [],
      splitPathRefs: [],
      return: 'value',
      sync: catalog.kind === 'operation' ? 'async' : 'sync',
      envelope:
        js === 'verifyWebhook'
          ? 'webhookThrow'
          : catalog.kind === 'operation'
            ? 'async'
            : 'sync',
    }
  }
  return bindings
}

function writeFixture(dir: string, manifest: SdkContractManifest): {
  manifestPath: string
  snapshotPath: string
} {
  const manifestPath = path.join(dir, 'sdk-contract.yaml')
  const snapshotPath = path.join(dir, 'sdk-v1.snapshot.json')
  // Serialize via JSON→YAML-ish by writing JSON for simplicity; CLI accepts YAML parse of JSON
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        paths: {
          '/v1/sdk/limits': { post: {} },
          '/v1/sdk/merchant': { get: {} },
        },
        components: {
          schemas: {
            CheckLimitRequest: {},
            LimitResponse: {},
            SdkMerchantResponseDto: {},
          },
        },
      },
      null,
      2,
    ),
  )
  return { manifestPath, snapshotPath }
}

describe('manifest CLI', () => {
  it('--check exits 0 on a valid fixture manifest', async () => {
    const dir = makeTempDir()
    const { manifestPath, snapshotPath } = writeFixture(dir, buildFixtureManifest())

    const result = await runCli([
      '--check',
      '--manifest',
      manifestPath,
      '--snapshot',
      snapshotPath,
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/passed/i)
  })

  it('--check fails when a go name is emptied', async () => {
    const dir = makeTempDir()
    const manifest = buildFixtureManifest()
    manifest.operations.checkLimits.names.go = ''
    const { manifestPath, snapshotPath } = writeFixture(dir, manifest)

    const result = await runCli([
      '--check',
      '--manifest',
      manifestPath,
      '--snapshot',
      snapshotPath,
    ])

    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/go|coverage|name/i)
  })

  it('--check fails on an unknown OpenAPI route', async () => {
    const dir = makeTempDir()
    const manifest = buildFixtureManifest()
    manifest.operations.checkLimits.route.path = '/v1/sdk/does-not-exist'
    const { manifestPath, snapshotPath } = writeFixture(dir, manifest)

    const result = await runCli([
      '--check',
      '--manifest',
      manifestPath,
      '--snapshot',
      snapshotPath,
    ])

    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/route|OpenAPI/i)
  })

  it('--check fails when a message template is reworded away from schema validity still reports semantic issues for duplicates', async () => {
    const dir = makeTempDir()
    const manifest = buildFixtureManifest()
    manifest.operations.getCustomer.names.ts = 'checkLimits'
    const { manifestPath, snapshotPath } = writeFixture(dir, manifest)

    const result = await runCli([
      '--check',
      '--manifest',
      manifestPath,
      '--snapshot',
      snapshotPath,
    ])

    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/collision/i)
  })

  it('default mode validates the fixture without OpenAPI cross-check', async () => {
    const dir = makeTempDir()
    const { manifestPath } = writeFixture(dir, buildFixtureManifest())

    const result = await runCli(['--manifest', manifestPath])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/valid/i)
  })

  it('committed sdk-contract.yaml passes --check against the OpenAPI snapshot', async () => {
    // Ensure the authored YAML still round-trips through the YAML parser.
    const raw = await import('node:fs').then(fs => fs.readFileSync(REAL_MANIFEST, 'utf8'))
    expect(() => parseYaml(raw)).not.toThrow()

    const result = await runCli([
      '--check',
      '--manifest',
      REAL_MANIFEST,
      '--snapshot',
      REAL_SNAPSHOT,
    ])
    expect(result.exitCode).toBe(0)
  })
})
