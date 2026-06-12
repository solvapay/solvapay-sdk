/**
 * Default HTTP transport — wraps `config.api` + `config.fetch` so every SDK
 * hook and component routes through a single place. Extracted from the
 * inline `buildDefault*` callbacks that used to live inside
 * `SolvaPayProvider`.
 */

import type { Plan, SolvaPayConfig } from '../types'
import type {
  SolvaPayTransport,
  TransportBalanceResult,
  TransportCheckoutSessionResult,
  TransportCustomerSessionResult,
} from './types'
import { buildRequestHeaders } from '../utils/headers'
import { readErrorMessage } from '../utils/readErrorMessage'

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
    const message = await readErrorMessage(res, opts.errorPrefix)
    const error = new Error(message)
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
  processTopupPayment: '/api/process-topup-payment',
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
  getLimits: '/api/limits',
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
      if (params.currency) body.currency = params.currency
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

    processTopupPayment: params =>
      request(config, routeFor(config, 'processTopupPayment'), {
        method: 'POST',
        body: { paymentIntentId: params.paymentIntentId },
        onErrorContext: 'processTopupPayment',
        errorPrefix: 'Failed to process topup payment',
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

    listPlans: async productRef => {
      const base = routeFor(config, 'listPlans')
      const url = `${base}?productRef=${encodeURIComponent(productRef)}`
      // The wire format is `{ plans, productRef }` (see `listPlansCore` in
      // @solvapay/server). The transport contract is `Plan[]`, so unwrap
      // here — same shape `defaultListPlans` returns from its non-transport
      // path. Without this, `useTransport().listPlans()` accidentally
      // surfaces the wrapped object.
      const data = await request<{ plans?: Plan[] }>(config, url, {
        method: 'GET',
        onErrorContext: 'listPlans',
        errorPrefix: 'Failed to list plans',
      })
      return data.plans ?? []
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

    getLimits: async ({ productRef, meterName }) => {
      const base = routeFor(config, 'getLimits')
      const params = new URLSearchParams({ productRef })
      if (meterName) params.set('meterName', meterName)
      const url = `${base}?${params.toString()}`
      // The wire format is the full `LimitResponseWithPlan` from
      // `checkLimitsCore`. The transport contract is the narrower
      // `TransportLimitsResult`, so project the fields the React
      // surface actually consumes — the rest stays on the server side.
      const data = await request<{
        withinLimits: boolean
        remaining: number
        meterName?: string | null
        activationRequired?: boolean
      }>(config, url, {
        method: 'GET',
        onErrorContext: 'getLimits',
        errorPrefix: 'Failed to fetch limits',
      })
      return {
        withinLimits: data.withinLimits,
        remaining: data.remaining,
        meterName: data.meterName ?? null,
        activationRequired: data.activationRequired ?? false,
      }
    },
  }
}
