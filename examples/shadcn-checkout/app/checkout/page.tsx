'use client'

/**
 * Canonical registry file (4/4).
 *
 * Composes SolvaPay primitives against shadcn/ui primitives via `asChild`.
 * The SolvaPay components own the behaviour (state machine, a11y,
 * data-state attributes); the shadcn components own the visual surface.
 */

import Link from 'next/link'
import { PaymentForm, PlanSelector } from '@solvapay/react/primitives'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const PRODUCT_REF = process.env.NEXT_PUBLIC_PRODUCT_REF || 'prd_demo'

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back
      </Link>

      <PlanSelector.Root productRef={PRODUCT_REF} className="space-y-6">
        <PlanSelector.Heading className="text-2xl font-semibold tracking-tight" />
        <PlanSelector.Grid className="grid gap-3">
          <PlanSelector.Card asChild>
            <Card
              className="
                cursor-pointer p-5 text-left transition
                data-[state=selected]:ring-2 data-[state=selected]:ring-primary
                data-[state=current]:border-emerald-600 data-[state=current]:bg-emerald-50
                data-[state=disabled]:cursor-not-allowed data-[state=disabled]:opacity-60
              "
            >
              <div className="flex items-baseline justify-between">
                <PlanSelector.CardName className="text-base font-medium" />
                <PlanSelector.CardBadge className="text-xs font-medium uppercase tracking-wide text-primary" />
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <PlanSelector.CardPrice className="text-2xl font-bold" />
                <PlanSelector.CardInterval className="text-sm text-muted-foreground" />
              </div>
            </Card>
          </PlanSelector.Card>
        </PlanSelector.Grid>
        <PlanSelector.Loading className="text-sm text-muted-foreground">
          Loading plans…
        </PlanSelector.Loading>
        <PlanSelector.Error className="rounded-lg border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive" />

        <div className="border-t pt-6">
          <PaymentForm.Root requireTermsAcceptance className="flex flex-col gap-4">
            <PaymentForm.Summary />
            <PaymentForm.CustomerFields />
            <PaymentForm.PaymentElement />
            <PaymentForm.TermsCheckbox />
            <PaymentForm.Error className="text-sm text-destructive" />
            <PaymentForm.Loading className="text-sm text-muted-foreground" />
            <PaymentForm.SubmitButton asChild>
              <Button size="lg" className="w-full" />
            </PaymentForm.SubmitButton>
          </PaymentForm.Root>
        </div>
      </PlanSelector.Root>
    </main>
  )
}
