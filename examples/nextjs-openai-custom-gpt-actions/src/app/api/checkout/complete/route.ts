import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const returnUrl = url.searchParams.get('return_url') || '/'

  const completionUrl = `/checkout/complete${returnUrl ? `?return_url=${encodeURIComponent(returnUrl)}` : ''}`

  return NextResponse.redirect(new URL(completionUrl, request.url))
}
