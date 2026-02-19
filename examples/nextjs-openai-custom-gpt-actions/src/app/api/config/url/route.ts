import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Get the public URL from environment variables
  const publicUrl =
    process.env.PUBLIC_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  return NextResponse.json({
    url: publicUrl,
    solvaPayConsoleUrl: process.env.SOLVAPAY_FRONTEND_URL || 'http://localhost:3000',
    oauth: {
      authUrl: process.env.SOLVAPAY_AUTH_URL || 'https://api.solvapay.com/v1/oauth/authorize',
      tokenUrl: process.env.SOLVAPAY_TOKEN_URL || 'https://api.solvapay.com/v1/oauth/token',
    }
  })
}
