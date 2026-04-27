'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useBalance } from '@solvapay/react'
import { AmountPicker, TopupForm } from '@solvapay/react/primitives'

export default function TopupPage() {
  const { displayCurrency } = useBalance()
  const currency = displayCurrency || 'USD'
  const [amountCents, setAmountCents] = useState<number | null>(null)

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-slate-500 hover:text-slate-900"
      >
        ← Back
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Top up credits</h1>

      {amountCents === null ? (
        <AmountPicker.Root currency={currency} className="mt-8 flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-2">
            {[10, 50, 100, 500].map(amount => (
              <AmountPicker.Option
                key={amount}
                amount={amount}
                className="
                  rounded-lg border px-3 py-2 text-sm font-medium transition
                  data-[state=idle]:border-slate-200 data-[state=idle]:bg-white data-[state=idle]:text-slate-900 data-[state=idle]:hover:border-slate-400
                  data-[state=selected]:border-slate-900 data-[state=selected]:bg-slate-900 data-[state=selected]:text-white
                  data-[state=disabled]:cursor-not-allowed data-[state=disabled]:opacity-50
                "
              />
            ))}
          </div>
          <AmountPicker.Custom
            className="
              w-full rounded-lg border px-4 py-3 text-base transition
              data-[state=dormant]:border-slate-200 data-[state=dormant]:text-slate-500
              data-[state=active]:border-slate-900 data-[state=active]:text-slate-900
              focus:outline-none focus:ring-2 focus:ring-slate-900/20
            "
          />
          <AmountPicker.Confirm
            onConfirm={amount => setAmountCents(Math.round(amount * 100))}
            className="
              w-full rounded-lg px-6 py-3 text-sm font-semibold transition
              data-[state=idle]:bg-slate-900 data-[state=idle]:text-white data-[state=idle]:hover:bg-slate-800
              data-[state=disabled]:cursor-not-allowed data-[state=disabled]:bg-slate-300 data-[state=disabled]:text-slate-500
            "
          >
            Continue to payment
          </AmountPicker.Confirm>
        </AmountPicker.Root>
      ) : (
        <TopupForm.Root
          amount={amountCents}
          currency={currency}
          className="mt-8 flex flex-col gap-4"
        >
          <TopupForm.PaymentElement />
          <TopupForm.Loading className="text-sm text-slate-500">
            Preparing payment form…
          </TopupForm.Loading>
          <TopupForm.Error className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" />
          <TopupForm.SubmitButton
            className="
              rounded-lg px-6 py-3 text-sm font-semibold transition
              data-[state=idle]:bg-slate-900 data-[state=idle]:text-white data-[state=idle]:hover:bg-slate-800
              data-[state=processing]:cursor-wait data-[state=processing]:bg-slate-700 data-[state=processing]:text-white
              data-[state=disabled]:cursor-not-allowed data-[state=disabled]:bg-slate-300 data-[state=disabled]:text-slate-500
            "
          />
          <button
            type="button"
            onClick={() => setAmountCents(null)}
            className="self-start text-sm text-slate-500 hover:text-slate-900"
          >
            ← Change amount
          </button>
        </TopupForm.Root>
      )}
    </main>
  )
}
