import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  // In a stateless JWT flow (which we use for OAuth), we can't easily invalidate 
  // the specific access token server-side without a blacklist. 
  // The client (GPT) is responsible for discarding the token upon receiving this response.
  // We return success to confirm the operation.

  return NextResponse.json({
    success: true,
    message: 'Signed out successfully'
  })
}
