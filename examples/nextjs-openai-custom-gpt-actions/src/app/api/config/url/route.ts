import { NextResponse } from 'next/server'

export async function GET() {
  // Get the public URL from environment variables
  const publicUrl =
    process.env.PUBLIC_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)

  return NextResponse.json({
    url: publicUrl,
  })
}

