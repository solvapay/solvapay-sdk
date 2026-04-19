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
            <TopupForm.Loading className="text-sm text-muted-foreground" />
            <TopupForm.Error className="text-sm text-destructive" />
            <TopupForm.SubmitButton asChild>
              <Button size="lg" className="w-full" />
            </TopupForm.SubmitButton>
            <Button
              variant="ghost"
              onClick={() => setAmountCents(null)}
              className="self-start"
            >
              ← Change amount
            </Button>
          </TopupForm.Root>
        )}
      </Card>
    </main>
  )
}
