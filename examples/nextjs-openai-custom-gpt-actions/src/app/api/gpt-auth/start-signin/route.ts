import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  // This endpoint is called to "Start Sign In".
  // Since we are using the GPT's native OAuth flow, we simply return a 401 Unauthorized.
  // This tells the GPT platform to show the "Sign In with [App]" button to the user.
  return NextResponse.json(
    { error: 'unauthenticated', message: 'Please sign in using the button below.' }, 
    { status: 401 }
  )
}
