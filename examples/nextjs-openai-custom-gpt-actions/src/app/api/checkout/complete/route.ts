import { NextRequest, NextResponse } from 'next/server'

/**
 * Checkout Complete Route
 * 
 * This route is called by SolvaPay's hosted checkout page after payment completion.
 * SolvaPay redirects here with a return_url parameter that points back to the custom GPT.
 * 
 * Flow:
 * 1. User completes checkout on SolvaPay's hosted page
 * 2. SolvaPay redirects to: /api/checkout/complete?return_url=<custom_gpt_url>
 * 3. This route redirects the user back to the custom GPT (return_url)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const returnUrl = url.searchParams.get('return_url') || '/'

  // eslint-disable-next-line no-console
  console.log('CHECKOUT COMPLETE: returnUrl', returnUrl)

  // Redirect directly to the return_url (custom GPT)
  return NextResponse.redirect(returnUrl)
}
