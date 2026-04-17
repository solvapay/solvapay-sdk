'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { useMemo } from 'react'
import type { AuthAdapter } from '@solvapay/react'

const SOLVAPAY_API_BASE = '/api/solvapay'

/**
 * Stub auth adapter.
 *
 * Returns a fixed user id so the client-side SDK hooks (useBalance,
 * usePurchase, etc.) can issue requests. On the server side, proxy.ts
 * injects `x-user-id: demo-user` on the matching request headers so
 * `requireUserId` resolves to the same identity.
 */
const stubAuthAdapter: AuthAdapter = {
  async getToken() {
    return 'stub-token'
  },
  async getUserId() {
    return 'demo-user'
  },
}

export function Providers({ children }: { children: React.ReactNode }) {
  const config = useMemo(
    () => ({
      auth: { adapter: stubAuthAdapter },
      api: {
        checkPurchase: `${SOLVAPAY_API_BASE}/check-purchase`,
        createPayment: `${SOLVAPAY_API_BASE}/create-payment-intent`,
        processPayment: `${SOLVAPAY_API_BASE}/process-payment`,
        createTopupPayment: `${SOLVAPAY_API_BASE}/create-topup-payment-intent`,
        customerBalance: `${SOLVAPAY_API_BASE}/customer-balance`,
        cancelRenewal: `${SOLVAPAY_API_BASE}/cancel-renewal`,
        reactivateRenewal: `${SOLVAPAY_API_BASE}/reactivate-renewal`,
        activatePlan: `${SOLVAPAY_API_BASE}/activate-plan`,
        listPlans: `${SOLVAPAY_API_BASE}/list-plans`,
        getMerchant: `${SOLVAPAY_API_BASE}/merchant`,
        getProduct: `${SOLVAPAY_API_BASE}/get-product`,
      },
    }),
    [],
  )
  return <SolvaPayProvider config={config}>{children}</SolvaPayProvider>
}
