import { authClient } from '@/lib/auth-client'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get('solvapay_token')?.value

  if (token) {
    try {
      await authClient.revokeToken(token)
    } catch (error) {
      console.error('Failed to revoke token:', error)
    }
    cookieStore.delete('solvapay_token')
  }

  redirect('/')
}

