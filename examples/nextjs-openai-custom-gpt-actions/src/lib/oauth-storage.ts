/**
 * OAuth Storage
 *
 * Bare minimum OAuth storage using Supabase database.
 *
 * - Authorization codes: JWT-encoded (no storage needed)
 * - Refresh tokens: Stored in Supabase database table
 * - Revoked tokens: Not stored (rely on JWT expiration only)
 */

import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables not configured')
  }

  // Use service role key for server-side operations (if available)
  // Otherwise use anon key with RLS policies
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  return createClient(supabaseUrl, serviceRoleKey || supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Refresh token storage using Supabase database
 */
export const refreshTokens = {
  /**
   * Store a refresh token in Supabase
   */
  async set(
    token: string,
    data: {
      userId: string
      clientId: string
      issuedAt: Date
      expiresAt: Date
    },
  ) {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('oauth_refresh_tokens').insert({
      token,
      user_id: data.userId,
      client_id: data.clientId,
      issued_at: data.issuedAt.toISOString(),
      expires_at: data.expiresAt.toISOString(),
    })

    if (error) {
      console.error('Error storing refresh token:', error)
      throw error
    }
  },

  /**
   * Get refresh token data from Supabase
   */
  async get(token: string): Promise<{
    userId: string
    clientId: string
    issuedAt: Date
    expiresAt: Date
  } | null> {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('oauth_refresh_tokens')
      .select('*')
      .eq('token', token)
      .single()

    if (error || !data) {
      return null
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      // Auto-delete expired token
      await this.delete(token)
      return null
    }

    return {
      userId: data.user_id,
      clientId: data.client_id,
      issuedAt: new Date(data.issued_at),
      expiresAt: new Date(data.expires_at),
    }
  },

  /**
   * Delete a refresh token from Supabase
   */
  async delete(token: string) {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('oauth_refresh_tokens').delete().eq('token', token)

    if (error) {
      console.error('Error deleting refresh token:', error)
    }
  },

  /**
   * Check if refresh token exists
   */
  async has(token: string): Promise<boolean> {
    const data = await this.get(token)
    return data !== null
  },
}
