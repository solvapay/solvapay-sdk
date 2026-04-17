/**
 * Integration tests: verify that CheckoutSummary, MandateText, and PaymentForm
 * fall back to PlanSelectionContext when their `planRef` / `productRef` props
 * are omitted. Each component keeps its existing prop-based API; the context
 * is a pure fallback so existing consumers are unaffected.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { CheckoutSummary } from './CheckoutSummary'
import { MandateText } from './MandateText'
import { PlanSelectionProvider } from './PlanSelectionContext'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import type { Plan } from '../types'

const monthlyPlan: Plan = {
  reference: 'pln_monthly',
  name: 'Monthly',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
}

const plansByRef = [monthlyPlan]

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
  merchantCache.clear()
})

function seedCaches(productRef = 'prd_ctx') {
  plansCache.set(productRef, {
    plans: plansByRef,
    timestamp: Date.now(),
    promise: null,
  })
  productCache.set(productRef, {
    product: { reference: productRef, name: 'Widget API' },
    promise: null,
    timestamp: Date.now(),
  })
}

describe('PlanSelectionContext fallback — CheckoutSummary', () => {
  it('reads selectedPlanRef + productRef from context when props are omitted', async () => {
    seedCaches()
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelectionProvider
          value={{
            productRef: 'prd_ctx',
            selectedPlanRef: 'pln_monthly',
            setSelectedPlanRef: () => {},
            plans: plansByRef,
            loading: false,
            error: null,
          }}
        >
          <CheckoutSummary />
        </PlanSelectionProvider>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Monthly')).toBeTruthy())
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('$19.99 / month')).toBeTruthy()
  })

  it('prop planRef wins over context', async () => {
    seedCaches()
    plansCache.set('prd_other', {
      plans: [
        {
          reference: 'pln_yearly',
          name: 'Yearly',
          price: 19900,
          currency: 'usd',
          type: 'recurring',
          interval: 'year',
        },
      ],
      timestamp: Date.now(),
      promise: null,
    })
    productCache.set('prd_other', {
      product: { reference: 'prd_other', name: 'Other Product' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelectionProvider
          value={{
            productRef: 'prd_ctx',
            selectedPlanRef: 'pln_monthly',
            setSelectedPlanRef: () => {},
            plans: plansByRef,
            loading: false,
            error: null,
          }}
        >
          <CheckoutSummary planRef="pln_yearly" productRef="prd_other" />
        </PlanSelectionProvider>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Yearly')).toBeTruthy())
    expect(screen.getByText('Other Product')).toBeTruthy()
  })
})

describe('PlanSelectionContext fallback — MandateText', () => {
  it('reads selectedPlanRef + productRef from context when props are omitted', async () => {
    seedCaches()
    merchantCache.set('/api/merchant', {
      merchant: {
        legalName: 'Acme Inc',
        displayName: 'Acme',
      },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{}}>
        <PlanSelectionProvider
          value={{
            productRef: 'prd_ctx',
            selectedPlanRef: 'pln_monthly',
            setSelectedPlanRef: () => {},
            plans: plansByRef,
            loading: false,
            error: null,
          }}
        >
          <MandateText />
        </PlanSelectionProvider>
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText(/Acme Inc/)).toBeTruthy())
  })
})
