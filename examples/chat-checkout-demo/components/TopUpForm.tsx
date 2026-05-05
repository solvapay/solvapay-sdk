import React, { useCallback, useMemo, useState } from 'react'
import { LegalFooter, MandateText, TopupForm } from '@solvapay/react/primitives'
import {
  formatPrice,
  useBalance,
  useLocale,
  usePlans,
  useProduct,
  useTransport,
} from '@solvapay/react'
import { CheckCircleIcon } from './icons/CheckCircleIcon'
import { LockIcon } from './icons/LockIcon'
import { TopUpSelection as SelectionType } from '../types'
import { TopUpSelection } from './TopUpSelection'
import { DrawerHeader } from './DrawerHeader'
import { env } from '../src/lib/env'

interface TopUpFormProps {
  onSuccess: (selection: SelectionType) => void
}

export const TopUpForm: React.FC<TopUpFormProps> = ({ onSuccess }) => {
  const [step, setStep] = useState<'select' | 'confirm' | 'success'>('select')
  const [selection, setSelection] = useState<SelectionType>({
    planRef: '',
    autoTopUpEnabled: true,
  })
  const [error, setError] = useState<string | null>(null)
  const productRef = env.topup.productRef
  const { displayCurrency, creditsPerMinorUnit, displayExchangeRate, adjustBalance } = useBalance()
  const locale = useLocale()

  const transport = useTransport()
  const fetcher = useCallback(
    async (ref: string) => {
      if (!transport.listPlans) throw new Error('Transport does not support listPlans')
      return transport.listPlans(ref)
    },
    [transport],
  )
  const { plans, loading } = usePlans({ productRef: productRef || undefined, fetcher })
  const { product } = useProduct(productRef || undefined)

  // Treat every plan with a positive price as a credit pack. Sorted by
  // price ascending so the cheapest pack renders first and the largest
  // gets the "Popular" treatment in the picker.
  const packs = useMemo(
    () =>
      plans
        .filter(p => p.requiresPayment !== false && (p.price ?? 0) > 0)
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0)),
    [plans],
  )

  const selectedPack = useMemo(
    () => packs.find(p => p.reference === selection.planRef),
    [packs, selection.planRef],
  )

  const amountMinor = selectedPack?.price ?? 0
  const currency = (selectedPack?.currency || displayCurrency || 'USD').toUpperCase()
  const formattedAmount = selectedPack
    ? formatPrice(amountMinor, currency, { locale })
    : '—'

  const handlePaid = () => {
    // Stripe just confirmed — credits land on the backend a moment later
    // when the SolvaPay webhook fires. Optimistically bump the local
    // balance now so the header pill flips from "0 CREDITS" to the new
    // amount instantly; the SDK's 8s grace window auto-refetches to
    // reconcile with the backend once the webhook has run.
    //
    // On a brand-new customer the rate fields are still null because no
    // successful balance fetch has populated them — fall back to the
    // demo merchant's USD config (1 credit = 1 cent) so the bump still
    // fires. The reconciliation step will overwrite with truth.
    const rate = displayExchangeRate ?? 1
    const perMinor = creditsPerMinorUnit ?? 100
    const minted = Math.floor((amountMinor / rate) * perMinor)
    if (minted > 0) adjustBalance(minted)
    setStep('success')
    window.setTimeout(() => onSuccess(selection), 1500)
  }

  const handleError = (e: Error) => {
    console.error('[TopUpForm] payment error:', e)
    setError(e.message)
  }

  if (!productRef) {
    return (
      <div className="px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            Set <code className="font-mono">VITE_TOPUP_PRODUCT_REF</code> in <code>.env</code> to
            enable the top-up scenario.
          </div>
        </div>
      </div>
    )
  }

  if (step === 'success') {
    return (
      <div className="px-4 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 border border-emerald-200">
              <CheckCircleIcon className="h-6 w-6 text-emerald-700" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mt-3">Credits added</h2>
            <p className="text-slate-500 mt-1">
              {selectedPack?.name ?? 'Your top-up'} has been added to your account.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'select') {
    return (
      <div className="px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5">
            <DrawerHeader />
            {loading ? (
              <PlansLoading />
            ) : (
              <TopUpSelection
                packs={packs}
                initial={selection}
                onContinue={sel => {
                  setSelection(sel)
                  setStep('confirm')
                }}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5">
          <DrawerHeader />
          <h2 className="text-lg font-semibold text-slate-900 mb-1">{product?.name ?? 'Add Credits'}</h2>
          <p className="text-sm text-slate-600 mb-4">
            Pay {formattedAmount} for {selectedPack?.name ?? 'your top-up'}.
          </p>

          <div className="mb-5 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200/70">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{formattedAmount}</h3>
                <p className="text-xs text-slate-600">
                  {selectedPack?.name ?? 'Top-up'} • Instant top-up
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-500">{currency}</div>
              </div>
            </div>
          </div>

          <TopupForm.Root
            amount={amountMinor}
            currency={currency}
            onSuccess={handlePaid}
            onError={handleError}
          >
            <div className="space-y-4">
              <TopupForm.PaymentElement />
              <div className="flex items-center justify-end text-xs text-slate-500">
                <LockIcon className="h-3.5 w-3.5 mr-1" />
                Secured by Stripe
              </div>
            </div>

            <TopupForm.Error className="mt-3 text-sm text-red-600" />

            <MandateText
              mode="topup"
              amountMinor={amountMinor}
              currency={currency}
              className="mt-4 text-xs text-slate-500"
            />

            <div className="mt-5">
              <TopupForm.SubmitButton asChild>
                <button className="group w-full flex justify-center items-center py-2.5 px-4 rounded-full text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                  Pay {formattedAmount}
                </button>
              </TopupForm.SubmitButton>
            </div>
          </TopupForm.Root>

          <button
            onClick={() => setStep('select')}
            className="mt-4 text-sm text-slate-600 hover:text-slate-900 block"
          >
            ← Change amount
          </button>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          <LegalFooter className="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-500" />
        </div>
      </div>
    </div>
  )
}

const PlansLoading: React.FC = () => (
  <div className="flex items-center justify-center py-8">
    <svg
      className="animate-spin h-5 w-5 text-slate-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  </div>
)
