import { Link } from 'react-router-dom'
import { usePurchase } from '@solvapay/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function Dashboard() {
  const { loading, error, name, email, activePurchase, hasPaidPurchase } = usePurchase()

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>
            {loading ? 'Loading your purchase…' : 'Your account at a glance.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {error && <p className="text-destructive">{error.message}</p>}
          {!loading && (
            <>
              <p>
                <span className="text-muted-foreground">Customer: </span>
                {name || email || 'Anonymous'}
              </p>
              {activePurchase ? (
                <p>
                  <span className="text-muted-foreground">Active plan: </span>
                  {activePurchase.productName}
                  {activePurchase.planType ? ` (${activePurchase.planType})` : ''}
                </p>
              ) : (
                <p className="text-muted-foreground">No active purchase yet.</p>
              )}
              {!hasPaidPurchase && (
                <Button asChild className="mt-2 self-start">
                  <Link to="/checkout">Start checkout</Link>
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
