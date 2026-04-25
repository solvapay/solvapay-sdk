/**
 * Default HTTP transport — wraps `config.api` + `config.fetch` so every SDK
 * hook and component routes through a single place. Extracted from the
 * inline `buildDefault*` callbacks that used to live inside
 * `SolvaPayProvider`.
 */

import type { SolvaPayConfig } from '../types'
import type {
  SolvaPayTransport,
  TransportBalanceResult,
  TransportCheckoutSessionResult,
  TransportCustomerSessionResult,
} from './types'
import { buildRequestHeaders } from '../utils/headers'

type FetchFn = typeof fetch

interface RouteOptions {
  method: 'GET' | 'POST'
  body?: unknown
  onErrorContext: string
  errorPrefix: string
}

async function request<T>(
  config: SolvaPayConfig | undefined,
  url: string,
  opts: RouteOptions,
): Promise<T> {
  const { headers } = await buildRequestHeaders(config)
  const fetchFn: FetchFn = config?.fetch || fetch
  const init: RequestInit = { method: opts.method, headers }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
  }

  const res = await fetchFn(url, init)
  if (!res.ok) {
    let serverMessage: string | undefined
    try {
      const data = (await res.clone().json()) as { error?: string }
      serverMessage = data?.error
    } catch {
      // ignore: response may not be JSON
    }
    const error = new Error(serverMessage || `${opts.errorPrefix}: ${res.statusText || res.status}`)
    config?.onError?.(error, opts.onErrorContext)
    throw error
  }
  return (await res.json()) as T
}

export const DEFAULT_ROUTES = {
  checkPurchase: '/api/check-purchase',
  createPayment: '/api/create-payment-intent',
  processPayment: '/api/process-payment',
  createTopupPayment: '/api/create-topup-payment-intent',
  customerBalance: '/api/customer-balance',
  cancelRenewal: '/api/cancel-renewal',
  reactivateRenewal: '/api/reactivate-renewal',
  activatePlan: '/api/activate-plan',
  createCheckoutSession: '/api/create-checkout-session',
  createCustomerSession: '/api/create-customer-session',
  getMerchant: '/api/merchant',
  getProduct: '/api/get-product',
  listPlans: '/api/list-plans',
  getPaymentMethod: '/api/payment-method',
  getUsage: '/api/usage',
} as const

function routeFor(
  config: SolvaPayConfig | undefined,
  key: keyof typeof DEFAULT_ROUTES,
): string {
  const configured = config?.api?.[key as keyof NonNullable<SolvaPayConfig['api']>]
  return configured || DEFAULT_ROUTES[key]
}

export function createHttpTransport(config: SolvaPayConfig | undefined): SolvaPayTransport {
  return {
    checkPurchase: () =>
      request(config, routeFor(config, 'checkPurchase'), {
        method: 'GET',
        onErrorContext: 'checkPurchase',
        errorPrefix: 'Failed to check purchase',
      }),

    createPayment: params => {
      const body: Record<string, unknown> = {}
      if (params.planRef) body.planRef = params.planRef
      if (params.productRef) body.productRef = params.productRef
      if (params.customer && (params.customer.name || params.customer.email)) {
        body.customer = params.customer
      }
      return request(config, routeFor(config, 'createPayment'), {
        method: 'POST',
        body,
        onErrorContext: 'createPayment',
        errorPrefix: 'Failed to create payment',
      })
    },

    processPayment: params =>
      request(config, routeFor(config, 'processPayment'), {
        method: 'POST',
        body: params,
        onErrorContext: 'processPayment',
        errorPrefix: 'Failed to process payment',
      }),

    createTopupPayment: params =>
      request(config, routeFor(config, 'createTopupPayment'), {
        method: 'POST',
        body: { amount: params.amount, currency: params.currency },
        onErrorContext: 'createTopupPayment',
        errorPrefix: 'Failed to create topup payment',
      }),

    getBalance: () =>
      request<TransportBalanceResult>(config, routeFor(config, 'customerBalance'), {
        method: 'GET',
        onErrorContext: 'getBalance',
        errorPrefix: 'Failed to fetch balance',
      }),

    cancelRenewal: params =>
      request(config, routeFor(config, 'cancelRenewal'), {
        method: 'POST',
        body: params,
        onErrorContext: 'cancelRenewal',
        errorPrefix: 'Failed to cancel renewal',
      }),

    reactivateRenewal: params =>
      request(config, routeFor(config, 'reactivateRenewal'), {
        method: 'POST',
        body: params,
        onErrorContext: 'reactivateRenewal',
        errorPrefix: 'Failed to reactivate renewal',
      }),

    activatePlan: params =>
      request(config, routeFor(config, 'activatePlan'), {
        method: 'POST',
        body: params,
        onErrorContext: 'activatePlan',
        errorPrefix: 'Failed to activate plan',
      }),

    createCheckoutSession: params => {
      const body: Record<string, unknown> = {}
      if (params?.planRef) body.planRef = params.planRef
      if (params?.productRef) body.productRef = params.productRef
      if (params?.returnUrl) body.returnUrl = params.returnUrl
      return request<TransportCheckoutSessionResult>(
        config,
        routeFor(config, 'createCheckoutSession'),
        {
          method: 'POST',
          body,
          onErrorContext: 'createCheckoutSession',
          errorPrefix: 'Failed to create checkout session',
        },
      )
    },

    createCustomerSession: () =>
      request<TransportCustomerSessionResult>(
        config,
        routeFor(config, 'createCustomerSession'),
        {
          method: 'POST',
          body: {},
          onErrorContext: 'createCustomerSession',
          errorPrefix: 'Failed to create customer session',
        },
      ),

    getMerchant: () =>
      request(config, routeFor(config, 'getMerchant'), {
        method: 'GET',
        onErrorContext: 'getMerchant',
        errorPrefix: 'Failed to fetch merchant',
      }),

    getProduct: productRef => {
      const base = routeFor(config, 'getProduct')
      const url = `${base}?productRef=${encodeURIComponent(productRef)}`
      return request(config, url, {
        method: 'GET',
        onErrorContext: 'getProduct',
        errorPrefix: 'Failed to fetch product',
      })
    },

    listPlans: productRef => {
      const base = routeFor(config, 'listPlans')
      const url = `${base}?productRef=${encodeURIComponent(productRef)}`
      return request(config, url, {
        method: 'GET',
        onErrorContext: 'listPlans',
        errorPrefix: 'Failed to list plans',
      })
    },

    getPaymentMethod: () =>
      request(config, routeFor(config, 'getPaymentMethod'), {
        method: 'GET',
        onErrorContext: 'getPaymentMethod',
        errorPrefix: 'Failed to load payment method',
      }),

    getUsage: () =>
      request(config, routeFor(config, 'getUsage'), {
        method: 'GET',
        onErrorContext: 'getUsage',
        errorPrefix: 'Failed to load usage',
      }),
  }
}
