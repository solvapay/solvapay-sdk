import { NextRequest } from 'next/server'
import { confirmPayment } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { paymentIntentId, cardId, paymentMethodId, returnUrl, billingDetails } =
    await request.json()
  return confirmPayment(request, {
    paymentIntentId,
    cardId,
    paymentMethodId,
    returnUrl,
    billingDetails,
  })
}
