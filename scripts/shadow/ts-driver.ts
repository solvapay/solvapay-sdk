/**
 * TS-side shadow driver: camelCase dispatch over createSolvaPayClient + fetch recorder.
 */

import { createSolvaPayClient, type SolvaPayClient } from '@solvapay/server'
import type { SideOutcome, WireExchange } from './compare.js'

/** All 36 client operation ids (manifest / OPERATION_NAMES order). */
export const TS_SHADOW_OPERATION_NAMES = [
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
] as const

export type ShadowOpName = (typeof TS_SHADOW_OPERATION_NAMES)[number]

export type TsDriverOptions = {
  apiKey: string
  apiBaseUrl: string
  /** Injected fetch (defaults to global). Used for recording + tests. */
  fetchImpl?: typeof fetch
}

export type TsDriver = {
  /** CamelCase ops registered on this driver. */
  operationNames: readonly string[]
  invoke: (fn: string, args: Record<string, unknown>) => Promise<SideOutcome>
}

function reqStr(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing string arg: ${key}`)
  }
  return value
}

function omitKeys(
  args: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out = { ...args }
  for (const key of keys) {
    delete out[key]
  }
  return out
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = value
    }
    return out
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key] = value
    }
  }
  return out
}

function parseBody(raw: BodyInit | null | undefined): unknown {
  if (raw == null || raw === '') return undefined
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Wrap `fetchImpl` to append each exchange onto `wire`.
 * Clones the response so the SDK can still read the body.
 */
export function createRecordingFetch(
  fetchImpl: typeof fetch,
  wire: WireExchange[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const requestHeaders = headersToRecord(init?.headers)
    const requestBody = parseBody(init?.body ?? null)
    const response = await fetchImpl(input, init)
    const responseBody = await parseResponseBody(response.clone())
    wire.push({
      method,
      url,
      requestHeaders,
      requestBody,
      status: response.status,
      responseBody,
    })
    return response
  }) as typeof fetch
}

function buildDispatchers(
  client: SolvaPayClient,
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const dispatchers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    checkLimits: args => client.checkLimits!(args as never),
    trackUsage: args => client.trackUsage!(args as never),
    trackUsageBulk: args => client.trackUsageBulk!(args as never),
    createCustomer: args => client.createCustomer!(args as never),
    updateCustomer: args =>
      client.updateCustomer!(reqStr(args, 'customerRef'), omitKeys(args, ['customerRef']) as never),
    getCustomer: args => client.getCustomer!(args as never),
    assignCredits: args => client.assignCredits!(args as never),
    getMerchant: () => client.getMerchant!(),
    getPlatformConfig: () => client.getPlatformConfig!(),
    getProduct: args => client.getProduct!(reqStr(args, 'productRef')),
    listProducts: () => client.listProducts!(),
    createProduct: args => client.createProduct!(args as never),
    bootstrapMcpProduct: args => client.bootstrapMcpProduct!(args as never),
    configureMcpPlans: args =>
      client.configureMcpPlans!(
        reqStr(args, 'productRef'),
        omitKeys(args, ['productRef']) as never,
      ),
    updateProduct: args =>
      client.updateProduct!(reqStr(args, 'productRef'), omitKeys(args, ['productRef']) as never),
    deleteProduct: async args => {
      await client.deleteProduct!(reqStr(args, 'productRef'))
      return null
    },
    cloneProduct: args => {
      const name = typeof args.name === 'string' ? args.name : undefined
      return client.cloneProduct!(
        reqStr(args, 'productRef'),
        name !== undefined ? { name } : undefined,
      )
    },
    listPlans: args => client.listPlans!(reqStr(args, 'productRef')),
    createPlan: args => client.createPlan!(args as never),
    updatePlan: args =>
      client.updatePlan!(
        reqStr(args, 'productRef'),
        reqStr(args, 'planRef'),
        omitKeys(args, ['productRef', 'planRef']) as never,
      ),
    deletePlan: async args => {
      await client.deletePlan!(reqStr(args, 'productRef'), reqStr(args, 'planRef'))
      return null
    },
    createPaymentIntent: args => client.createPaymentIntent!(args as never),
    createTopupPaymentIntent: args => client.createTopupPaymentIntent!(args as never),
    cancelPurchase: args => client.cancelPurchase!(args as never),
    reactivatePurchase: args => client.reactivatePurchase!(args as never),
    processPaymentIntent: args => client.processPaymentIntent!(args as never),
    attachBusinessDetails: args => client.attachBusinessDetails!(args as never),
    getUserInfo: args => client.getUserInfo!(args as never),
    getCustomerBalance: args => client.getCustomerBalance!(args as never),
    createCheckoutSession: args => client.createCheckoutSession!(args as never),
    createCustomerSession: args => client.createCustomerSession!(args as never),
    activatePlan: args => client.activatePlan!(args as never),
    getPaymentMethod: args => client.getPaymentMethod!(args as never),
    getAutoRecharge: args => client.getAutoRecharge!(args as never),
    saveAutoRecharge: args => client.saveAutoRecharge!(args as never),
    disableAutoRecharge: args => client.disableAutoRecharge!(args as never),
  }
  return dispatchers
}

function errorObservation(error: unknown): Record<string, unknown> {
  // Duck-type only — avoid `instanceof` across package copies / undefined ctors.
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name
    const message = (error as { message?: unknown }).message
    const status = (error as { status?: unknown }).status
    if (typeof message === 'string') {
      if (name === 'SolvaPayError' || name === 'PaywallError') {
        return {
          name,
          message,
          status: typeof status === 'number' ? status : undefined,
          kind: name === 'PaywallError' ? 'Paywall' : 'Api',
        }
      }
      if (typeof name === 'string') {
        return { name, message, kind: 'Transport' }
      }
    }
  }
  return {
    name: 'Error',
    message: String(error),
    kind: 'Transport',
  }
}

/**
 * Create a TS driver that records fetch exchanges per invoke.
 */
export function createTsShadowDriver(options: TsDriverOptions): TsDriver {
  const wireBucket: WireExchange[] = []
  const baseFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const recordingFetch = createRecordingFetch(baseFetch, wireBucket)

  // createSolvaPayClient uses global fetch — install for the lifetime of invokes.
  const previousFetch = globalThis.fetch
  globalThis.fetch = recordingFetch

  const client = createSolvaPayClient({
    apiKey: options.apiKey,
    apiBaseUrl: options.apiBaseUrl,
  })
  const dispatchers = buildDispatchers(client)

  const operationNames = Object.keys(dispatchers).sort()

  return {
    operationNames,
    async invoke(fn, args) {
      wireBucket.length = 0
      const dispatcher = dispatchers[fn]
      if (!dispatcher) {
        throw new Error(`No TS shadow dispatcher for fn: ${fn}`)
      }
      try {
        const value = await dispatcher(args)
        return {
          ok: true,
          value: value === undefined ? null : value,
          wire: [...wireBucket],
        }
      } catch (error) {
        return {
          ok: false,
          value: errorObservation(error),
          wire: [...wireBucket],
        }
      } finally {
        // Keep recording fetch installed for subsequent invokes on this driver.
        globalThis.fetch = recordingFetch
      }
    },
  }
}

/** Restore global fetch after a driver session (tests / orchestrator teardown). */
export function restoreGlobalFetch(previous: typeof fetch = fetch): void {
  globalThis.fetch = previous
}

// Ensure we can restore the original after createTsShadowDriver patches it.
let _originalFetch: typeof fetch | undefined

/**
 * Install a TS shadow driver session.
 *
 * Pins `SOLVAPAY_IMPL=ts` for the session so the "TS" side actually executes
 * the TypeScript client (fetch-recorded). After Step 37R client cutover, an
 * unset/`rust` ambient flag would route through NativeClient/reqwest and leave
 * `tsWire` empty — breaking the intentional-divergence control and live
 * wire dumps.
 */
export function installTsDriverSession(options: TsDriverOptions): {
  driver: TsDriver
  restore: () => void
} {
  _originalFetch = globalThis.fetch
  const previousImpl = process.env.SOLVAPAY_IMPL
  process.env.SOLVAPAY_IMPL = 'ts'
  const driver = createTsShadowDriver(options)
  return {
    driver,
    restore: () => {
      if (_originalFetch) {
        globalThis.fetch = _originalFetch
      }
      if (previousImpl === undefined) {
        delete process.env.SOLVAPAY_IMPL
      } else {
        process.env.SOLVAPAY_IMPL = previousImpl
      }
    },
  }
}
