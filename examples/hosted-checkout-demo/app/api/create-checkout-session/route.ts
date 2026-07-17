import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession } from '@solvapay/next'
import { createSolvaPay } from '@solvapay/server'

// True when NEXT_PUBLIC_SUPABASE_URL is absent or a placeholder value,
// meaning no real Supabase project is wired up.
const isDevMode =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')

export async function POST(request: NextRequest) {
  const { productRef, planRef } = await request.json()

  // Production path: delegate to the standard Next.js helper which reads
  // the x-user-id header injected by the Supabase auth middleware.
  if (!isDevMode) {
    return createCheckoutSession(request, { productRef, planRef })
  }

  // Dev-mode path: no Supabase configured, so the middleware never sets
  // x-user-id. Use a stub customer so the checkout flow can be exercised
  // with just a SolvaPay test key and no third-party auth account.
  try {
    const solvaPay = createSolvaPay()
    const customerRef = await solvaPay.ensureCustomer('dev-user', 'dev-user', {
      email: 'dev@example.com',
    })
    const session = await solvaPay.createCheckoutSession({
      productRef: productRef || process.env.NEXT_PUBLIC_PRODUCT_REF!,
      customerRef,
      planRef: planRef || undefined,
      returnUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    })
    return NextResponse.json({ checkoutUrl: session.checkoutUrl })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
