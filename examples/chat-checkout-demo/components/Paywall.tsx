import React, { useCallback, useMemo } from 'react'
import {
  formatPrice,
  useLocale,
  usePlans,
  useTransport,
  type Plan,
} from '@solvapay/react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { SparklesIcon } from './icons/SparklesIcon'
import { ScenarioType } from '../types'

interface PaywallProps {
  onUnlock: () => void
  currentScenario?: ScenarioType
  productRef: string
  paywallContent: PaywallStructuredContent | null
}

interface BulletEntry {
  color: 'blue' | 'green' | 'purple'
  text: string
}

export const Paywall: React.FC<PaywallProps> = ({
  onUnlock,
  currentScenario = ScenarioType.SUBSCRIPTION,
  productRef,
  paywallContent,
}) => {
  const isTopUpScenario = currentScenario === ScenarioType.TOPUP
  const isDayPassScenario = currentScenario === ScenarioType.DAYPASS

  const transport = useTransport()
  const locale = useLocale()
  const fetcher = useCallback(
    async (ref: string) => {
      if (!transport.listPlans) throw new Error('Transport does not support listPlans')
      return transport.listPlans(ref)
    },
    [transport],
  )
  // Activation gates already carry plan summaries on `paywallContent.plans`.
  // Paid-product gates (`payment_required`) don't, so fall back to listing
  // the product's plans directly. The cache shared with the form below
  // means this is usually a no-op extra fetch.
  const { plans: livePlans } = usePlans({ productRef: productRef || undefined, fetcher })
  const plansFromGate =
    paywallContent && 'plans' in paywallContent && paywallContent.plans
      ? paywallContent.plans.map(planFromGate)
      : []
  const plans = livePlans.length > 0 ? livePlans : plansFromGate
  const paidPlan = plans.find(p => p.requiresPayment !== false && (p.price ?? 0) > 0)

  const bullets = useMemo<BulletEntry[]>(
    () => buildBullets(currentScenario, plans, paidPlan, locale),
    [currentScenario, plans, paidPlan, locale],
  )

  return (
    <div className="px-4 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200/60 flex items-center justify-center">
              <SparklesIcon className="h-4 w-4 text-slate-700" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 leading-tight">
                {isTopUpScenario
                  ? 'Out of credits'
                  : isDayPassScenario
                    ? 'Free use exceeded'
                    : 'Free limit reached'}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {isTopUpScenario
                  ? 'Top up to keep chatting'
                  : isDayPassScenario
                    ? 'Get a day pass to continue'
                    : 'Upgrade for unlimited access'}
              </p>
            </div>
          </div>

          <div className="hidden lg:flex items-center space-x-6 text-xs text-slate-500">
            {bullets.map((bullet, i) => (
              <BulletItem key={i} bullet={bullet} />
            ))}
          </div>

          <button
            onClick={onUnlock}
            className="px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-full hover:bg-slate-800 transition-colors group flex items-center space-x-2"
          >
            <span>
              {isTopUpScenario ? 'Add Credits' : isDayPassScenario ? 'Get Day Pass' : 'Upgrade'}
            </span>
            <svg
              className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </button>
        </div>

        {bullets.length > 0 && (
          <div className="lg:hidden flex items-center justify-center space-x-6 mt-3 pt-3 border-t border-slate-200/60">
            <div className="flex items-center space-x-6 text-xs text-slate-500">
              {bullets.map((bullet, i) => (
                <BulletItem key={i} bullet={bullet} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const BulletItem: React.FC<{ bullet: BulletEntry }> = ({ bullet }) => {
  const dotClass =
    bullet.color === 'blue'
      ? 'bg-blue-400'
      : bullet.color === 'purple'
        ? 'bg-purple-400'
        : 'bg-green-400'
  return (
    <div className="flex items-center space-x-1.5">
      <div className={`w-1.5 h-1.5 ${dotClass} rounded-full`}></div>
      <span>{bullet.text}</span>
    </div>
  )
}

function buildBullets(
  scenario: ScenarioType,
  plans: Plan[],
  paidPlan: Plan | undefined,
  locale: string | undefined,
): BulletEntry[] {
  if (scenario === ScenarioType.TOPUP) {
    const packs = plans
      .filter(p => p.requiresPayment !== false && (p.price ?? 0) > 0)
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
      .slice(0, 2)
    if (packs.length === 0) {
      return [{ color: 'green', text: 'Instant top-up' }]
    }
    return packs.map<BulletEntry>((pack, i) => ({
      color: i === 0 ? 'blue' : 'green',
      text: `${formatPrice(pack.price ?? 0, pack.currency ?? 'USD', { locale })} for ${pack.name ?? 'credits'}`,
    }))
  }

  if (scenario === ScenarioType.DAYPASS) {
    if (!paidPlan) {
      return [{ color: 'green', text: 'Unlimited messages' }]
    }
    const price = formatPrice(paidPlan.price ?? 0, paidPlan.currency ?? 'USD', { locale })
    return [
      { color: 'purple', text: `${price} for 24 hours` },
      { color: 'green', text: 'Unlimited messages' },
    ]
  }

  // Subscription
  if (!paidPlan) {
    return [
      { color: 'green', text: 'Unlimited messages' },
      { color: 'blue', text: 'Priority support' },
    ]
  }
  const price = formatPrice(paidPlan.price ?? 0, paidPlan.currency ?? 'USD', {
    locale,
    interval: paidPlan.billingCycle ?? paidPlan.interval,
  })
  return [
    { color: 'green', text: `${price}, unlimited messages` },
    { color: 'blue', text: 'Priority support' },
  ]
}

/**
 * `LimitPlanItemDto` (from `paywallContent.plans` on activation gates) is
 * a subset of the SDK `Plan` shape. Project the relevant fields so the
 * shared bullet builder can consume it without a separate code path.
 */
function planFromGate(p: {
  reference: string
  name?: string
  type: string
  price: number
  currency: string
  requiresPayment: boolean
  freeUnits?: number
  creditsPerUnit?: number
  billingModel?: string
  billingCycle?: string
}): Plan {
  return {
    reference: p.reference,
    name: p.name,
    price: p.price,
    currency: p.currency,
    requiresPayment: p.requiresPayment,
    ...(p.freeUnits !== undefined ? { freeUnits: p.freeUnits } : {}),
    ...(p.creditsPerUnit !== undefined ? { creditsPerUnit: p.creditsPerUnit } : {}),
    ...(p.billingCycle !== undefined ? { billingCycle: p.billingCycle } : {}),
    ...(p.billingModel === 'pre-paid' || p.billingModel === 'post-paid'
      ? { billingModel: p.billingModel }
      : {}),
  }
}
