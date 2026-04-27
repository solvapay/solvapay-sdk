'use client'

import Link from 'next/link'
import { PaymentForm, PlanSelector } from '@solvapay/react/primitives'

const PRODUCT_REF = process.env.NEXT_PUBLIC_PRODUCT_REF || 'prd_demo'

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-slate-500 hover:text-slate-900"
      >
        ← Back
      </Link>

      <PlanSelector.Root productRef={PRODUCT_REF} className="space-y-6">
        <PlanSelector.Heading className="text-2xl font-semibold tracking-tight text-slate-900" />
        <PlanSelector.Grid className="grid gap-3">
          <PlanSelector.Card
            className="
              w-full rounded-lg border bg-white p-5 text-left transition
              data-[state=idle]:border-slate-200 data-[state=idle]:hover:border-slate-400
              data-[state=selected]:border-indigo-600 data-[state=selected]:ring-2 data-[state=selected]:ring-indigo-600/20
              data-[state=current]:border-emerald-600 data-[state=current]:bg-emerald-50
              data-[state=disabled]:cursor-not-allowed data-[state=disabled]:opacity-60
              data-[popular]:ring-2 data-[popular]:ring-indigo-400/30
            "
          >
            <div className="flex items-baseline justify-between">
              <PlanSelector.CardName className="text-base font-medium text-slate-900" />
              <PlanSelector.CardBadge className="text-xs font-medium uppercase tracking-wide text-indigo-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <PlanSelector.CardPrice className="text-2xl font-bold text-slate-900" />
              <PlanSelector.CardInterval className="text-sm text-slate-500" />
            </div>
          </PlanSelector.Card>
        </PlanSelector.Grid>
        <PlanSelector.Loading className="text-sm text-slate-500">
          Loading plans…
        </PlanSelector.Loading>
        <PlanSelector.Error className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" />

        <div className="border-t border-slate-200 pt-6">
          <PaymentForm.Root
            requireTermsAcceptance
            className="
              flex flex-col gap-4
              data-[state=error]:rounded-lg data-[state=error]:border data-[state=error]:border-red-200 data-[state=error]:bg-red-50 data-[state=error]:p-4
            "
          >
            <PaymentForm.Summary />
            <PaymentForm.CustomerFields />
            <PaymentForm.PaymentElement />
            <PaymentForm.TermsCheckbox />
            <PaymentForm.Error className="text-sm text-red-600" />
            <PaymentForm.Loading className="text-sm text-slate-500" />
            <PaymentForm.SubmitButton
              className="
                inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold
                data-[state=idle]:bg-slate-900 data-[state=idle]:text-white data-[state=idle]:hover:bg-slate-800
                data-[state=processing]:cursor-wait data-[state=processing]:bg-slate-700 data-[state=processing]:text-white
                data-[state=disabled]:cursor-not-allowed data-[state=disabled]:bg-slate-300 data-[state=disabled]:text-slate-500
                data-[variant=free]:bg-emerald-600 data-[variant=free]:hover:bg-emerald-700
                data-[variant=activate]:bg-indigo-600 data-[variant=activate]:hover:bg-indigo-700
              "
            />
          </PaymentForm.Root>
        </div>
      </PlanSelector.Root>
    </main>
  )
}
