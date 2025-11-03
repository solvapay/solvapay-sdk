import { NextRequest, NextResponse } from 'next/server';

/**
 * Checkout Complete Endpoint
 * 
 * Handles redirects from hosted checkout completion.
 * Hosted checkout redirects users back to this app with success status.
 * Subscription updates are handled by SolvaPay backend automatically.
 * 
 * This route simply redirects to the completion page for display.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('return_url') || '/';

  // Redirect to the completion page or return URL
  // Hosted checkout handles subscription updates automatically
  const completionUrl = `/checkout/complete${returnUrl ? `?return_url=${encodeURIComponent(returnUrl)}` : ''}`;
  
  return NextResponse.redirect(new URL(completionUrl, request.url));
}
