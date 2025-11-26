import { authClient } from '@/lib/auth-client'
import { redirect } from 'next/navigation'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const state = url.searchParams.get('state') || undefined
  const scope = 'openid email profile' // Add other scopes if needed

  const authUrl = authClient.getAuthorizationUrl({ state, scope })
  
  redirect(authUrl)
}

