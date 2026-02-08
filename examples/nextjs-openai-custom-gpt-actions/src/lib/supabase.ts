/**
 * Supabase Client Setup
 *
 * Creates and exports the Supabase client for authentication.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured. Authentication will not work.')
}

// Use placeholder values during build time if env vars are missing
// This prevents build failures while still allowing the app to work at runtime
const safeUrl = supabaseUrl || 'https://placeholder.supabase.co'
const safeKey = supabaseAnonKey || 'placeholder-key'

export const supabase = createClient(safeUrl, safeKey)

/**
 * Get the current user's ID from Supabase session
 * Returns null if not authenticated
 */
export async function getUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.user?.id || null
}

/**
 * Get the current user's access token for API calls
 * Returns null if not authenticated
 */
export async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token || null
}

/**
 * Get the current user's email from Supabase session
 * Returns null if not authenticated
 */
export async function getUserEmail(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.user?.email || null
}

/**
 * Get the current user object from Supabase session
 * Returns null if not authenticated
 */
export async function getUser() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.user || null
}

/**
 * Sign up a new user with email and password
 */
export async function signUp(email: string, password: string) {
  return await supabase.auth.signUp({
    email,
    password,
  })
}

/**
 * Sign in an existing user with email and password
 */
export async function signIn(email: string, password: string) {
  return await supabase.auth.signInWithPassword({
    email,
    password,
  })
}

/**
 * Sign out the current user
 * Properly clears session for both email/password and OAuth providers
 */
export async function signOut() {
  try {
    // Check if there's an active session first
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      // No session to sign out from - return success
      return { data: { user: null }, error: null }
    }

    // Sign out from Supabase - clears the local session
    // For OAuth providers, this clears the session cookie
    const result = await supabase.auth.signOut()

    if (result.error) {
      // If sign out fails, try to clear local storage anyway
      console.warn('Sign out error (attempting to clear local state):', result.error)

      // Force clear local session
      if (typeof window !== 'undefined') {
        // Clear Supabase session storage
        const storageKey = `sb-${supabaseUrl.split('//')[1]?.split('.')[0]}-auth-token`
        localStorage.removeItem(storageKey)
        sessionStorage.clear()
      }

      // Still return success to allow UI to update
      return { data: { user: null }, error: null }
    }

    return result
  } catch (error) {
    // If sign out completely fails, clear local state and return success
    console.warn('Sign out error (clearing local state):', error)

    if (typeof window !== 'undefined') {
      // Clear Supabase session storage
      const storageKey = `sb-${supabaseUrl.split('//')[1]?.split('.')[0]}-auth-token`
      localStorage.removeItem(storageKey)
      sessionStorage.clear()
    }

    // Return success to allow UI to update
    return { data: { user: null }, error: null }
  }
}

/**
 * Sign in with Google OAuth
 * Redirects to Google OAuth page, then redirects back to the callback URL
 */
export async function signInWithGoogle(redirectTo?: string) {
  const callbackUrl = redirectTo || `${window.location.origin}/auth/callback`

  return await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl,
    },
  })
}

/**
 * Purchase to auth state changes
 * Returns an unsubscribe function
 */
export function onAuthStateChange(callback: (event: string, session: { access_token?: string; user?: { id: string; email?: string } } | null) => void) {
  return supabase.auth.onAuthStateChange(callback)
}
