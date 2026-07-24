import Link from 'next/link'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">SolvaPay shadcn/ui example</h1>
      <p className="mt-3 text-muted-foreground">
        SolvaPay primitives composed with shadcn/ui via <code>asChild</code>. Behaviour
        comes from the primitives; appearance comes from the shadcn tokens and components.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/checkout">
          <Card className="p-6 transition hover:shadow-md">
            <CardContent className="p-0">
              <CardTitle className="text-lg">Checkout →</CardTitle>
              <CardDescription className="mt-2">
                PlanSelector + PaymentForm composed over Card + Button.
              </CardDescription>
            </CardContent>
          </Card>
        </Link>
        <Link href="/topup">
          <Card className="p-6 transition hover:shadow-md">
            <CardContent className="p-0">
              <CardTitle className="text-lg">Top up →</CardTitle>
              <CardDescription className="mt-2">
                AmountPicker + TopupForm composed over Button.
              </CardDescription>
            </CardContent>
          </Card>
        </Link>
      </div>
    </main>
  )
}
