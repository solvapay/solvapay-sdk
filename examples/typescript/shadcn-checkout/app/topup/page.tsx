'use client'

/**
 * Topup page (demo-only; not part of the canonical 4 registry files for
 * PR 7). Demonstrates the same asChild composition pattern for
 * AmountPicker + TopupForm against shadcn/ui primitives.
 */

import Link from 'next/link'
import { useState } from 'react'
import { useBalance } from '@solvapay/react'
import { AmountPicker, TopupForm } from '@solvapay/react/primitives'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function TopupPage() {
  const { displayCurrency } = useBalance()
  const currency = displayCurrency || 'USD'
  const [amountCents, setAmountCents] = useState<number | null>(null)

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back
      </Link>

      <Card className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Top up credits</h1>

        {amountCents === null ? (
          <AmountPicker.Root currency={currency} className="mt-6 flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-2">
              {[10, 50, 100, 500].map(amount => (
                <AmountPicker.Option key={amount} amount={amount} asChild>
                  <Button
                    variant="outline"
                    className="
                      data-[state=selected]:border-primary data-[state=selected]:bg-primary
                      data-[state=selected]:text-primary-foreground
                    "
                  />
                </AmountPicker.Option>
              ))}
            </div>
            <AmountPicker.Custom
              className="
                w-full rounded-md border border-input bg-background px-3 py-2 text-sm
                focus:outline-none focus:ring-1 focus:ring-ring
              "
            />
            <AmountPicker.Confirm
              onConfirm={amount => setAmountCents(Math.round(amount * 100))}
              asChild
            >
              <Button size="lg" className="w-full">
                Continue to payment
              </Button>
            </AmountPicker.Confirm>
          </AmountPicker.Root>
        ) : (
          <TopupForm.Root
            amount={amountCents}
            currency={currency}
            className="mt-6 flex flex-col gap-4"
          >
            <TopupForm.PaymentElement />
            <TopupForm.BusinessDetails.Root className="flex flex-col gap-3 rounded-md border p-4">
              <label className="flex items-center gap-2 text-sm">
                <TopupForm.BusinessDetails.Toggle />
                I&apos;m purchasing as a business
              </label>
              <TopupForm.BusinessDetails.BusinessName className="rounded-md border px-3 py-2 text-sm" />
              <TopupForm.BusinessDetails.Country className="rounded-md border px-3 py-2 text-sm" />
              <TopupForm.BusinessDetails.TaxId className="rounded-md border px-3 py-2 text-sm" />
            </TopupForm.BusinessDetails.Root>
            <TopupForm.Summary.Root className="space-y-2 rounded-md border p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <TopupForm.Summary.Subtotal />
              </div>
              <TopupForm.Summary.Tax className="flex justify-between text-muted-foreground" />
              <div className="flex justify-between border-t pt-2 font-medium">
                <span>Total</span>
                <TopupForm.Summary.Total />
              </div>
            </TopupForm.Summary.Root>
            <TopupForm.Loading className="text-sm text-muted-foreground" />
            <TopupForm.Error className="text-sm text-destructive" />
            <TopupForm.SubmitButton asChild>
              <Button size="lg" className="w-full" />
            </TopupForm.SubmitButton>
            <Button variant="ghost" onClick={() => setAmountCents(null)} className="self-start">
              ← Change amount
            </Button>
          </TopupForm.Root>
        )}
      </Card>
    </main>
  )
}
