import { authClient, SOLVAPAY_USERINFO_URL } from '@/lib/auth-client'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    return redirect(`/?error=${error}`)
  }

  if (!code) {
    return redirect('/?error=missing_code')
  }

  try {
    // 1. Exchange code for token
    const tokenResponse = await authClient.exchangeCodeForToken(code)
    
    // 2. Fetch User Info
    // We fetch user info mainly to verify the token works and get the user's ID/Email if needed for local session
    await authClient.getUserInfo(tokenResponse.access_token, SOLVAPAY_USERINFO_URL)
    
    // Note: Customer creation/syncing is handled automatically by the SolvaPay OAuth Server
    // when the user logs in or signs up there. We don't need to manually ensure the customer exists here.
    
    // 3. Set cookie
    // Note: In production, set secure: true, httpOnly: true, sameSite: 'lax'
    const cookieStore = await cookies()
    cookieStore.set('solvapay_token', tokenResponse.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: tokenResponse.expires_in || 3600,
      path: '/',
    })

    // 4. Redirect to home
    return redirect('/')
  } catch (err) {
    console.error('Callback error:', err)
    return redirect('/?error=auth_failed')
  }
}

