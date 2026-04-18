import { Link } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">SolvaPay SPA example</h1>
      <p className="mt-3 text-muted-foreground">
        Vite + React Router + Tailwind v3 + shadcn/ui. Mirrors Lovable's default stack and
        wires to a Supabase Edge backend via <code>@solvapay/react-supabase</code>.
      </p>

      <Card className="mt-10">
        <CardHeader>
          <CardTitle>Checkout</CardTitle>
          <CardDescription>
            Log in, pick a plan, pay, and land on the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link to="/checkout">Go to checkout →</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/login">Log in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
